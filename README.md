# Orbit · Matrix 聊天工作台

这是一个基于 Semi Design 视觉语言搭建的 Matrix 聊天工具前端。项目无需构建工具，使用本地静态服务器即可运行；外网可用时会从 CDN 加载 React、Semi UI 和 `matrix-js-sdk`。页面不包含预置房间或虚构消息，所有内容均来自登录后的 Matrix homeserver。开发服务器内置了一个仅供本机使用的 Matrix 反向代理，用于兼容未配置 CORS 的 homeserver。

## 启动

在此目录执行 `./start.ps1`，然后打开 <http://localhost:4174>。脚本会优先使用 Bun，也支持 Python 或任意静态文件服务器。要使用内置 Matrix 代理，请使用这个启动脚本；如果直接用其他静态服务器，则要求 homeserver 自己配置 CORS。由于浏览器的 ES Module 安全策略，不建议直接双击 `index.html`（`file://`）。

## 换电脑开发

这是一个无需安装前端依赖的原生浏览器项目，克隆仓库后即可继续开发：

1. 安装 [Bun](https://bun.sh/)（推荐）或 Python 3。
2. 执行 `bun install`（当前没有第三方 npm 依赖，这一步可选）。
3. Windows 执行 `./start.ps1`，其他系统执行 `bun server.js`。
4. 打开 <http://localhost:4174>，直接编辑 `app.js`、`styles.css` 和 `index.html` 即可看到效果。

运行时会从 esm.sh、Google Fonts 和表情资源服务器加载外部资源，因此首次运行需要网络连接；Matrix homeserver 地址和登录信息由页面运行时输入，不会写入仓库。

## 功能框架

- 工作区与房间：从 `client.getRooms()` 加载已加入房间、房间搜索、未读数、最近消息、房间切换。
- 会话：实时 timeline、历史分页、回复、编辑、撤回、表情回应、已读回执、输入状态与文件/图片发送。
- 线程与关系：线程回复使用 `m.thread`，消息编辑、撤回、回应会在时间线中聚合显示。
- 数据可靠性：登录会话保存在浏览器本地（只保存 access token，不保存密码），刷新页面自动恢复；同步错误会提示并保留本地会话。
- 协作侧栏：房间简介、成员头像、共享文件、隐私说明。
- Matrix 连接：Homeserver / 用户名 / 密码登录弹窗，成功后启动初始同步并发送真实消息；退出登录会调用 `client.logout()`。
- Homeserver 发现：如果输入的是 Element 网页域名，会读取 `/.well-known/matrix/client` 并自动切换到真实的 `m.homeserver.base_url`；连接前还会验证 `/_matrix/client/versions`。
- 房间管理：创建房间、邀请成员；账户面板支持读取设备列表并发起设备验证。
- 搜索：使用 Matrix `/search` 在当前房间内搜索消息。
- 状态与通知：监听成员、房间状态和在线状态事件；账户面板可申请浏览器通知，页面隐藏时接收新消息提醒。
- 房间操作：支持离开当前房间，并在房间成员区域发起邀请。
- 产品化扩展位：消息搜索、语音/视频、空间视图仍保留为后续入口。

## Matrix 接口映射

当前 `app.js` 中的 `MatrixConnection`、`App` 与 `Chat` 已接好最小闭环：

参考：[Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)、[matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk)。

| 产品能力 | Matrix Client-Server API / SDK |
| --- | --- |
| 登录 | `client.login("m.login.password", ...)` → `/_matrix/client/v3/login` |
| 初始同步与增量事件 | `client.startClient({ initialSyncLimit: 20 })` → `/_matrix/client/v3/sync` |
| 发送文本 / 回复 / 编辑 | `client.sendMessage(roomId, content)` / `sendTextMessage` → `/_matrix/client/v3/rooms/{roomId}/send/...` |
| 历史消息 | `client.scrollback(room, limit)` → `/_matrix/client/v3/rooms/{roomId}/messages` |
| 创建房间 | `client.createRoom({ name, invite })` → `/_matrix/client/v3/createRoom` |
| 邀请成员 | `client.invite(roomId, userId)` → `/_matrix/client/v3/rooms/{roomId}/invite` |
| 撤回消息 | `client.redactEvent(roomId, eventId)` → `/_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}` |
| 表情回应 | `client.sendEvent(roomId, "m.reaction", ...)` → `m.annotation` |
| 已读回执 / 输入状态 | `client.sendReadReceipt(event)` / `client.sendTyping(...)` |
| 文件上传 | `client.uploadContent(file)` → `/_matrix/media/v3/upload` |
| 设备验证 | `client.getDevices()` / `client.requestVerification(...)` |
| 线程 | `m.relates_to.rel_type = "m.thread"` |
| 搜索消息 | `client.search(...)` → `/_matrix/client/v3/search` |
| 房间成员/状态 | `client.getRoom(roomId)`、`room.getJoinedMembers()`、`/state` |

## 后续增强

1. 监听 `RoomMember.membership` 与 `RoomState.events`，让成员变化与房间名称变更即时反映在侧栏。
2. 将 access token 和消息状态迁移到更安全的 IndexedDB crypto store，增加跨设备会话管理。
3. 当前登录流程会在可用时调用 `client.initRustCrypto({ useIndexedDB: true })`，生产环境建议使用 SSO 或短期 token，并完善 SAS 验证与密钥备份。
4. 接入线程、推送规则和 MatrixRTC，并将加密附件替换为 Matrix 加密媒体格式。

> 安全提示：不要把长期密码写入 localStorage；生产环境应使用安全存储、设备验证和短期访问令牌。
