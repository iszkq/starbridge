# 前端模块边界

当前前端仍由 `app.js` 负责页面编排和 Matrix 状态管理，但高频维护的 UI 部分已经拆到独立模块：

- `ui/Icon.js`：统一 SVG 图标，避免在业务组件中维护图标路径。
- `editor/Composer.js`：Halo/Tiptap 编辑器、纯文本降级编辑器、格式工具栏和编辑器粘贴处理。
- `mobile/`：窄屏与触控布局、长按手势、键盘安全区和移动端样式。

后续新增 UI 时优先放在 `src/ui`，编辑器能力放在 `src/editor`；`app.js` 只负责房间状态、消息发送和页面组合。拆分采用浏览器原生 ES Module，不增加构建步骤，也不会改变现有 `localhost:4174` 启动方式。
