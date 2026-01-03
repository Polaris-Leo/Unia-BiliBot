import axios from 'axios';
import crypto from 'crypto';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

let wbiKeys = null;
let wbiKeysExpire = 0;

// Helper to get WBI keys
async function getWbiKeys(cookie = '') {
    if (wbiKeys && Date.now() < wbiKeysExpire) {
        return wbiKeys;
    }

    try {
        const { data } = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: {
                'User-Agent': USER_AGENT,
                'Cookie': cookie
            }
        });

        if (data.code !== 0 && data.code !== -101) { // -101 is not logged in, but still returns wbi_img
             console.error('Error fetching WBI keys:', data);
             return null;
        }

        const json_content = data.data;
        const img_url = json_content.wbi_img.img_url;
        const sub_url = json_content.wbi_img.sub_url;

        const img_key = img_url.substring(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
        const sub_key = sub_url.substring(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));

        wbiKeys = { img_key, sub_key };
        wbiKeysExpire = Date.now() + 1000 * 60 * 60 * 24; // Cache for 1 day
        return wbiKeys;
    } catch (error) {
        console.error('Failed to fetch WBI keys:', error);
        return null;
    }
}

function getMixinKey(orig) {
    let temp = '';
    for (let i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) {
        temp += orig[MIXIN_KEY_ENC_TAB[i]];
    }
    return temp.slice(0, 32);
}

function encWbi(params, img_key, sub_key) {
    const mixin_key = getMixinKey(img_key + sub_key);
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()*]/g;

    const newParams = { ...params, wts: curr_time };
    const query = Object.keys(newParams)
        .sort()
        .map(key => {
            const value = newParams[key].toString().replace(chr_filter, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');

    const wbi_sign = crypto.createHash('md5').update(query + mixin_key).digest('hex');
    return { ...newParams, w_rid: wbi_sign };
}

export async function getSpaceDynamics(host_mid, cookie = '') {
    const keys = await getWbiKeys(cookie);
    if (!keys) return null;

    const params = {
        host_mid: host_mid,
        offset: '',
        timezone_offset: -480,
        features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,forwardListHidden,decorationCard,commentsNewVersion,onlyfansAssetsV2,ugcDelete,onlyfansQaCard'
    };

    const signedParams = encWbi(params, keys.img_key, keys.sub_key);

    try {
        const { data } = await axios.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space', {
            params: signedParams,
            headers: {
                'User-Agent': USER_AGENT,
                'Cookie': cookie
            }
        });
        return data;
    } catch (error) {
        console.error('Error fetching dynamics:', error);
        return null;
    }
}

export async function getRoomInfo(room_id) {
    try {
        const { data } = await axios.get('https://api.live.bilibili.com/room/v1/Room/get_info', {
            params: { room_id },
            headers: { 'User-Agent': USER_AGENT }
        });
        return data;
    } catch (error) {
        console.error('Error fetching room info:', error);
        return null;
    }
}

export async function getRoomIdByMid(mid) {
    try {
        const { data } = await axios.post('https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids', {
            uids: [parseInt(mid)]
        }, {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (data.code === 0 && data.data && data.data[mid]) {
            return data.data[mid].room_id;
        }
        return null;
    } catch (error) {
        console.error('Error fetching room init:', error);
        return null;
    }
}

export async function getLiveStatus(mid) {
    try {
        const { data } = await axios.post('https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids', {
            uids: [parseInt(mid)]
        }, {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (data.code === 0 && data.data && data.data[mid]) {
            return data.data[mid];
        }
        return null;
    } catch (error) {
        console.error('Error fetching live status:', error);
        return null;
    }
}

export async function getQRCode() {
    try {
        const { data } = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
            headers: { 'User-Agent': USER_AGENT }
        });
        return data;
    } catch (error) {
        console.error('Error generating QR code:', error);
        return null;
    }
}

export async function pollQRCode(qrcode_key) {
    try {
        const response = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', {
            params: { qrcode_key },
            headers: { 'User-Agent': USER_AGENT }
        });
        
        const data = response.data;
        if (data.data.code === 0) {
            // Extract cookies
            const cookies = response.headers['set-cookie'];
            if (cookies) {
                data.data.cookie = cookies.map(c => c.split(';')[0]).join('; ');
            }
        }
        return data;
    } catch (error) {
        console.error('Error polling QR code:', error);
        return null;
    }
}

export async function getSelfInfo(cookie) {
    try {
        const { data } = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: {
                'User-Agent': USER_AGENT,
                'Cookie': cookie
            }
        });
        return data;
    } catch (error) {
        console.error('Error fetching self info:', error);
        return null;
    }
}
