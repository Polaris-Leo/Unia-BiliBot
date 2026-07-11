import { config } from './config.js';
import * as biliApi from './bili-api.js';
import * as napcat from './napcat.js';
import * as logger from './logger.js';
import { generateDynamicCard } from './image-generator.js';

const POLL_INTERVAL = 30 * 1000; // Increased to 60 seconds for performance
const retryMap = new Map(); // mid -> Map<dynamicId, retryCount>
const MAX_RETRIES = 3;
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
            config.save();
            // Don't return, let it fall through to ensure clean state
        }
    }

    if (isNowLive) {
        // Currently Live

        // Check for stale session data (Bot restart after missed offline event)
        // Only check if we are NOT currently tracking a disconnection (offlineSince == 0)
        if (user.isLive && liveInfo.live_time && !user.offlineSince) {
            const apiLiveStart = liveInfo.live_time * 1000;
            // If the API says the stream started more than 2 minutes after our recorded start time,
            // it must be a new session.
            if (apiLiveStart > user.lastLiveStart + 2 * 60 * 1000) {
                console.log(`[${new Date().toLocaleString()}] Detected stale session for ${liveInfo.uname}. Resetting status to trigger notification.`);
                user.isLive = false;
            }
        }

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
            
            // Always update lastLiveStart to the latest live_time from API (or now)
            // This prevents the "stale session" check from infinitely looping during a resume
            user.lastLiveStart = (liveInfo.live_time && liveInfo.live_time > 0) ? liveInfo.live_time * 1000 : now;

            user.offlineSince = 0;
            
            let defaultMsg = '';
            const variables = {
                name: liveInfo.uname,
                title: liveInfo.title,
                room_id: liveInfo.room_id,
                link: `https://live.bilibili.com/${liveInfo.room_id}`,
                cover: `[CQ:image,file=${liveInfo.cover_from_user}]`
            };

            if (msgType === 'resume') {
                if (user.liveResumeMsg) {
                    defaultMsg = formatMessage(user.liveResumeMsg, variables);
                } else {
                    defaultMsg = `${liveInfo.uname} 已重新开播！【${liveInfo.title}】\nhttps://live.bilibili.com/${liveInfo.room_id}\n[CQ:image,file=${liveInfo.cover_from_user}]`;
                }
            } else {
                if (user.liveStartMsg) {
                    defaultMsg = formatMessage(user.liveStartMsg, variables);
                } else {
                    defaultMsg = `${liveInfo.uname} 开播啦！\n『${liveInfo.title}』\nhttps://live.bilibili.com/${liveInfo.room_id}\n[CQ:image,file=${liveInfo.cover_from_user}]`;
                }
            }
            
            if (user.notifyLiveStart !== false) {
                const timeSinceStart = Date.now() - user.lastLiveStart;
                
                // Only enforce the 10-minute rule for FRESH starts.
                // Resumes should always notify because the "resume event" just happened.
                let shouldNotify = true;
                if (msgType === 'start' && timeSinceStart > 10 * 60 * 1000) {
                    shouldNotify = false;
                }

                if (!shouldNotify) {
                    console.log(`[${new Date().toLocaleString()}] Live start notification skipped: started ${Math.round(timeSinceStart/60000)} mins ago (> 10 mins).`);
                } else {
                    console.log(`[${new Date().toLocaleString()}] Sending live start notification for ${liveInfo.uname}`);
                    
                    logger.logEvent('live_start', user, {
                        title: liveInfo.title,
                        roomId: liveInfo.room_id,
                        msgType: msgType
                    });

                    
                    let sendResults = [];

                    const sendToTarget = async (target, type) => {
                        const isObj = typeof target === 'object';
                        const config = isObj ? target : { id: target };
                        
                        // Check override toggle
                        if (config.monitorLive === false) return; // explicit disable
                        if (config.monitorLiveStart === false) return; // New explicit disable for start
                        
                        // Determine Msg
                        let msg = defaultMsg;
                        if (msgType === 'resume') {
                            if (config.liveResumeMsg) {
                                msg = formatMessage(config.liveResumeMsg, variables);
                            }
                        } else {
                            if (config.liveStartMsg) {
                                msg = formatMessage(config.liveStartMsg, variables);
                            }
                        }

                        // Determine At All
                        let atAll = false;
                        if (type === 'group') {
                            atAll = isObj ? (config.atAllLive) : user.atAllLive;
                        }

                        if (atAll) {
                            msg = `[CQ:at,qq=all]\n${msg}`;
                        }

                        console.log(`[Bot] Sending live start msg for ${liveInfo.uname} to ${type} ${config.id}`);

                        try {
                            if (type === 'group') {
                                await napcat.sendGroupMsg(config.id, msg);
                            } else {
                                await napcat.sendPrivateMsg(config.id, msg);
                            }
                            sendResults.push(`${type}:${config.id}(OK)`);
                        } catch (e) {
                            console.error(`Failed to send live start notification to ${type} ${config.id}:`, e.message);
                            sendResults.push(`${type}:${config.id}(Fail)`);
                        }
                    };

                    for (const group of user.targetGroups) {
                        await sendToTarget(group, 'group');
                    }
                    if (user.targetPrivate) {
                        for (const userId of user.targetPrivate) {
                            await sendToTarget(userId, 'private');
                        }
                    }

                    if (sendResults.length > 0) {
                        logger.logEvent('delivery_report', user, {
                            msgType: 'live_start',
                            results: sendResults
                        });
                    }
                }
            }
            config.save(); // Save state immediately
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
                    
                    let defaultMsg = '';
                    const variables = {
                        name: liveInfo.uname,
                        duration: durationStr
                    };

                    if (user.liveEndMsg) {
                        defaultMsg = formatMessage(user.liveEndMsg, variables);
                    } else {
                        defaultMsg = `${liveInfo.uname} 下播了。\n本次直播时长：${durationStr}`;
                    }
                    
                    if (user.notifyLiveEnd !== false) {
                        const timeSinceEnd = Date.now() - user.lastLiveEnd;
                        if (timeSinceEnd > 5 * 60 * 1000) {
                            console.log(`[${new Date().toLocaleString()}] Live end notification skipped: ended ${Math.round(timeSinceEnd/60000)} mins ago (> 5 mins).`);
                        } else {
                            logger.logEvent('live_end', user, {
                                duration: durationStr
                            });

                            const sendToTarget = async (target, type) => {
                                const isObj = typeof target === 'object';
                                const config = isObj ? target : { id: target };
                                if (config.monitorLiveEnd === false) return; // New explicit disable for end
                                if (config.monitorLive === false) return; 

                                let msg = defaultMsg;
                                if (config.liveEndMsg) {
                                    msg = formatMessage(config.liveEndMsg, variables);
                                }
                                
                                try {
                                    if (type === 'group') {
                                        await napcat.sendGroupMsg(config.id, msg);
                                    } else {
                                        await napcat.sendPrivateMsg(config.id, msg);
                                    }
                                } catch (e) {
                                    console.error(`Failed to send live end notification to ${type} ${config.id}:`, e.message);
                                }
                            };

                            for (const group of user.targetGroups) {
                                await sendToTarget(group, 'group');
                            }
                            if (user.targetPrivate) {
                                for (const userId of user.targetPrivate) {
                                    await sendToTarget(userId, 'private');
                                }
                            }
                        }
                    config.save(); // Save state immediately
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

    // Filter out live start dynamics (DYNAMIC_TYPE_LIVE_RCMD)
    // Do NOT filter pinned dynamics, because a new dynamic might be pinned immediately.
    // We rely on sorting by ID to distinguish new vs old.
    items = items.filter(item => {
        const isLive = item.type === 'DYNAMIC_TYPE_LIVE_RCMD';
        return !isLive;
    });

    if (items.length === 0) return;

    // Sort by ID descending to ensure we get the true latest
    items.sort((a, b) => {
        const idA = BigInt(a.id_str);
        const idB = BigInt(b.id_str);
        if (idA < idB) return 1;
        if (idA > idB) return -1;
        return 0;
    });

    const latest = items[0];
    const latestId = latest.id_str;
    let isHistory = false;
    if (!user.lastDynamicId) {
        // First run logic (History detection)
        isHistory = true;
        
        // Always prepare to process so per-target settings can decide
        // Set lastDynamicId to the second latest item (or 0) so the loop picks up the latest item.
        if (items.length > 1) {
            user.lastDynamicId = items[1].id_str;
        } else {
            user.lastDynamicId = '0';
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
        let retryCount = 0;
        
        if (!retryMap.has(user.mid)) {
            retryMap.set(user.mid, new Map());
        }
        const userRetryMap = retryMap.get(user.mid);

        if (userRetryMap.has(item.id_str)) {
            isRetry = true;
            retryCount = userRetryMap.get(item.id_str);
        }

        if (retryCount >= MAX_RETRIES) {
            console.warn(`Dynamic ${item.id_str} failed ${retryCount} times. Skipping.`);
            user.lastDynamicId = item.id_str; // Skip this one
            config.save();
            userRetryMap.delete(item.id_str);
            continue;
        }

        // Render the card and build target-independent variables exactly once per dynamic.
        const payload = await prepareDynamicPayload(item);
        let defaultMsg = buildDynamicMessage(item, user, payload);
        const { variables } = payload;

        if (isRetry) {
             defaultMsg = '<补发>\n' + defaultMsg;
        }

        if (defaultMsg) {
            logger.logEvent('dynamic', user, {
                id: item.id_str,
                type: item.type,
                isRetry
            });

            let sendSuccess = false;
            let sendResults = [];
            let targetCount = 0;
            let templateOverrideTargetCount = 0;

            const sendToTarget = async (target, type) => {
                const isObj = typeof target === 'object';
                const targetConfig = isObj ? target : { id: target };

                if (targetConfig.monitorDynamic === false) return;
                targetCount++;

                const hasTemplateOverride = Boolean(
                    targetConfig.dynamicMsg ||
                    targetConfig.dynamicMsg_forward ||
                    targetConfig.dynamicMsg_video ||
                    targetConfig.dynamicMsg_article
                );
                if (hasTemplateOverride) templateOverrideTargetCount++;

                // Target overrides only change message text. Reuse the already-rendered card.
                let msg = hasTemplateOverride
                    ? buildDynamicMessage(item, targetConfig, payload)
                    : defaultMsg;
                if (isRetry) msg = '<补发>\n' + msg;

                let atAll = false;
                if (type === 'group') {
                    atAll = isObj ? (targetConfig.atAllDynamic) : user.atAllDynamic;
                }

                if (atAll) {
                    msg = `[CQ:at,qq=all]\n${msg}`;
                }

                // History filter
                if (isHistory) {
                    const wantsHistory = targetConfig.monitorHistory !== undefined ? targetConfig.monitorHistory : user.notifyMissed;
                    if (!wantsHistory) return;
                }

                console.log(`[Bot] Sending dynamic msg for ${variables.name} to ${type} ${targetConfig.id}`);

                try {
                    if (type === 'group') {
                        await napcat.sendGroupMsg(targetConfig.id, msg);
                    } else {
                        await napcat.sendPrivateMsg(targetConfig.id, msg);
                    }
                    sendSuccess = true;
                    sendResults.push(`${type}:${targetConfig.id}(OK)`);
                } catch (e) {
                    console.error(`Failed to send dynamic to ${type} ${targetConfig.id}:`, e.message);
                    sendResults.push(`${type}:${targetConfig.id}(Fail)`);
                }
            };
            
            // Send to groups
            for (const group of user.targetGroups) {
                await sendToTarget(group, 'group');
            }
            
            // Send to private
            if (user.targetPrivate) {
                for (const userId of user.targetPrivate) {
                   await sendToTarget(userId, 'private');
                }
            }

            // Log the delivery report
            if (sendResults.length > 0) {
                logger.logEvent('delivery_report', user, {
                    relatedId: item.id_str,
                    msgType: 'dynamic',
                    results: sendResults
                });
            }

            logger.logEvent('dynamic_performance', user, {
                id: item.id_str,
                targetCount,
                templateOverrideTargetCount,
                cardRenderCount: 1,
                usedImageFallback: payload.usedImageFallback
            });

            // Only update lastDynamicId if at least one message was sent successfully
            // If all failed (e.g. network error), we don't update, so it will retry next time
            if (sendSuccess) {
                user.lastDynamicId = item.id_str;
                config.save(); // Save immediately to prevent duplicate sends on crash/reload
                // Remove from retryMap
                userRetryMap.delete(item.id_str);
            } else {
                console.warn(`Failed to send dynamic ${item.id_str} to any target, will retry next time.`);
                // Increment retry count
                userRetryMap.set(item.id_str, retryCount + 1);
                
                // Stop processing newer items to maintain order
                break;
            }
        }
    }
    
// Note: We need to modify parseDynamic to return variables too
    // Note: We no longer update user.lastDynamicId = latestId at the end
    // It is updated incrementally inside the loop upon success
}

async function prepareDynamicPayload(item) {
    const author = item.modules.module_author.name;
    const dynamicModule = item.modules.module_dynamic;
    
    let images = [];
    let jumpUrl = `https://t.bilibili.com/${item.id_str}`;
    let actionText = '发新动态了';

    if (item.type === 'DYNAMIC_TYPE_FORWARD') {
        actionText = '转发了动态';
    }

    if (dynamicModule.major) {
        const major = dynamicModule.major;
        if (major.opus && major.opus.pics) {
            // Text + Images (New Opus)
            images = major.opus.pics.map(p => p.url);
            jumpUrl = `https://www.bilibili.com/opus/${item.id_str}`;
        } else if (major.archive) {
            // Video
            actionText = '投稿了新视频';
            images = [major.archive.cover];
            jumpUrl = `https://www.bilibili.com/video/${major.archive.bvid}`;
        } else if (major.draw && major.draw.items) {
            // Old Draw
            images = major.draw.items.map(i => i.src);
        } else if (major.article) {
            // Article
            actionText = '发布了专栏';
            images = major.article.covers;
            jumpUrl = `https://www.bilibili.com/read/cv${major.article.id}`;
        }
    }

    let imageCQ = '';
    let usedImageFallback = false;

    try {
        // If server is slow, this fails fast and falls back to simple mode.
        const imageBuffer = await withTimeout(generateDynamicCard(item), 120000);
        const base64 = imageBuffer.toString('base64');
        imageCQ = `[CQ:image,file=base64://${base64}]`;
    } catch (error) {
        console.error(`Error generating dynamic card (author: ${author}):`, error.message);
        if (images.length > 0) {
            imageCQ = `[CQ:image,file=${images[0]}]`;
            usedImageFallback = true;
        }
    }

    return {
        variables: {
            name: author,
            link: jumpUrl,
            image: imageCQ,
            action: actionText
        },
        usedImageFallback
    };
}

function buildDynamicMessage(item, user, payload) {
    const dynamicModule = item.modules.module_dynamic;
    const { name, link, image, action } = payload.variables;
    let template = user.dynamicMsg;

    if (item.type === 'DYNAMIC_TYPE_FORWARD' && user.dynamicMsg_forward) {
        template = user.dynamicMsg_forward;
    } else if (dynamicModule.major) {
        const major = dynamicModule.major;
        if (major.archive && user.dynamicMsg_video) {
            template = user.dynamicMsg_video;
        } else if (major.article && user.dynamicMsg_article) {
            template = user.dynamicMsg_article;
        }
    }

    if (template) {
        return formatMessage(template, payload.variables);
    }

    return `${name} ${action}\n${link}\n${image}`;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}小时${m}分${s}秒`;
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Operation timed out'));
        }, ms);
        
        promise
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(reason => {
                clearTimeout(timer);
                reject(reason);
            });
    });
}

export async function startBot() {
    console.log('Bot started...');
    
    let isProcessing = false;

    const runChecks = async () => {
        if (isProcessing) {
            console.log('Skipping check cycle: Previous cycle still running.');
            return;
        }
        isProcessing = true;

        try {
            const date = new Date();
            const now = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
            const statusSummaries = [];
            
            for (const user of config.data.users) {
                try {
                    // Wrap checks in a timeout (e.g. 120 seconds per user) to prevent hanging
                    // Increased timeout to accommodate message queue delays
                    await withTimeout((async () => {
                        await checkLiveStatus(user);
                        await checkDynamics(user);
                    })(), 120000);

                    // Add a small delay between users to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));

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
        } finally {
            isProcessing = false;
        }
    };

    // Run immediately on startup
    await runChecks();

    // Then run on interval
    setInterval(runChecks, POLL_INTERVAL);
}
