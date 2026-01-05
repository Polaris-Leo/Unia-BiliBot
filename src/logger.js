import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '../data/events.log');

// Ensure data directory exists
const dataDir = path.dirname(LOG_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export function logEvent(type, user, details) {
    const entry = {
        timestamp: Date.now(),
        type, // 'live_start', 'live_end', 'dynamic'
        user: user.uname || user.mid,
        details
    };
    
    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('Failed to write to event log:', err);
    }
}

const RETENTION_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanupLogs() {
    if (!fs.existsSync(LOG_FILE)) return;
    
    try {
        const data = fs.readFileSync(LOG_FILE, 'utf8');
        const now = Date.now();
        const lines = data.split('\n').filter(line => line.trim());
        const newLines = lines.filter(line => {
            try {
                const log = JSON.parse(line);
                return (now - log.timestamp) < RETENTION_PERIOD;
            } catch (e) {
                return false;
            }
        });

        if (newLines.length < lines.length) {
            fs.writeFileSync(LOG_FILE, newLines.join('\n') + '\n');
            console.log(`[Logger] Cleaned ${lines.length - newLines.length} old logs.`);
        }
    } catch (err) {
        console.error('Error cleaning logs:', err);
    }
}

// Run cleanup on startup
cleanupLogs();

// Run cleanup every 24 hours
setInterval(cleanupLogs, 24 * 60 * 60 * 1000);

export function getLogs(limit = 100) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(LOG_FILE)) {
            return resolve([]);
        }

        fs.readFile(LOG_FILE, 'utf8', (err, data) => {
            if (err) return reject(err);
            
            const lines = data.trim().split('\n');
            const logs = lines
                .filter(line => line.trim())
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(log => log !== null)
                .reverse() // Newest first
                .slice(0, limit);
                
            resolve(logs);
        });
    });
}
