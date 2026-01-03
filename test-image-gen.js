import { generateDynamicCard, closeBrowser } from './src/image-generator.js';
import { getSpaceDynamics } from './src/bili-api.js';
import { config } from './src/config.js';
import fs from 'fs';

const TEST_UID = '353361863'; // 七濑Unia

async function test() {
    console.log('Fetching dynamic...');
    const dynamics = await getSpaceDynamics(TEST_UID, config.data.cookie);
    
    if (!dynamics || dynamics.code !== 0 || !dynamics.data.items || dynamics.data.items.length === 0) {
        console.error('Failed to fetch dynamics');
        return;
    }

    const item = dynamics.data.items[0];
    console.log(`Generating card for Dynamic ID: ${item.id_str}`);

    try {
        const buffer = await generateDynamicCard(item);
        fs.writeFileSync('test-card.png', buffer);
        console.log('✅ Card generated: test-card.png');
    } catch (e) {
        console.error('❌ Generation failed:', e);
    } finally {
        await closeBrowser();
    }
}

test();
