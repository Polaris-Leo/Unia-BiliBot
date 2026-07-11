# Unia BiliBili Bot

基于 Node.js 的 Bilibili 动态与直播监控机器人，适配 NapCat (OneBot 11)。

## 功能
- 监控指定用户的 Bilibili 动态（支持图文、视频投稿），并推送到 QQ 群。
- 以高分辨率无损 PNG 卡片推送动态；多目标和自定义消息模板复用同一份渲染结果，避免重复截图。
- 监控指定用户的直播间状态（开播、下播），并推送到 QQ 群。
- 提供 Web 前端界面进行配置和扫码登录。

## 安装

1. 进入目录：
   ```bash
   cd unia-bot
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

## 运行

1. 启动服务：
   ```bash
   npm start
   ```

2. 打开浏览器访问：
   http://localhost:3001

3. 在网页中：
   - 点击“获取登录二维码”并扫码登录 Bilibili。
   - 配置 NapCat 的 HTTP API 地址（例如 `http://127.0.0.1:3000`）。
   - **注意**：本机器人运行在 3001 端口。

4. 添加监控用户：
   - 输入用户的 UID (MID)。
   - 输入需要推送的 QQ 群号。
   - 点击添加。

## 动态卡片渲染性能

动态卡片始终使用 `deviceScaleFactor: 3` 与无损 PNG 截图，优化不会降低图片清晰度或分辨率。

- 每条动态在单次处理过程中只渲染一次；所有群聊、私聊及其自定义动态模板复用同一张图片。
- 截图前会等待字体、`<img>`、CSS 背景图和浏览器绘制完成，而不是等待网络完全空闲；这能避免慢图片请求将卡片渲染不必要地拖慢。
- 控制台会输出 `[Card render performance]` 阶段耗时；事件日志会记录 `dynamic_performance`，其中 `cardRenderCount: 1` 表示该动态没有被重复渲染。
- 普通资源错误只影响当前页面；只有 Chromium/DevTools 连接级错误才会重启浏览器实例。

## 目录结构
- `src/bili-api.js`: Bilibili API 封装 (含 WBI 签名)。
- `src/bot.js`: 监控逻辑与消息推送。
- `src/config.js`: 配置管理。
- `src/napcat.js`: NapCat 接口封装。
- `src/server.js`: Web 服务器。
- `public/`: 前端静态文件。
