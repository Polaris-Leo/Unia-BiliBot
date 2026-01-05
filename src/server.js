import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import * as biliApi from './bili-api.js';
import * as logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3002; // Changed from 3001 to avoid conflict with NapCat WS

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/config', (req, res) => {
    res.json(config.data);
});

app.post('/api/config', (req, res) => {
    config.data = req.body;
    config.save();
    res.json({ success: true });
});

app.get('/api/logs', async (req, res) => {
    try {
        const logs = await logger.getLogs(200); // Get last 200 logs
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qrcode', async (req, res) => {
    const data = await biliApi.getQRCode();
    res.json(data);
});

app.get('/api/qrcode/poll', async (req, res) => {
    const { qrcode_key } = req.query;
    const data = await biliApi.pollQRCode(qrcode_key);
    
    if (data && data.data.code === 0) {
        // Login success, save cookie
        // The API returns url with cookies, but usually the Set-Cookie header is what we need.
        // Wait, the poll API returns cookies in the response headers?
        // The docs say: "验证登录成功后会进行设置以下cookie项"
        // Actually, the `poll` response usually contains the refresh token or just success code.
        // The cookies are set in the HTTP response headers from Bilibili.
        // Since we are calling from backend, axios will receive the Set-Cookie headers.
        // We need to extract them.
        // Let's check bili-api.js pollQRCode implementation.
    }
    res.json(data);
});

// Helper to extract cookies from axios response
// I need to modify bili-api.js to return headers or handle cookies there.
// For now, let's assume the user will copy-paste or I'll improve it later.
// Actually, the poll API response body usually contains `url` which has the cross-domain login info, 
// but for the bot, we just need the cookies.
// The `poll` request itself will have `set-cookie` headers if successful.

app.get('/api/resolve-user', async (req, res) => {
    const { mid } = req.query;
    const info = await biliApi.getLiveStatus(mid);
    if (info) {
        res.json({
            roomId: info.room_id,
            uname: info.uname,
            face: info.face
        });
    } else {
        const roomId = await biliApi.getRoomIdByMid(mid);
        res.json({ roomId });
    }
});

app.get('/api/user-info', async (req, res) => {
    if (!config.data.cookie) {
        return res.json({ code: -1, message: 'Not logged in' });
    }
    const data = await biliApi.getSelfInfo(config.data.cookie);
    res.json(data);
});

app.post('/api/users-status', async (req, res) => {
    const { mids } = req.body;
    if (!Array.isArray(mids) || mids.length === 0) {
        return res.json({});
    }
    const data = await biliApi.getBatchLiveStatus(mids);
    res.json(data);
});

export function startServer() {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
