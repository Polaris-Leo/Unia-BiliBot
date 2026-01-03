import { init, sendGroupMsg } from './src/napcat.js';

// Get group ID from command line args
const groupId = process.argv[2];

console.log('正在初始化 NapCat 连接...');
init();

// Wait for WS connection (give it a second)
setTimeout(async () => {
    if (groupId) {
        console.log(`\n正在尝试发送测试消息到群: ${groupId}`);
        try {
            await sendGroupMsg(Number(groupId), 'Hello from Unia Bot! \n这是一条测试消息。');
            console.log('✅ 消息发送请求已发出 (请检查 QQ 群是否收到)');
        } catch (error) {
            console.error('❌ 发送失败:', error.message);
            if (error.response) {
                console.error('响应数据:', error.response.data);
            }
        }
    } else {
        console.log('\n⚠️ 未提供群号，仅测试连接。');
        console.log('如需测试发送消息，请运行: node test-napcat.js <群号>');
    }
    
    // Keep process alive briefly to receive any async errors or WS events
    setTimeout(() => {
        console.log('\n测试结束。');
        process.exit(0);
    }, 2000);
}, 2000);
