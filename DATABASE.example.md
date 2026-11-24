# MySQL 配置

项目使用 MySQL 8.4。请为项目创建独立的 `yp666` 数据库，并创建仅能访问该数据库的应用账号。

将根目录 `.env.example` 复制为 `.env.local`，按实际环境填写：

```dotenv
MYSQL_HOST=your-mysql-host
MYSQL_PORT=3306
MYSQL_DATABASE=yp666
MYSQL_USER=yp666_app
MYSQL_PASSWORD=replace-with-your-password
MYSQL_SSL_MODE=VERIFY_CA
MYSQL_SSL_CA=certs/mysql-ca.pem
```

从数据库管理员处获取公共 CA 证书，保存到 `certs/mysql-ca.pem`。当前后端在配置 CA 后会校验服务器证书的签发 CA，不校验证书的主机名；请使用可信来源提供的 CA。生产环境必须配置 CA。

数据库服务端应要求应用账号通过 TLS 连接，并按实际客户端出口地址设置网络白名单。数据库连接信息只由后端读取，不要放入 `VITE_*` 等前端变量。

安装依赖并配置环境变量后，可生成 Prisma 客户端并初始化空的项目数据库：

```sh
pnpm db:generate
pnpm db:push
```

初始化脚本仅在数据库为空时创建表；已存在完整项目表时会保留原有数据，遇到其他表结构会停止。后续数据库结构升级应使用经过审查的迁移脚本。

实际密码、证书、数据库导出文件和本机 `DATABASE.md` 已通过 `.gitignore` 排除。请分别备份这些本地资料，克隆源码不会自动获得它们。
