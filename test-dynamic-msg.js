import { init, sendPrivateMsg } from './src/napcat.js';
import { getSpaceDynamics } from './src/bili-api.js';
import { config } from './src/config.js';

// Load config
const users = config.data.users;
let targetQQ = null;
let targetMid = null;

// Find the first user with a private target
for (const user of users) {
    if (user.targetPrivate && user.targetPrivate.length > 0) {
        targetQQ = user.targetPrivate[0];
        targetMid = user.mid;
        break;
    }
}

if (!targetQQ || !targetMid) {
    console.error('❌ 未在配置中找到有效的监控用户或私信目标。');
    process.exit(1);
}

console.log(`正在初始化 NapCat 连接... (目标QQ: ${targetQQ}, 监控UID: ${targetMid})`);
init();

async function testDynamic() {
    console.log('正在获取最新动态...');
    const dynamics = await getSpaceDynamics(targetMid, config.data.cookie);
    
    if (!dynamics || dynamics.code !== 0 || !dynamics.data.items || dynamics.data.items.length === 0) {
        console.error('❌ 获取动态失败或无动态');
        process.exit(1);
    }

    const item = dynamics.data.items[0];
    console.log(`获取到最新动态 ID: ${item.id_str}`);
    
    // Inspect the item for any share image fields
    console.log(JSON.stringify(item, null, 2)); 

    // Parse dynamic
    const author = item.modules.module_author.name;
    const dynamicModule = item.modules.module_dynamic;
    let images = [];
    let jumpUrl = `https://t.bilibili.com/${item.id_str}`;

    if (dynamicModule.major) {
        const major = dynamicModule.major;
        if (major.opus && major.opus.pics) {
            images = major.opus.pics.map(p => p.url);
        } else if (major.archive) {
            images = [major.archive.cover];
            jumpUrl = `https://www.bilibili.com/video/${major.archive.bvid}`;
        } else if (major.draw && major.draw.items) {
             images = major.draw.items.map(i => i.src);
        }
    }

    // Format message as requested:
    // （用户名）发新动态了<换行>
    // （链接）<换行>
    // （图片）
    let msg = `${author} 发新动态了\n${jumpUrl}`;
    
    // Only send the first image as the "share image"
    if (images.length > 0) {
        msg += `\n[CQ:image,file=${images[0]}]`;
    }

    console.log('构造的消息内容:\n', msg);

    // Send
    try {
        await sendPrivateMsg(targetQQ, msg);
        console.log('✅ 动态消息已发送');
    } catch (error) {
        console.error('❌ 发送失败:', error.message);
    }

    setTimeout(() => process.exit(0), 2000);
}

// Wait for WS
setTimeout(testDynamic, 2000);
