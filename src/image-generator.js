import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

let browser = null;
let browserIdleTimer = null;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function getBrowser() {
    // Clear idle timer if it exists
    if (browserIdleTimer) {
        clearTimeout(browserIdleTimer);
        browserIdleTimer = null;
    }

    if (!browser || !browser.isConnected()) {
        if (browser) {
            console.log('Browser disconnected, closing old instance...');
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

function scheduleBrowserCleanup() {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(async () => {
        if (browser) {
            console.log('Closing idle browser to save memory...');
            try {
                await browser.close();
            } catch (e) {
                console.error('Error closing idle browser:', e);
            }
            browser = null;
        }
    }, BROWSER_IDLE_TIMEOUT);
}

function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    const second = date.getSeconds().toString().padStart(2, '0');
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
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
            } else if (node.type === 'RICH_TEXT_NODE_TYPE_AT') {
                const atText = node.text;
                const escapedText = atText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(escapedText, 'g'), `<span style="color: #00a1d6;">${atText}</span>`);
            } else if (node.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
                const topicText = node.text;
                const escapedText = topicText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(escapedText, 'g'), `<span style="color: #00a1d6;">${topicText}</span>`);
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
    let pubTime = author.pub_time;
    if (author.pub_ts) {
        pubTime = formatTime(author.pub_ts);
    }
    
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

    // Add description if available (e.g. for forwarded dynamics or simple text dynamics)
    if (dynamic.desc) {
        const descText = processRichText(dynamic.desc);
        if (content) {
            // Avoid duplication if descText is already in content
            if (!content.includes(descText)) {
                content = descText + '\n' + content;
            }
        } else {
            content = descText;
        }
    }
    
    // Process content for HTML (newlines to <br>)
    content = content.replace(/\n/g, '<br>');

    // Handle Forwarded Dynamic
    if (item.type === 'DYNAMIC_TYPE_FORWARD' && item.orig) {
        const orig = item.orig;
        const origAuthor = orig.modules.module_author.name;
        let origContent = '';
        let origImages = [];
        
        const origDynamic = orig.modules.module_dynamic;
        if (origDynamic.major) {
            const major = origDynamic.major;
            if (major.opus) {
                origContent = processRichText(major.opus.summary);
                if (major.opus.pics) origImages = major.opus.pics.map(p => p.url);
            } else if (major.archive) {
                origContent = major.archive.desc;
                origImages = [major.archive.cover];
                origContent = `【视频】${major.archive.title}\n${origContent}`;
            } else if (major.draw && major.draw.items) {
                origImages = major.draw.items.map(i => i.src);
            } else if (major.article) {
                origImages = major.article.covers;
                origContent = `【专栏】${major.article.title}\n${major.article.desc}`;
            }
        }
        if (origDynamic.desc) {
            const descText = processRichText(origDynamic.desc);
            if (origContent) {
                if (!origContent.includes(descText)) {
                    origContent = descText + '\n' + origContent;
                }
            } else {
                origContent = descText;
            }
        }
        
        // Trim original content to remove extra whitespace
        origContent = origContent.trim();

        // Append forwarded content to main content
        content += `
            <div class="forward-container" style="background: #f7f8fa; padding: 10px 12px; margin-top: 8px; border-radius: 6px;">
                <div style="color: #00a1d6; font-weight: bold; margin-bottom: 6px; font-size: 14px;">@${origAuthor}</div>
                <div style="color: #333; line-height: 1.5; font-size: 14px; white-space: pre-wrap;">${origContent}</div>
                ${origImages.length > 0 ? `<div style="margin-top: 8px;">[图片 x ${origImages.length}]</div>` : ''}
            </div>
        `;
        
        // If original has images, we might want to show them too, but for now let's just show the text structure
        // Or better, merge images if the main dynamic has none? 
        // Usually forwarded dynamics don't have their own images, they just have text.
        // But if we want to show the images of the forwarded content, we need to handle it.
        
        if (origImages.length > 0) {
             // Let's render orig images in the forward container
             let origGridHtml = '';
             if (origImages.length === 1) {
                origGridHtml = `<div class="image-grid grid-1" style="margin-top:10px;">
                    <img src="${origImages[0]}" class="img-item-single" crossorigin="anonymous">
                </div>`;
             } else {
                let gridClass = 'grid-2';
                if (origImages.length >= 3) gridClass = 'grid-3';
                origGridHtml = `<div class="image-grid ${gridClass}" style="margin-top:8px;">`;
                origImages.forEach(img => {
                    origGridHtml += `<div class="img-item" style="background-image: url('${img}')"></div>`;
                });
                origGridHtml += `</div>`;
             }
             // Insert into the forward container
             content = content.replace('[图片 x ' + origImages.length + ']', origGridHtml);
        }
    }

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
            font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
            margin-bottom: 10px;
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
            margin-bottom: 2px;
        }
        .time {
            font-size: 12px;
            color: #999;
            letter-spacing: -0.5px;
            font-family: sans-serif;
        }
        .content {
            font-size: 15px;
            color: #333;
            line-height: 1.5;
            margin-bottom: 10px;
            word-wrap: break-word;
        }
        .image-grid {
            display: grid;
            gap: 4px;
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
        
        // Schedule cleanup after successful generation
        scheduleBrowserCleanup();
        
        return buffer;
    } catch (error) {
        console.error('Error in generateDynamicCard:', error);
        // If we hit a protocol error or timeout, the browser might be in a bad state.
        // Close it so it gets recreated next time.
        if (browser) {
            console.log('Closing browser due to error to recover memory/state...');
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
    if (browserIdleTimer) {
        clearTimeout(browserIdleTimer);
        browserIdleTimer = null;
    }
    if (browser) {
        console.log('Manually closing browser for memory cleanup...');
        await browser.close();
        browser = null;
    }
}
