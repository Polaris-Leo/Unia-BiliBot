import axios from 'axios';
import { config } from './src/config.js';

const DYNAMIC_ID = '1150495668435943444';
const COOKIE = config.data.cookie;

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 BiliApp/7.62.0';

async function test() {
    console.log('Testing Mobile/Share APIs...');

    // 1. Old Dynamic Detail API (api.vc.bilibili.com)
    try {
        console.log('\n1. Testing api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail...');
        const res1 = await axios.get('https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail', {
            params: { dynamic_id: DYNAMIC_ID },
            headers: { 
                'User-Agent': MOBILE_UA,
                'Cookie': COOKIE
            }
        });
        console.log('Code:', res1.data.code);
        if (res1.data.code === 0) {
            // Check for share info or images
            const data = res1.data.data;
            const cardStr = data.card.card;
            const card = JSON.parse(cardStr);
            
            console.log('--- Parsed Card ---');
            // console.log(JSON.stringify(card, null, 2));
            if (card.item && card.item.pictures) {
                 console.log('Pictures:', card.item.pictures);
            }
            
            console.log('--- Display Field ---');
            console.log(JSON.stringify(data.display, null, 2));
        }
    } catch (e) {
        console.error('Error 1:', e.message);
    }

    // 2. Web Polymer API with Mobile UA
    try {
        console.log('\n2. Testing api.bilibili.com/x/polymer/web-dynamic/v1/detail with Mobile UA...');
        const res2 = await axios.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/detail', {
            params: { id: DYNAMIC_ID },
            headers: { 
                'User-Agent': MOBILE_UA,
                'Cookie': COOKIE
            }
        });
        console.log('Code:', res2.data.code);
        if (res2.data.code === 0) {
            const item = res2.data.data.item;
            console.log('Module Share Info:', JSON.stringify(item.modules.module_share_info, null, 2));
        }
    } catch (e) {
        console.error('Error 2:', e.message);
    }
}

test();
