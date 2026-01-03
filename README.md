# Unia BiliBili Bot

基于 Node.js 的 Bilibili 动态与直播监控机器人，适配 NapCat (OneBot 11)。

## 功能
- 监控指定用户的 Bilibili 动态（支持图文、视频投稿），并推送到 QQ 群。
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

## 目录结构
- `src/bili-api.js`: Bilibili API 封装 (含 WBI 签名)。
- `src/bot.js`: 监控逻辑与消息推送。
- `src/config.js`: 配置管理。
- `src/napcat.js`: NapCat 接口封装。
- `src/server.js`: Web 服务器。
- `public/`: 前端静态文件。
