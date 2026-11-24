# 青屿 · 在线会客厅

同一套响应式前台适配电脑和手机，提供验证入口、内容展示、访客留言与客服回复；管理后台维护页面、图文、常见问题和会话。

服务器安装、HTTPS、后台路径和更新回退步骤见 [部署说明](./DEPLOYMENT.md)。

## 技术方案

- 前台：Vue 3、TypeScript、Vite。
- 管理后台：Vue 3、Element Plus、TypeScript。
- 后端：NestJS、Prisma、MySQL 8.4。
- 验证：自托管滑块拼图，支持切换 Cloudflare Turnstile。

## 目录

```text
apps/web          响应式访客页面
apps/admin        管理后台
apps/api          后端接口与数据库模型
packages/shared   内容类型、校验规则、初始示例内容
certs             数据库证书配置说明（实际证书留在本地）
data              本地上传文件，已忽略版本管理
tests/e2e         端到端验证
```

## 本地运行

要求 Node.js 22.13+ 或 Node.js 24、pnpm 11，以及可以连接的 MySQL。首次克隆后，将 `.env.example` 复制为 `.env.local`，填写数据库与初始管理员信息，并按 [数据库配置说明](./DATABASE.example.md) 配置 CA 证书。`.env.local` 不会提交到仓库。

```sh
pnpm install
pnpm --filter @yp666/shared build
pnpm db:generate
pnpm db:push
pnpm dev
```

访问地址：

- 前台：http://127.0.0.1:5173
- 后台：http://127.0.0.1:5174
- 接口健康状态：http://127.0.0.1:3001/api/health

初始管理员用户名和密码保存在 `.env.local` 的 `ADMIN_USERNAME`、`ADMIN_PASSWORD`。首次创建后，密码以数据库中的哈希为准；更改环境变量不会覆盖现有账号。登录后台后可修改密码。

数据库连接说明见 [DATABASE.example.md](./DATABASE.example.md)。本地程序通过 TLS 连接 MySQL；服务器实际地址、密码和本机专用连接说明不随源码上传。

## 使用流程

1. 打开前台，完成验证后进入在线会客厅。
2. 在后台编辑页面设置、图文内容与常见问题。
3. 保存草稿，再发布；前台重新加载后会显示发布内容。
4. 访客可点击常见问题获取预设回答，也可以发送留言。
5. 管理员在会话页回复；前台会定时拉取回复，保留当前页面即可。

页面使用原创示例文案与本地 SVG 插画。上线前请在后台替换成真实品牌、服务内容与链接。

## 验证与会话

前端页面和内容接口均检查验证状态，直接请求内容接口无法跳过验证。访客会话与管理员会话分别使用 HttpOnly Cookie，管理员密码使用哈希存储。数据库账号仅具有项目库权限。

滑块拼图每次生成随机风景与纹理，答案保存在服务端，并绑定访客会话、有效期和单次使用限制。开发模式使用 `CAPTCHA_PROVIDER=local`；生产环境可以显式配置 `CAPTCHA_PROVIDER=slider` 使用自托管轻量拼图，无需第三方密钥。拼图提供基础访问验证，不能替代专业的机器人风险识别。

需要第三方验证时，配置 `CAPTCHA_PROVIDER=turnstile`、`TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY`，并在验证码服务中登记实际域名。生产模式拒绝 `local` 开发配置。发布环境需要配置 HTTPS、`APP_ORIGINS` 中的实际访问域名及安全 Cookie，并完善备份与数据保留策略。当 API 仅监听本机且通过同机 Nginx 等代理提供访问时，可配置 `TRUST_PROXY=loopback`，仅信任回环地址代理转发的客户端地址。

所有数据库配置只由后端加载，禁止放到 `VITE_*` 等会被打包到浏览器的变量中。上传图片保存在本机 `data/uploads`，迁移时应一起备份。

## 检查与构建

```sh
pnpm typecheck
pnpm test
pnpm build
# 本地三个服务启动后执行
pnpm test:e2e
```

Windows 默认使用已安装的 Chrome 执行浏览器测试。其他系统可先执行 `pnpm exec playwright install chromium`，或设置 `CHROME_PATH` 指向本机 Chrome。

浏览器测试连接真实数据库，创建独立的测试访客，并在结束后清理；发布测试会暂时修改示例文案并恢复。请仅在本地开发环境执行，不要针对正在接待真实访客的站点执行。
