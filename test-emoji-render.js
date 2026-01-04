import { generateDynamicCard, closeBrowser } from './src/image-generator.js';
import axios from 'axios';
import fs from 'fs';

const MID = '353361863';
const TARGET_ID = '1153883250897190934';
const COOKIE = 'SESSDATA=627f0400%2C1782974020%2C8dd29%2A11CjD6yoYNLCIVAw71C2phNqJHXsQiX7HEaQV-pPqWRNTPCCtxJmDR_5em53vPc6AeZOgSVjI2S1M0MXZxbG84dV9pbGpyTU5sQzlfZEt6TUY2WDNrWVNQN3AtS21IaGRWa0NlNXZXMXBJaFd6R3Awa0pLaDItRlpESlF2VFBxc1NzQUREVy1MZTd3IIEC; bili_jct=1b28f81e57a34d6b586a9db46a4d736a; DedeUserID=3546588232289187; DedeUserID__ckMd5=f98a6006037e50d7; sid=8uy22xp6';

async function run() {
    try {
        console.log(`Fetching dynamics for mid ${MID}...`);
        
        const { getSpaceDynamics } = await import('./src/bili-api.js');
        
        const dynamics = await getSpaceDynamics(MID, COOKIE);
        
        if (dynamics && dynamics.data && dynamics.data.items) {
            const target = dynamics.data.items.find(i => i.id_str === TARGET_ID);
            if (target) {
                console.log('Found target in list.');
                // console.log('List Item Modules:', JSON.stringify(target.modules, null, 2));
                
                // Generate card from this item
                const buffer = await generateDynamicCard(target);
                fs.writeFileSync('test-output-1153883250897190934.png', buffer);
                console.log('Image saved to test-output-1153883250897190934.png');
            } else {
                console.log('Target not found in recent list. Trying detail API...');
                // Fallback to detail API if not in list (though detail API structure might differ slightly, usually it's compatible for card generation)
                const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                const { data } = await axios.get(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail`, {
                    params: { id: TARGET_ID },
                    headers: { 
                        'User-Agent': USER_AGENT,
                        'Cookie': COOKIE
                    }
                });
                
                if (data.code === 0 && data.data && data.data.item) {
                     console.log('Found target via detail API.');
                     const buffer = await generateDynamicCard(data.data.item);
                     fs.writeFileSync('test-output-1153883250897190934.png', buffer);
                     console.log('Image saved to test-output-1153883250897190934.png');
                } else {
                    console.error('Target not found via detail API either.');
                }
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await closeBrowser();
    }
}

run();
