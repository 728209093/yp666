# 加密备份与恢复检查

本工具把项目 9 张表的一致性快照、`shared/data`、`shared/.env.local` 和 `shared/certs` 打包，再使用标准 OpenSSL CMS AuthEnvelopedData 加密。内容加密为 AES-256-GCM，收件人密钥封装使用 RSA-OAEP / SHA-256。备份服务器只保存收件人公开证书，恢复私钥应独立保存在可信设备或密钥库，不能上传服务器或提交 Git。

默认每天北京时间 03:15 后随机延迟最多 20 分钟执行，保留最近 30 份密文。恢复工具只解密、检查目录清单，不自动导入数据库或覆盖线上文件。CMS 的 GCM 标签能验证密文完整性；公开证书不提供备份来源的签名证明，因此离机副本、访问控制和恢复检查仍需保留。

## 离线准备密钥

在可信本机运行，`backup-private.pem` 是恢复所需秘密，`backup-recipient.pem` 是可上传的公开证书：

```sh
umask 077
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 \
  -keyout backup-private.pem -out backup-recipient.pem \
  -subj '/CN=YP666 backup recovery'
```

OpenSSL 会交互要求设置私钥口令。口令不要放在命令参数、Shell 历史或服务器环境文件中。如果改用 Windows 用户绑定 DPAPI 保存私钥，应另外保留可恢复的受保护副本；Windows 用户资料丢失后，仅有 DPAPI 密文不能恢复密钥。不要只保留公开证书。

## 服务器安装

系统需要 Node.js 24、OpenSSL 3 和支持 USTAR 的 tar；项目依赖须已安装。以下操作不会修改账号、聊天记录或数据库结构：

```sh
install -d -m 0700 /opt/yp666/backups/encrypted
install -d -m 0750 /etc/yp666
install -m 0644 /path/to/backup-recipient.pem /etc/yp666/backup-recipient.pem
install -m 0644 deploy/yp666-backup.service /etc/systemd/system/yp666-backup.service
install -m 0644 deploy/yp666-backup.timer /etc/systemd/system/yp666-backup.timer
systemctl daemon-reload
systemctl start yp666-backup.service
systemctl status yp666-backup.service --no-pager
systemctl enable --now yp666-backup.timer
systemctl list-timers yp666-backup.timer
```

确认第一次备份成功且能在可信设备解密检查后，再依赖定时任务。检查 `journalctl -u yp666-backup.service -n 30`；失败只记录错误类别，不输出数据库密码和数据。建议将该服务失败状态接入既有运维告警。

可通过 service override 设置非秘密参数 `BACKUP_RETENTION_COUNT`、`BACKUP_OUTPUT_DIR`、`BACKUP_SHARED_DIR`、`BACKUP_RECIPIENT_CERT`、`OPENSSL_BIN` 和 `TAR_BIN`。改变输出目录时需同步调整 `ReadWritePaths` 并预先创建权限 0700 的目录。保留数量只能是 2–365；清理仅匹配本工具产出的 `yp666-backup-时间-随机值.cms` 及对应校验文件，不清理既有人工备份。

数据库导出只执行 SELECT / SHOW 和只读快照事务，不需要 CREATE、ALTER 或 DROP 权限。临时明文在权限 0700 的私有目录，成功或异常退出时清理；systemd `PrivateTmp` 进一步隔离临时文件。输出目录 0700、密文与校验文件 0600。遇到未知表会停止，要求先审查新增表的备份覆盖，避免悄悄漏备。

## 离机保存

将 `.cms` 和相邻 `.cms.sha256` 一起复制到独立设备或存储。服务器上的同机副本不能防止整机、磁盘损坏或管理员误删。下载任务只需要读密文，不应接触恢复私钥。至少保留一份独立的恢复密钥副本，并定期检查离机下载日期和恢复结果。

GCM 密文无需依赖 SHA-256 才能保密或校验完整性；SHA-256 文件用于在解密前发现传输损坏。应通过已验证主机身份的 SSH 或其他受保护渠道复制密文和校验值。

## 离线解密检查

在独立设备上运行，输出目录必须尚不存在。加密私钥的口令由 OpenSSL 交互读取：

```sh
node deploy/decrypt-backup.mjs \
  --input /safe/yp666-backup-TIMESTAMP-ID.cms \
  --certificate /safe/backup-recipient.pem \
  --key /safe/backup-private.pem \
  --output /safe/new-recovery-directory
```

工具先核对同名 `.cms.sha256`，解密并验证 GCM，再验证归档路径并生成 `archive-contents.txt` 和 `project.tar.gz`。失败时删除不完整明文归档。不会解压或连接数据库；不要把输出目录放在网站发布目录内。

在隔离的、全新空数据库中人工导入 `database.sql`，并在独立目录恢复上传文件与配置，核对记录数量和抽样媒体。导入前检查 SQL 内容和目标库，绝不能直接向正在接待访客的项目库执行恢复 SQL。配置包含凭据，恢复目录与密钥必须限制权限；恢复完成后按计划清理明文。

当前上传文件以不可变 UUID 名称写入，且写入文件后才创建数据库记录；导出数据库后复制媒体可覆盖该快照引用的文件。备份期间不要并行删除或搬移上传目录，也不要执行表结构迁移。若以后支持媒体删除，应与备份协调，或改用文件系统快照。
