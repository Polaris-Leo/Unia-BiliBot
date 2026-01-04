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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', { hour12: false });
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
            content = major.opus.summary.text;
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
        content = dynamic.desc.text + '\n' + content;
    }

    // Process content for HTML (newlines to <br>)
    content = content.replace(/\n/g, '<br>');

    // Image Grid Logic
    let imageGridHtml = '';
    if (images.length > 0) {
        let gridClass = 'grid-1';
        if (images.length === 2 || images.length === 4) gridClass = 'grid-2';
        else if (images.length >= 3) gridClass = 'grid-3';

        imageGridHtml = `<div class="image-grid ${gridClass}">`;
        images.forEach(img => {
            imageGridHtml += `<div class="img-item" style="background-image: url('${img}')"></div>`;
        });
        imageGridHtml += `</div>`;
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
        /* Special case for single image to show full aspect */
        .grid-1 .img-item {
            padding-bottom: 0;
            height: auto;
            min-height: 200px;
        }
        .grid-1 .img-item::after {
            content: "";
            display: block;
            padding-bottom: 60%; /* Max height ratio constraint */
        }
        /* Actually for single image better to use img tag but bg is easier for grid */
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
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    // Set viewport with high pixel density for better quality
    await page.setViewport({
        width: 600,
        height: 800,
        deviceScaleFactor: 3
    });
    
    const html = generateHtml(item);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Get the height of the card
    const element = await page.$('#card');
    const boundingBox = await element.boundingBox();
    
    // Screenshot just the card
    const buffer = await element.screenshot({
        type: 'png',
        omitBackground: true
    });
    
    await page.close();
    return buffer;
}

export async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}
