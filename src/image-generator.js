import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

let browser = null;

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Fix for Docker low memory
                '--disable-gpu',
                '--disable-extensions',
                '--no-first-run',
                '--no-zygote'
            ],
            protocolTimeout: 120000 // 2 minutes
        });
    }
    return browser;
}

function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', { hour12: false });
}

function processRichText(nodeContainer) {
    if (!nodeContainer) return '';
    let text = nodeContainer.text || '';
    if (nodeContainer.rich_text_nodes) {
        nodeContainer.rich_text_nodes.forEach(node => {
            if (node.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && node.emoji) {
                const emojiText = node.text;
                const emojiUrl = node.emoji.icon_url;
                const escapedText = emojiText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(escapedText, 'g'), `<img src="${emojiUrl}" style="width:20px;height:20px;vertical-align:text-bottom;margin:0 2px;">`);
            }
        });
    }
    return text;
}

function generateHtml(item) {
    const author = item.modules.module_author;
    const dynamic = item.modules.module_dynamic;
    
    const name = author.name;
    const face = author.face;
    const pubTime = author.pub_time;
    
    let content = '';
    let images = [];
    
    if (dynamic.major) {
        const major = dynamic.major;
        if (major.opus) {
            content = processRichText(major.opus.summary);
            if (major.opus.pics) images = major.opus.pics.map(p => p.url);
        } else if (major.archive) {
            content = major.archive.desc;
            images = [major.archive.cover];
            content = `【视频】${major.archive.title}\n${content}`;
        } else if (major.draw && major.draw.items) {
            images = major.draw.items.map(i => i.src);
        } else if (major.article) {
            images = major.article.covers;
            content = `【专栏】${major.article.title}\n${major.article.desc}`;
        }
    }
    
    if (dynamic.desc) {
        content = processRichText(dynamic.desc) + '\n' + content;
    }

    // Process content for HTML (newlines to <br>)
    content = content.replace(/\n/g, '<br>');

    // Image Grid Logic
    let imageGridHtml = '';
    if (images.length > 0) {
        if (images.length === 1) {
            // Single image: use <img> tag to preserve aspect ratio
            imageGridHtml = `<div class="image-grid grid-1">
                <img src="${images[0]}" class="img-item-single" crossorigin="anonymous">
            </div>`;
        } else {
            let gridClass = 'grid-2';
            if (images.length >= 3) gridClass = 'grid-3';

            imageGridHtml = `<div class="image-grid ${gridClass}">`;
            images.forEach(img => {
                imageGridHtml += `<div class="img-item" style="background-image: url('${img}')"></div>`;
            });
            imageGridHtml += `</div>`;
        }
    }

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #f4f5f7;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            width: 400px; /* Fixed width for the card */
        }
        .card {
            background: #fff;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            margin-right: 12px;
            border: 1px solid #eee;
        }
        .info {
            display: flex;
            flex-direction: column;
        }
        .name {
            font-weight: bold;
            font-size: 16px;
            color: #fb7299;
            margin-bottom: 4px;
        }
        .time {
            font-size: 12px;
            color: #999;
        }
        .content {
            font-size: 15px;
            color: #333;
            line-height: 1.6;
            margin-bottom: 15px;
            word-wrap: break-word;
        }
        .image-grid {
            display: grid;
            gap: 8px;
        }
        .grid-1 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: 1fr 1fr; }
        .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
        
        .img-item {
            width: 100%;
            padding-bottom: 100%; /* 1:1 Aspect Ratio */
            background-size: cover;
            background-position: top center;
            border-radius: 4px;
            background-color: #f0f0f0;
        }
        .img-item-single {
            width: 100%;
            height: auto;
            border-radius: 4px;
            display: block;
            max-height: 600px;
            object-fit: contain;
            background-color: #f0f0f0;
        }
    </style>
</head>
<body>
    <div class="card" id="card">
        <div class="header">
            <img src="${face}" class="avatar" crossorigin="anonymous">
            <div class="info">
                <span class="name">${name}</span>
                <span class="time">${pubTime}</span>
            </div>
        </div>
        <div class="content">${content}</div>
        ${imageGridHtml}
    </div>
</body>
</html>
    `;
}

export async function generateDynamicCard(item) {
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
    
        // Set viewport with high pixel density for better quality
        await page.setViewport({
            width: 600,
            height: 800,
            deviceScaleFactor: 3
        });
        
        const html = generateHtml(item);
        // Set a timeout for content loading to prevent hanging indefinitely
        await page.setContent(html, { 
            waitUntil: 'networkidle0',
            timeout: 30000 // 30 seconds timeout
        });
        
        // Get the height of the card
        const element = await page.$('#card');
        if (!element) {
            throw new Error('Card element not found');
        }
        
        // Screenshot just the card
        const buffer = await element.screenshot({
            type: 'png',
            omitBackground: true
        });
        
        return buffer;
    } catch (error) {
        console.error('Error in generateDynamicCard:', error);
        // If we hit a protocol error or timeout, the browser might be in a bad state.
        // Close it so it gets recreated next time.
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error('Error closing browser on failure:', e);
            }
            browser = null;
        }
        throw error;
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                console.error('Error closing page:', e);
            }
        }
    }
}

export async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}
