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
    
    // 优先使用 rich_text_nodes 进行精确拼接，解决替换可能导致的错误匹配和空格问题
    if (nodeContainer.rich_text_nodes && nodeContainer.rich_text_nodes.length > 0) {
        return nodeContainer.rich_text_nodes.map(node => {
            if (node.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && node.emoji) {
                return `<img src="${node.emoji.icon_url}" style="width:20px;height:20px;vertical-align:text-bottom;margin:0 1px;">`;
            } else if (node.type === 'RICH_TEXT_NODE_TYPE_AT') {
                return `<span style="color: #00a1d6;">${node.text}</span>`;
            } else if (node.type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
                return `<span style="color: #00a1d6;">${node.text}</span>`;
            } else {
                // RICH_TEXT_NODE_TYPE_TEXT 和其他类型直接返回文本
                return node.text;
            }
        }).join('');
    }

    // Fallback: 仅有 text 的情况（通常不会发生，或者是旧版数据）
    return nodeContainer.text || '';
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
    let customCardHtml = '';
    let emojiMap = new Map();

    // Helper to collect emojis from rich text nodes to reuse in video title
    const collectEmojis = (nodeContainer) => {
        if (!nodeContainer || !nodeContainer.rich_text_nodes) return;
        nodeContainer.rich_text_nodes.forEach(node => {
            if (node.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && node.emoji) {
                emojiMap.set(node.text, node.emoji.icon_url);
            }
        });
    };
    
    // Attempt to collect emojis from available dynamic descriptions
     if (dynamic.desc) collectEmojis(dynamic.desc);
     if (dynamic.major && dynamic.major.opus) collectEmojis(dynamic.major.opus.summary);

    // Apply emoji replacement to plain text using collected map
    const replaceEmojis = (text) => {
        if (!text) return '';
        let result = text;
        emojiMap.forEach((url, code) => {
            const escapedText = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escapedText, 'g'), `<img src="${url}" style="width:20px;height:20px;vertical-align:text-bottom;margin:0 1px;">`);
        });
        return result;
    };
    
    if (dynamic.major) {
        const major = dynamic.major;
        if (major.opus) {
            content = processRichText(major.opus.summary);
            if (major.opus.pics) images = major.opus.pics.map(p => p.url);
        } else if (major.archive) {
            const archive = major.archive;
            const duration = archive.duration_text || '';
            const processedTitle = replaceEmojis(archive.title);
            
            customCardHtml = `
            <div class="video-card">
                <div class="video-cover" style="background-image: url('${archive.cover}');">
                    <div class="video-stats-overlay">
                        <span class="stat-item">${duration ? duration : ''}</span>
                    </div>
                </div>
                <div class="video-title">${processedTitle}</div>
            </div>`;
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
            font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
        .video-card {
            display: block;
            margin-top: 10px;
            text-decoration: none;
            color: inherit;
            background-color: #f7f8fa; /* Light gray background to distinguish from text */
            border-radius: 8px;
            padding: 10px 10px 4px 10px; /* Padding wrapper */
        }
        .video-cover {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%; /* 16:9 Aspect Ratio */
            background-color: #e7e7e7;
            background-size: cover;
            background-position: center;
            border-radius: 6px; /* All 4 corners rounded */
            overflow: hidden; /* Ensure content like overlay respects radius */
        }
        .video-stats-overlay {
            position: absolute;
            bottom: 6px;
            left: 6px;
            color: #fff;
            display: flex;
            align-items: center;
            font-size: 13px;
            background: rgba(0,0,0,0.5);
            padding: 2px 6px;
            border-radius: 4px;
        }
        .video-cover::after {
            content: '';
            position: absolute;
            right: 10px;
            bottom: 10px;
            width: 40px;
            height: 40px;
            background: url("data:image/svg+xml,%3Csvg viewBox='0 0 1024 1024' version='1.1' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M830.577778 227.555556H657.066667l74.903703-70.162963c11.377778-11.377778 11.377778-29.392593 0-39.822223-5.688889-5.688889-13.274074-8.533333-21.807407-8.533333-7.585185 0-15.17037 2.844444-21.807407 8.533333L570.785185 227.555556H456.059259L338.488889 117.57037c-5.688889-5.688889-13.274074-8.533333-21.807408-8.533333-7.585185 0-15.17037 2.844444-21.807407 8.533333-11.377778 11.377778-11.377778 29.392593 0 39.822223L369.777778 227.555556H193.422222C117.57037 227.555556 56.888889 295.822222 56.888889 381.155556v332.8c0 85.333333 60.681481 153.6 136.533333 153.6h42.666667c0 25.6 22.755556 47.407407 50.251852 47.407407s50.251852-20.859259 50.251852-47.407407h353.659259c0 25.6 22.755556 47.407407 50.251852 47.407407s50.251852-20.859259 50.251852-47.407407h38.874074c75.851852 0 136.533333-69.214815 136.533333-153.6V381.155556c0.948148-85.333333-59.733333-153.6-135.585185-153.6zM698.785185 574.577778L425.718519 733.866667c-22.755556 13.274074-41.718519 2.844444-41.718519-24.651852V389.688889c0-26.548148 18.962963-37.925926 41.718519-24.651852l273.066666 160.237037c22.755556 14.222222 22.755556 35.081481 0 49.303704z' fill='white'%3E%3C/path%3E%3C/svg%3E") no-repeat center center;
            background-size: contain;
            opacity: 0.9;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
        }
        .video-title {
            margin-top: 8px;
            margin-bottom: 6px;
            padding: 0 2px;
            font-size: 15px;
            color: #212121;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            font-weight: 500;
        }
        .stat-item {
            margin-right: 0;
            font-weight: 500;
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
        ${customCardHtml}
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
