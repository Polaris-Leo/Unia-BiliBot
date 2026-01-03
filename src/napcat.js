import axios from 'axios';
import WebSocket from 'ws';
import { config } from './config.js';

let ws = null;
let isConnected = false;
let reconnectTimer = null;

export function init() {
    connectWs();
}

function connectWs() {
    if (!config.data.napcatWsUrl) return;

    if (ws) {
        ws.removeAllListeners();
        ws.close();
    }

    let wsUrl = config.data.napcatWsUrl;
    if (config.data.napcatToken) {
        // Append access_token to query params
        const separator = wsUrl.includes('?') ? '&' : '?';
        wsUrl += `${separator}access_token=${encodeURIComponent(config.data.napcatToken)}`;
    }

    console.log(`Connecting to NapCat WS: ${config.data.napcatWsUrl} (Token: ${config.data.napcatToken ? 'Yes' : 'No'})`);
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        console.log('NapCat WS connected');
        isConnected = true;
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    });

    ws.on('close', () => {
        console.log('NapCat WS closed');
        isConnected = false;
        scheduleReconnect();
    });

    ws.on('error', (err) => {
        console.error('NapCat WS error:', err.message);
        isConnected = false;
        // Close event will trigger reconnect
    });
    
    ws.on('message', (data) => {
        // Handle incoming messages if needed in the future
        // const msg = JSON.parse(data);
        // console.log('Received WS message:', msg);
    });
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log('Scheduling WS reconnect in 5s...');
    reconnectTimer = setInterval(() => {
        connectWs();
    }, 5000);
}

// Reload WS connection if config changes
export function reload() {
    connectWs();
}

async function sendWs(action, params) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ws) {
            reject(new Error('WS not connected'));
            return;
        }
        
        const payload = {
            action,
            params,
            echo: Date.now().toString()
        };
        
        ws.send(JSON.stringify(payload), (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function sendHttp(action, params) {
    const url = `${config.data.napcatUrl}/${action}`;
    const headers = {};
    if (config.data.napcatToken) {
        headers['Authorization'] = `Bearer ${config.data.napcatToken}`;
    }
    await axios.post(url, params, { headers });
}

export async function sendGroupMsg(group_id, message) {
    const params = { group_id, message };
    
    // Try WS first
    if (isConnected) {
        try {
            await sendWs('send_group_msg', params);
            return;
        } catch (err) {
            console.error('WS send failed, falling back to HTTP:', err.message);
        }
    }

    // Fallback to HTTP
    try {
        await sendHttp('send_group_msg', params);
    } catch (error) {
        console.error(`Failed to send group message to ${group_id} (HTTP):`, error.message);
        throw error; // Re-throw to let caller know it failed
    }
}

export async function sendPrivateMsg(user_id, message) {
    const params = { user_id, message };

    // Try WS first
    if (isConnected) {
        try {
            await sendWs('send_private_msg', params);
            return;
        } catch (err) {
            console.error('WS send failed, falling back to HTTP:', err.message);
        }
    }

    // Fallback to HTTP
    try {
        await sendHttp('send_private_msg', params);
    } catch (error) {
        console.error(`Failed to send private message to ${user_id} (HTTP):`, error.message);
        throw error; // Re-throw to let caller know it failed
    }
}
