import { init, sendPrivateMsg } from './src/napcat.js';
import { config } from './src/config.js';

// Load config to get the private user ID
const users = config.data.users;
let targetQQ = null;

// Find the first user with a private target
for (const user of users) {
    if (user.targetPrivate && user.targetPrivate.length > 0) {
        targetQQ = user.targetPrivate[0];
        break;
    }
}

// Allow overriding via command line
if (process.argv[2]) {
    targetQQ = Number(process.argv[2]);
}

if (!targetQQ) {
    console.error('❌ 未在配置中找到私信目标，也未提供命令行参数。');
    console.error('用法: node test-napcat-private.js [QQ号]');
    process.exit(1);
}

console.log('正在初始化 NapCat 连接...');
init();

// Wait for WS connection
setTimeout(async () => {
    console.log(`\n正在尝试发送私信测试消息到 QQ: ${targetQQ}`);
    try {
        await sendPrivateMsg(targetQQ, 'Hello from Unia Bot! \n这是一条私信测试消息。');
        console.log('✅ 私信发送请求已发出 (请检查 QQ 是否收到)');
    } catch (error) {
        console.error('❌ 发送失败:', error.message);
        if (error.response) {
            console.error('响应数据:', error.response.data);
        }
    }
    
    // Keep process alive briefly
    setTimeout(() => {
        console.log('\n测试结束。');
        process.exit(0);
    }, 2000);
}, 2000);
