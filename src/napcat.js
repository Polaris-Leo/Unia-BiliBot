import axios from 'axios';
import WebSocket from 'ws';
import { config } from './config.js';

let ws = null;
let isConnected = false;
let reconnectTimer = null;
let echoSequence = 0;
const pendingWsRequests = new Map();
const REQUEST_TIMEOUT = 15000;

export function init() {
    connectWs();
}

function connectWs() {
    if (!config.data.napcatWsUrl) return;

    if (ws) {
        rejectPendingWsRequests(new Error('NapCat WS connection reloading'));
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
        rejectPendingWsRequests(new Error('NapCat WS disconnected'));
        scheduleReconnect();
    });

    ws.on('error', (err) => {
        console.error('NapCat WS error:', err.message);
        isConnected = false;
        // Close event will trigger reconnect
    });
    
    ws.on('message', (data) => {
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (message.echo === undefined || message.echo === null) return;
        const pending = pendingWsRequests.get(String(message.echo));
        if (!pending) return;

        pendingWsRequests.delete(String(message.echo));
        clearTimeout(pending.timer);
        if (message.status === 'ok' && (message.retcode === 0 || message.retcode === undefined)) {
            pending.resolve(message.data);
        } else {
            pending.reject(new Error(message.message || message.wording || `NapCat retcode ${message.retcode}`));
        }
    });
}

function rejectPendingWsRequests(error) {
    for (const pending of pendingWsRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
    }
    pendingWsRequests.clear();
}

// Simple Request Queue to prevent rate limiting / message swallowing
const msgQueue = [];
let isQueueProcessing = false;
const RATE_LIMIT_DELAY = 750;

async function processQueue() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;

    try {
        while (msgQueue.length > 0) {
            const { task, resolve, reject, type, targetId } = msgQueue.shift();
            try {
                await task();
                console.log(`[NapCat] Sent message to ${type} ${targetId}`);
                resolve();
            } catch (e) {
                console.error(`[NapCat] Failed to send to ${type} ${targetId}:`, e.message);
                reject(e);
            }
            // Wait before processing next
            if (msgQueue.length > 0) {
                await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
            }
        }
    } catch (criticalError) {
        console.error('[NapCat] Critical queue error:', criticalError);
    } finally {
        isQueueProcessing = false;
    }
}

function enqueue(task, type, targetId) {
    return new Promise((resolve, reject) => {
        msgQueue.push({ task, resolve, reject, type, targetId });
        console.log(`[NapCat] Enqueued message for ${type} ${targetId}. Queue size: ${msgQueue.length}`);
        processQueue();
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
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WS not connected'));
            return;
        }

        const echo = `${Date.now()}-${++echoSequence}`;
        const payload = {
            action,
            params,
            echo
        };

        const timer = setTimeout(() => {
            pendingWsRequests.delete(echo);
            reject(new Error(`NapCat WS request timed out after ${REQUEST_TIMEOUT / 1000}s`));
        }, REQUEST_TIMEOUT);
        pendingWsRequests.set(echo, { resolve, reject, timer });

        ws.send(JSON.stringify(payload), (err) => {
            if (!err) return;
            const pending = pendingWsRequests.get(echo);
            if (!pending) return;
            pendingWsRequests.delete(echo);
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function sendHttp(action, params) {
    const url = `${config.data.napcatUrl}/${action}`;
    const headers = {};
    if (config.data.napcatToken) {
        headers['Authorization'] = `Bearer ${config.data.napcatToken}`;
    }
    const response = await axios.post(url, params, {
        headers,
        timeout: REQUEST_TIMEOUT
    });
    if (response.data?.status !== 'ok' ||
        (response.data?.retcode !== 0 && response.data?.retcode !== undefined)) {
        throw new Error(response.data?.message || response.data?.wording ||
            `NapCat HTTP retcode ${response.data?.retcode}`);
    }
}

export async function sendGroupMsg(group_id, message) {
    return enqueue(async () => {
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
    }, 'group', group_id);
}

export async function sendPrivateMsg(user_id, message) {
    return enqueue(async () => {
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
    }, 'private', user_id);
}
