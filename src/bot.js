import { config } from './config.js';
import * as biliApi from './bili-api.js';
import * as napcat from './napcat.js';
import { generateDynamicCard } from './image-generator.js';

const POLL_INTERVAL = 30 * 1000; // 30 seconds
const retryMap = new Map(); // mid -> Set<dynamicId>
let isFirstRun = true;

function formatMessage(template, variables) {
    if (!template) return null;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] !== undefined ? variables[key] : match;
    });
}

async function checkLiveStatus(user) {
    if (!user.monitorLive || !user.mid) return;

    const liveInfo = await biliApi.getLiveStatus(user.mid);
    if (!liveInfo) return;

    const isNowLive = liveInfo.live_status === 1;
    const now = Date.now();

    // Handle first run state mismatch
    if (isFirstRun) {
        if (user.isLive && !isNowLive) {
            console.log(`[Startup] ${user.uname} state mismatch: Memory=Live, API=Offline. Silently correcting to Offline.`);
            user.isLive = false;
            user.offlineSince = 0;
            // Don't return, let it fall through to ensure clean state
        }
    }

    if (isNowLive) {
        // Currently Live
        if (user.isLive) {
            // Was Live -> Still Live
            if (user.offlineSince) {
                // Was pending offline, but came back. Glitch over.
                console.log(`${liveInfo.uname} reconnected within 3 mins.`);
                user.offlineSince = 0;
            }
        } else {
            // Was Offline -> Now Live
            const lastEnd = user.lastLiveEnd || 0;
            const gap = now - lastEnd;
            
            let msgType = 'start'; // default: > 15 mins or first time
            
            if (lastEnd > 0 && gap <= 15 * 60 * 1000) {
                // 3-15 mins (Note: <3 mins is handled by not setting isLive=false)
                msgType = 'resume';
            }

            user.isLive = true;
            
            if (msgType === 'start') {
                // New session: Use Bilibili's live_time if available (seconds -> ms), otherwise fallback to now
                user.lastLiveStart = (liveInfo.live_time && liveInfo.live_time > 0) ? liveInfo.live_time * 1000 : now;
            } else {
                // Resume session: Keep existing lastLiveStart if available
                if (!user.lastLiveStart) {
                     user.lastLiveStart = (liveInfo.live_time && liveInfo.live_time > 0) ? liveInfo.live_time * 1000 : now;
                }
            }

            user.offlineSince = 0;
            
            let msg = '';
            const variables = {
                name: liveInfo.uname,
                title: liveInfo.title,
                room_id: liveInfo.room_id,
                link: `https://live.bilibili.com/${liveInfo.room_id}`,
                cover: `[CQ:image,file=${liveInfo.cover_from_user}]`
            };

            if (user.liveStartMsg) {
                msg = formatMessage(user.liveStartMsg, variables);
            } else {
                // Default format
                if (msgType === 'resume') {
                    msg = `${liveInfo.uname} 已重新开播！【${liveInfo.title}】\nhttps://live.bilibili.com/${liveInfo.room_id}\n[CQ:image,file=${liveInfo.cover_from_user}]`;
                } else {
                    msg = `${liveInfo.uname} 开播啦！【${liveInfo.title}】\nhttps://live.bilibili.com/${liveInfo.room_id}\n[CQ:image,file=${liveInfo.cover_from_user}]`;
                }
            }
            
            if (user.notifyLiveStart !== false) {
                console.log(`[${new Date().toLocaleString()}] Sending live start notification for ${liveInfo.uname}`);
                for (const groupId of user.targetGroups) {
                    let groupMsg = msg;
                    if (user.atAllLive) {
                        groupMsg = `[CQ:at,qq=all]\n${groupMsg}`;
                    }
                    await napcat.sendGroupMsg(groupId, groupMsg);
                }
                if (user.targetPrivate) {
                    for (const userId of user.targetPrivate) {
                        await napcat.sendPrivateMsg(userId, msg);
                    }
                }
            }
        }
    } else {
        // Currently Offline
        if (user.isLive) {
            // Was Live -> Now Offline
            if (!user.offlineSince) {
                // First detection
                user.offlineSince = now;
                console.log(`[${new Date().toLocaleString()}] ${liveInfo.uname} detected offline, waiting 3 mins...`);
            } else {
                // Already detected offline, check duration
                const offlineDuration = now - user.offlineSince;
                if (offlineDuration >= 3 * 60 * 1000) {
                    // Confirmed offline > 3 mins
                    console.log(`[${new Date().toLocaleString()}] ${liveInfo.uname} confirmed offline.`);
                    user.isLive = false;
                    user.lastLiveEnd = user.offlineSince; // Use the time we first detected offline
                    user.offlineSince = 0;

                    const duration = user.lastLiveStart ? (user.lastLiveEnd - user.lastLiveStart) : 0;
                    const durationStr = formatDuration(duration);
                    
                    let msg = '';
                    const variables = {
                        name: liveInfo.uname,
                        duration: durationStr
                    };

                    if (user.liveEndMsg) {
                        msg = formatMessage(user.liveEndMsg, variables);
                    } else {
                        msg = `${liveInfo.uname} 下播了。\n本次直播时长：${durationStr}`;
                    }
                    
                    if (user.notifyLiveEnd !== false) {
                        for (const groupId of user.targetGroups) {
                            await napcat.sendGroupMsg(groupId, msg);
                        }
                        if (user.targetPrivate) {
                            for (const userId of user.targetPrivate) {
                                await napcat.sendPrivateMsg(userId, msg);
                            }
                        }
                    }
                }
            }
        } else {
            // Was Offline -> Still Offline
            if (user.offlineSince) {
                user.offlineSince = 0; // Should be 0, but ensure cleanup
            }
        }
    }
}

async function checkDynamics(user) {
    if (!user.monitorDynamic) return;

    const dynamics = await biliApi.getSpaceDynamics(user.mid, config.data.cookie);
    if (!dynamics || dynamics.code !== 0 || !dynamics.data.items) return;

    let items = dynamics.data.items;
    if (items.length === 0) return;

    // Filter out pinned dynamics (manually pinned) and live start dynamics
    items = items.filter(item => {
        const isPinned = item.modules.module_tag && item.modules.module_tag.text === '置顶';
        const isLive = item.type === 'DYNAMIC_TYPE_LIVE_RCMD';
        return !isPinned && !isLive;
    });

    if (items.length === 0) return;

    // Sort by ID just in case, though usually sorted by time
    // items.sort((a, b) => BigInt(b.id_str) - BigInt(a.id_str));

    const latest = items[0];
    const latestId = latest.id_str;

    if (!user.lastDynamicId) {
        // First run
        if (user.notifyMissed) {
            // If notifyMissed is enabled, process the latest dynamic
            // We treat the latest one as "new"
            // Note: We only take the latest one to avoid spamming if there are multiple "missed" ones
            // or we could take all? Let's stick to latest for safety.
            // Actually, items[0] is the latest.
            // We need to set lastDynamicId to the one *before* it to trigger the loop?
            // No, we can just manually push it to newItems and let the loop handle it.
            // But we need to be careful about setting lastDynamicId.
            
            // Let's just pretend lastDynamicId was the one before the latest (if exists)
            // or just 0.
            // But if we set it to 0, we might get 12 items.
            // Let's just push the latest item to newItems and set lastDynamicId to the one before it (or 0)
            // effectively.
            
            // Simpler approach:
            // Just add the latest item to newItems list directly.
            // And ensure we don't return early.
            
            // But wait, the loop below filters based on lastDynamicId.
            // So we need to set lastDynamicId to something smaller than latestId.
            // If items has > 1 element, use items[1].id_str.
            // If items has 1 element, use 0.
            
            if (items.length > 1) {
                user.lastDynamicId = items[1].id_str;
            } else {
                user.lastDynamicId = '0';
            }
            // Now the logic below will pick up items[0] (and maybe others if we set it to 0)
            // If we set it to items[1].id_str, it will pick up items[0].
        } else {
            // Default behavior: just save the latest ID and silent
            user.lastDynamicId = latestId;
            return;
        }
    }

    if (BigInt(latestId) <= BigInt(user.lastDynamicId)) {
        return; // No new dynamic
    }

    // Find all new dynamics
    const newItems = [];
    for (const item of items) {
        if (BigInt(item.id_str) > BigInt(user.lastDynamicId)) {
            newItems.push(item);
        } else {
            break;
        }
    }

    // Process new items (oldest first)
    for (let i = newItems.length - 1; i >= 0; i--) {
        const item = newItems[i];
        
        // Check if it's a retry
        let isRetry = false;
        if (retryMap.has(user.mid) && retryMap.get(user.mid).has(item.id_str)) {
            isRetry = true;
        }

        let msg = await parseDynamic(item, user);
        if (isRetry) {
            msg = '<补发>\n' + msg;
        }

        if (msg) {
            let sendSuccess = false;
            
            // Send to groups
            for (const groupId of user.targetGroups) {
                let groupMsg = msg;
                if (user.atAllDynamic) {
                    groupMsg = `[CQ:at,qq=all]\n${groupMsg}`;
                }
                try {
                    await napcat.sendGroupMsg(groupId, groupMsg);
                    sendSuccess = true;
                } catch (e) {
                    console.error(`Failed to send dynamic to group ${groupId}:`, e.message);
                }
            }
            
            // Send to private
            if (user.targetPrivate) {
                for (const userId of user.targetPrivate) {
                    try {
                        await napcat.sendPrivateMsg(userId, msg);
                        sendSuccess = true;
                    } catch (e) {
                        console.error(`Failed to send dynamic to private ${userId}:`, e.message);
                    }
                }
            }

            // Only update lastDynamicId if at least one message was sent successfully
            // If all failed (e.g. network error), we don't update, so it will retry next time
            if (sendSuccess) {
                user.lastDynamicId = item.id_str;
                // Remove from retryMap
                if (retryMap.has(user.mid)) {
                    retryMap.get(user.mid).delete(item.id_str);
                }
            } else {
                console.warn(`Failed to send dynamic ${item.id_str} to any target, will retry next time.`);
                // Add to retryMap
                if (!retryMap.has(user.mid)) {
                    retryMap.set(user.mid, new Set());
                }
                retryMap.get(user.mid).add(item.id_str);
                
                // Stop processing newer items to maintain order
                break;
            }
        }
    }
    
    // Note: We no longer update user.lastDynamicId = latestId at the end
    // It is updated incrementally inside the loop upon success
}

async function parseDynamic(item, user) {
    const author = item.modules.module_author.name;
    const dynamicModule = item.modules.module_dynamic;
    
    let images = [];
    let jumpUrl = `https://t.bilibili.com/${item.id_str}`;

    if (dynamicModule.major) {
        const major = dynamicModule.major;
        if (major.opus && major.opus.pics) {
            // Text + Images (New Opus)
            images = major.opus.pics.map(p => p.url);
            jumpUrl = `https://www.bilibili.com/opus/${item.id_str}`;
        } else if (major.archive) {
            // Video
            images = [major.archive.cover];
            jumpUrl = `https://www.bilibili.com/video/${major.archive.bvid}`;
        } else if (major.draw && major.draw.items) {
            // Old Draw
            images = major.draw.items.map(i => i.src);
        } else if (major.article) {
            // Article
            images = major.article.covers;
            jumpUrl = `https://www.bilibili.com/read/cv${major.article.id}`;
        }
    }

    let msg = '';
    let imageCQ = '';

    try {
        const imageBuffer = await generateDynamicCard(item);
        const base64 = imageBuffer.toString('base64');
        imageCQ = `[CQ:image,file=base64://${base64}]`;
    } catch (error) {
        console.error('Error generating dynamic card:', error);
        // Fallback to first image if generation fails
        if (images.length > 0) {
            imageCQ = `[CQ:image,file=${images[0]}]`;
        }
    }

    const variables = {
        name: author,
        link: jumpUrl,
        image: imageCQ
    };

    if (user && user.dynamicMsg) {
        msg = formatMessage(user.dynamicMsg, variables);
    } else {
        // Default format
        msg = `${author} 发新动态了\n${jumpUrl}\n${imageCQ}`;
    }

    return msg;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}小时${m}分${s}秒`;
}

export async function startBot() {
    console.log('Bot started...');
    
    const runChecks = async () => {
        const now = new Date().toLocaleString();
        const statusSummaries = [];
        
        for (const user of config.data.users) {
            try {
                await checkLiveStatus(user);
                await checkDynamics(user);

                let status = 'Offline';
                if (user.isLive) {
                    if (user.offlineSince > 0) {
                        status = 'Waiting'; // Waiting for 3 mins confirmation
                    } else {
                        status = 'Live';
                    }
                }
                statusSummaries.push(`${user.uname || user.mid}(${status})`);

            } catch (error) {
                console.error(`[${now}] Error checking user ${user.uname || user.mid}:`, error);
                statusSummaries.push(`${user.uname || user.mid}(Error)`);
            }
        }
        
        console.log(`[${now}] Checked: ${statusSummaries.join(', ')}`);
        
        // Save state changes (isLive, lastDynamicId, etc.) to disk
        config.save();
        
        if (isFirstRun) isFirstRun = false;
    };

    // Run immediately on startup
    await runChecks();

    // Then run on interval
    setInterval(runChecks, POLL_INTERVAL);
}
