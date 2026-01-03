import * as biliApi from './src/bili-api.js';

const ROOM_ID = 21514463; 
const MID = 353361863;

async function test() {
    console.log(`Fetching room info for Room ID: ${ROOM_ID}...`);
    const res = await biliApi.getRoomInfo(ROOM_ID);
    
    if (res && res.code === 0) {
        const data = res.data;
        console.log('✅ Room Info Fetched Successfully');
        console.log(`Title: ${data.title}`);
        console.log(`User Cover: ${data.user_cover}`);
        console.log(`Live Status: ${data.live_status}`);
        console.log(`Uname (from get_info): ${data.uname}`); 
    }

    console.log('\nFetching status info by UID...');
    const status = await biliApi.getLiveStatus(MID);
    if (status) {
        console.log('✅ Live Status Fetched Successfully');
        console.log(`Uname: ${status.uname}`);
        console.log(`Title: ${status.title}`);
        console.log(`Live Status: ${status.live_status}`);
        console.log(`Cover: ${status.cover_from_user}`); // or similar
        console.log('Full Keys:', Object.keys(status));
    } else {
        console.error('❌ Failed to fetch live status');
    }
}

test();
