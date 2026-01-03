import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const COOKIE_PATH = path.join(DATA_DIR, 'cookie.txt');

const DEFAULT_CONFIG = {
    napcatUrl: 'http://127.0.0.1:3000',
    napcatWsUrl: 'ws://127.0.0.1:3001',
    napcatToken: '',
    users: []
};

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadConfig() {
    ensureDataDir();
    let config = { ...DEFAULT_CONFIG };

    // Load config.json
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            const jsonConfig = JSON.parse(data);
            // Merge with default to ensure all fields exist
            config = { ...config, ...jsonConfig };
        } catch (error) {
            console.error('Error reading config:', error);
        }
    } else {
        saveConfig(config);
    }

    // Load cookie.txt
    if (fs.existsSync(COOKIE_PATH)) {
        try {
            const cookie = fs.readFileSync(COOKIE_PATH, 'utf8').trim();
            config.cookie = cookie;
        } catch (error) {
            console.error('Error reading cookie:', error);
            config.cookie = '';
        }
    } else {
        config.cookie = '';
    }

    return config;
}

function saveConfig(config) {
    ensureDataDir();
    
    // Separate cookie from other config
    const { cookie, ...jsonConfig } = config;

    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(jsonConfig, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving config:', error);
    }

    try {
        fs.writeFileSync(COOKIE_PATH, cookie || '', 'utf8');
    } catch (error) {
        console.error('Error saving cookie:', error);
    }
}

export const config = {
    data: loadConfig(),
    save() {
        saveConfig(this.data);
    },
    reload() {
        this.data = loadConfig();
    }
};
