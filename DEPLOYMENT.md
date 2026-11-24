# Debian / Nginx 部署

使用 Node.js 24、pnpm 11、MySQL 8.4、Nginx 和 systemd。以下路径为部署约定；`project.example.com` 必须替换为解析到服务器的实际域名。前台地址为 `/`，后台为 `/admin/`，API 仅监听本机 `127.0.0.1:3001`。

视频上传依赖 `ffprobe` 检查实际媒体流。Debian 可执行 `apt-get install --no-install-recommends ffmpeg` 安装，或在环境配置中指定 `FFPROBE_PATH`。

## 目录与账号

```text
/opt/yp666/runtime/              Node.js 24 的 bin、lib 等运行时文件
/opt/yp666/releases/<release>/   每次发布的完整代码、依赖与构建结果
/opt/yp666/current              指向当前 release 的符号链接
/opt/yp666/shared/.env.local     服务器实际配置，权限 0640，root:yp666
/opt/yp666/shared/certs/         数据库公共 CA 证书
/opt/yp666/shared/data/          持久上传内容，yp666:yp666 所有
```

由 root 创建不允许交互登录的服务账号和目录：

```sh
useradd --system --home-dir /opt/yp666 --shell /usr/sbin/nologin yp666
install -d -m 0755 /opt/yp666 /opt/yp666/releases /opt/yp666/shared
install -d -m 0750 -o yp666 -g yp666 /opt/yp666/shared/data
install -d -m 0750 -o root -g yp666 /opt/yp666/shared/certs
```

账号已存在时跳过 `useradd`。下载官方 Linux x64 Node.js 24 二进制，校验 SHA256 后解压到 `/opt/yp666/runtime`；让该目录仅由 root 写入。准备 pnpm 11.5.2，并在构建环境的 `PATH` 中加入 `/opt/yp666/runtime/bin`。

从 `.env.example` 生成 `/opt/yp666/shared/.env.local`，填写真实数据库和管理员信息。配置至少包含以下生产参数：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
APP_ORIGINS=https://project.example.com
TRUST_PROXY=loopback
CAPTCHA_PROVIDER=slider
MYSQL_SSL_CA=certs/mysql-ca.pem
```

`slider` 为自托管轻量拼图；需要第三方验证时使用 `turnstile` 并配置实际密钥。不能将开发用的 `local` 模式用于生产。数据库 CA 放入 shared/certs，配置文件设为 `root:yp666`、`0640`，证书目录保证服务账号可读。实际密码不写入 Git、终端命令或 Nginx 配置。

## 构建和发布

在本地已提交的工作区生成仅含 Git 跟踪文件的压缩包：

```sh
git archive --format=tar.gz -o ../yp666-release.tar.gz HEAD
scp ../yp666-release.tar.gz root@your-server:/tmp/yp666-release.tar.gz
```

归档文件应保存在仓库外，避免误加入下一次提交。也可以在服务器克隆仓库并检出所需提交；不要将个人 GitHub Token 放入 URL 或配置文件。

服务器上为本次发布创建独立目录并构建。以下命令要求构建工具已进入 `PATH`：

```sh
release_id=$(date -u +%Y%m%dT%H%M%SZ)
release_dir=/opt/yp666/releases/$release_id
install -d -m 0755 "$release_dir"
tar -xzf /tmp/yp666-release.tar.gz -C "$release_dir"
ln -s /opt/yp666/shared/.env.local "$release_dir/.env.local"
ln -s /opt/yp666/shared/data "$release_dir/data"
ln -s /opt/yp666/shared/certs/mysql-ca.pem "$release_dir/certs/mysql-ca.pem"
cd "$release_dir"
pnpm install --frozen-lockfile
pnpm --filter @yp666/shared build
pnpm --filter @yp666/api build
pnpm --filter @yp666/web build
pnpm --filter @yp666/admin exec vite build --base=/admin/
```

先验证配置和数据库可连接。已有项目数据库不需要再次初始化，也不要在正式站点上运行会修改内容的端到端测试。新建空数据库时，可按 [数据库说明](./DATABASE.example.md) 初始化。

升级到支持媒体消息的版本前，先备份项目数据库和 shared/data，再执行 [媒体消息迁移](./deploy/migrations/20261125-chat-media.sql)。该迁移仅新增消息字段和上传记录表，保留原有账号、设置和聊天数据；不要对已有库运行重置命令。新 release 完成构建和迁移后再切换 current。

Nginx 模板已将请求上限设置为 27 MB，用于接收最多 25 MB 的视频及 multipart 元数据。应用分别限制图片为 5 MB、视频为 25 MB，并验证实际文件内容。

运行时只需读取 release 下的代码和依赖；不要给服务账号代码写权限。Nginx 的 `www-data` 用户需要遍历 release 目录并读取两个 `dist` 目录，shared 配置不必对其开放。

首次安装 systemd 单元：

```sh
install -m 0644 deploy/yp666-api.service /etc/systemd/system/yp666-api.service
systemctl daemon-reload
ln -s "$release_dir" /opt/yp666/current.next
mv -Tf /opt/yp666/current.next /opt/yp666/current
systemctl enable --now yp666-api.service
curl --fail http://127.0.0.1:3001/api/health
```

后续发布在新目录完成安装和构建后，按同样方式原子更新 current 链接，再执行 `systemctl restart yp666-api.service`。`current.next` 是临时链接；若上次发布遗留，应先确认它是本项目的符号链接再清理。保留上一个 release 路径用于回退。

## HTTPS 与 Nginx

先确认域名 A / AAAA 均指向可达地址，防火墙允许 TCP 80 和 443。保留服务器原有站点，仅新增本项目的虚拟主机。首次签发证书时使用 HTTP 模板：

```sh
install -d -m 0755 /var/www/letsencrypt
sed 's/project.example.com/your-domain.example/g' deploy/nginx-http.conf > /etc/nginx/sites-available/yp666
ln -s /etc/nginx/sites-available/yp666 /etc/nginx/sites-enabled/yp666
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d your-domain.example
```

证书签发后切换 HTTPS 模板：

```sh
sed 's/project.example.com/your-domain.example/g' deploy/nginx.conf > /etc/nginx/sites-available/yp666
nginx -t
systemctl reload nginx
```

确认 certbot 自动续期任务已开启，并配置成功续期后的 `systemctl reload nginx` deploy hook。若 Nginx 前还有可信 CDN，应重新审查真实 IP 和可信代理配置；当前模板只信任本机 Nginx，并覆盖外部传入的 `X-Forwarded-For`。

## 验收和维护

检查以下地址以及浏览器登录、拼图验证、内容读取和消息提交：

```text
https://project.example.com/
https://project.example.com/admin/
https://project.example.com/api/health
```

故障排查使用 `systemctl status yp666-api.service`、`journalctl -u yp666-api.service -n 100`、`nginx -t` 及项目 Nginx 错误日志。systemd 提供开机启动和进程异常重启。

回退时将 current 原子切回上一个已验证 release，再重启 API；如果发布涉及数据库结构变更，应使用事先审查的数据库迁移和回退方案。定期备份数据库、shared/data、环境配置和证书，备份需限制访问权限。代码仓库不包含这些实际运行资料。
