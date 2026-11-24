# 数据库 CA 证书

从数据库管理员处获取公共 CA 证书，保存为本目录的 `mysql-ca.pem`，并在根目录 `.env.local` 配置：

```dotenv
MYSQL_SSL_CA=certs/mysql-ca.pem
```

实际证书与私钥文件均被 `.gitignore` 排除。当前应用仅需要 CA 公共证书，不需要客户端私钥。
