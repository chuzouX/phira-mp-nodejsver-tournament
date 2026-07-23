"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const tournaments = new Map();
const unsubscribers = [];
const DATA_DIR = path.join('data', 'tournament');
function p(val) {
    return Array.isArray(val) ? val[0] : (val ?? '');
}
function generateTournamentInfo(tournament) {
    const stateLabel = tournament.state === 'pending' ? '未开始' : tournament.state === 'active' ? '进行中' : '已结束';
    const lines = [
        `【${tournament.name}】`,
        `ID: ${tournament.id}`,
        `状态: ${stateLabel}`,
        `计分模式: ${tournament.scoreMode === 'best' ? '最佳成绩' : '累计成绩'}`,
        `参赛人数: ${tournament.participants.size}`,
        `房间 ID: ${tournament.roomId}`,
    ];
    if (tournament.startTime) {
        lines.push(`开始时间: ${new Date(tournament.startTime).toLocaleString()}`);
    }
    if (tournament.endTime) {
        lines.push(`结束时间: ${new Date(tournament.endTime).toLocaleString()}`);
    }
    return lines.join('\n');
}
function getLeaderboard(tournament) {
    let entries = [...tournament.entries];
    if (tournament.scoreMode === 'best') {
        const bestEntries = new Map();
        for (const entry of entries) {
            const existing = bestEntries.get(entry.userId);
            if (!existing || entry.score > existing.score) {
                bestEntries.set(entry.userId, entry);
            }
        }
        entries = Array.from(bestEntries.values());
    }
    else {
        const sumEntries = new Map();
        for (const entry of entries) {
            const existing = sumEntries.get(entry.userId);
            if (existing) {
                existing.score += entry.score;
                existing.accuracy =
                    (existing.accuracy * existing.count + entry.accuracy) / (existing.count + 1);
                existing.count++;
                existing.lastEntry = entry;
            }
            else {
                sumEntries.set(entry.userId, {
                    score: entry.score,
                    accuracy: entry.accuracy,
                    count: 1,
                    lastEntry: entry,
                });
            }
        }
        entries = Array.from(sumEntries.values()).map((s) => ({
            ...s.lastEntry,
            score: s.score,
            accuracy: s.accuracy,
        }));
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId,
        userName: entry.userName,
        score: entry.score,
        accuracy: entry.accuracy,
        chartId: entry.chartId,
        chartName: entry.chartName,
        submittedAt: entry.submittedAt,
    }));
}
async function ensureDataDir() {
    await fs_1.promises.mkdir(DATA_DIR, { recursive: true });
}
async function saveData() {
    await ensureDataDir();
    const serialized = Array.from(tournaments.values()).map((t) => ({
        ...t,
        participants: Array.from(t.participants.values()),
    }));
    const filePath = path.join(DATA_DIR, 'tournaments.json');
    await fs_1.promises.writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
}
async function loadData() {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, 'tournaments.json');
    try {
        const data = await fs_1.promises.readFile(filePath, 'utf-8');
        const serialized = JSON.parse(data);
        for (const item of serialized) {
            const participants = new Map();
            for (const participant of item.participants) {
                participants.set(participant.userId, participant);
            }
            tournaments.set(item.id, {
                ...item,
                participants,
            });
        }
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('[比赛插件] 加载比赛数据失败:', err);
        }
    }
}
const pluginModule = {
    name: 'tournament',
    async init(api) {
        const cfg = api.readPluginConfig() ?? {};
        const defaultScoreMode = cfg.defaultScoreMode ?? 'best';
        const maxLeaderboardEntries = cfg.maxLeaderboardEntries ?? 1000;
        await loadData();
        api.logger.info(`[比赛插件] 已加载，共 ${tournaments.size} 个比赛`);
        function verifyAesCbcToken(token, secret) {
            try {
                const encryptedBuffer = Buffer.from(token, 'hex');
                if (encryptedBuffer.length < 17)
                    return false;
                const iv = encryptedBuffer.subarray(0, 16);
                const ciphertext = encryptedBuffer.subarray(16);
                const key = crypto_1.default.createHash('sha256').update(secret).digest();
                const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', key, iv);
                let decrypted = decipher.update(ciphertext);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                const dateStr = new Date().toISOString().substring(0, 10);
                const expectedPlain = `${dateStr}_${secret}_xy521`;
                return decrypted.toString('utf-8') === expectedPlain;
            }
            catch {
                return false;
            }
        }
        function requireAdmin(handler) {
            return (req, res) => {
                const adminAuth = api.adminSecretAuthMiddleware;
                if (adminAuth) {
                    return adminAuth(req, res, () => handler(req, res));
                }
                const adminSecret = process.env.ADMIN_SECRET;
                if (!adminSecret) {
                    res.status(500).json({ error: 'ADMIN_SECRET not configured' });
                    return;
                }
                const secretHeader = req.headers['x-admin-secret'];
                if (!secretHeader) {
                    res.status(401).json({ error: 'Unauthorized: Missing x-admin-secret header' });
                    return;
                }
                if (verifyAesCbcToken(secretHeader, adminSecret)) {
                    return handler(req, res);
                }
                const timestampHeader = req.headers['x-admin-timestamp'];
                if (timestampHeader) {
                    const timestamp = parseInt(timestampHeader, 10);
                    const now = Math.floor(Date.now() / 1000);
                    if (Math.abs(now - timestamp) <= 300) {
                        const expectedHash = crypto_1.default
                            .createHash('sha256')
                            .update(adminSecret + timestamp)
                            .digest('hex');
                        if (secretHeader === expectedHash) {
                            return handler(req, res);
                        }
                    }
                }
                res.status(401).json({ error: 'Unauthorized: Invalid admin secret' });
            };
        }
        unsubscribers.push(api.events.on('room:gameEnd', async ({ room, rankings }) => {
            let changed = false;
            for (const tournament of tournaments.values()) {
                if (tournament.state !== 'active')
                    continue;
                for (const ranking of rankings) {
                    const participant = tournament.participants.get(ranking.userId);
                    if (!participant)
                        continue;
                    const chartId = room.selectedChart?.id ?? 0;
                    const chartName = room.selectedChart?.name;
                    const entry = {
                        userId: ranking.userId,
                        userName: ranking.userName,
                        score: ranking.score,
                        accuracy: ranking.accuracy,
                        chartId,
                        chartName,
                        submittedAt: Date.now(),
                    };
                    tournament.entries.push(entry);
                    if (tournament.entries.length > maxLeaderboardEntries) {
                        tournament.entries.sort((a, b) => b.score - a.score);
                        tournament.entries = tournament.entries.slice(0, maxLeaderboardEntries);
                    }
                    changed = true;
                    api.logger.debug(`[比赛插件] 比赛 ${tournament.id} 记录成绩: ${ranking.userName} - ${ranking.score}`);
                }
            }
            if (changed)
                await saveData();
        }));
        unsubscribers.push(api.events.on('room:beforeCreate', ({ roomId, userId }) => {
            for (const tournament of tournaments.values()) {
                if (tournament.roomId !== roomId)
                    continue;
                const player = api.getPlayer(userId);
                const userName = player?.name ?? `用户${userId}`;
                if (!tournament.participants.has(userId)) {
                    api.sendCommandToUser(userId, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: '你并未参加此次的锦标赛',
                        },
                    });
                    api.logger.info(`[比赛插件] 非参赛玩家 ${userName}(${userId}) 尝试创建锦标赛房间 ${roomId}，已被拒绝`);
                    return;
                }
                api.sendCommandToUser(userId, {
                    type: 5,
                    message: {
                        type: 'Chat',
                        user: -1,
                        content: '点击确定查看比赛详情',
                    },
                });
                const stateLabel = tournament.state === 'pending'
                    ? '未开始'
                    : tournament.state === 'active'
                        ? '进行中'
                        : '已结束';
                const lines = [
                    `【${tournament.name}】`,
                    `ID: ${tournament.id}`,
                    `状态: ${stateLabel}`,
                    `计分模式: ${tournament.scoreMode === 'best' ? '最佳成绩' : '累计成绩'}`,
                    `参赛人数: ${tournament.participants.size}`,
                    `房间 ID: ${tournament.roomId}`,
                ];
                if (tournament.startTime) {
                    lines.push(`开始时间: ${new Date(tournament.startTime).toLocaleString()}`);
                }
                setTimeout(() => {
                    api.sendCommandToUser(userId, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: lines.join('\n'),
                        },
                    });
                }, 500);
                api.logger.info(`[比赛插件] 参赛玩家 ${userName}(${userId}) 尝试创建锦标赛房间 ${roomId}，已提示查看比赛详情`);
                return;
            }
        }));
        unsubscribers.push(api.events.on('room:join', ({ room, user }) => {
            for (const tournament of tournaments.values()) {
                if (tournament.roomId !== room.id)
                    continue;
                if (!tournament.participants.has(user.id)) {
                    api.sendCommandToUser(user.id, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: '你并未参加此次的锦标赛，无法加入该房间',
                        },
                    });
                    api.roomManager.removePlayerFromRoom(room.id, user.id);
                    api.logger.info(`[比赛插件] 非参赛玩家 ${user.name}(${user.id}) 尝试加入锦标赛房间 ${room.id}，已被拒绝`);
                }
                else {
                    const stateLabel = tournament.state === 'pending'
                        ? '未开始'
                        : tournament.state === 'active'
                            ? '进行中'
                            : '已结束';
                    const lines = [
                        `【${tournament.name}】`,
                        `ID: ${tournament.id}`,
                        `状态: ${stateLabel}`,
                        `计分模式: ${tournament.scoreMode === 'best' ? '最佳成绩' : '累计成绩'}`,
                        `参赛人数: ${tournament.participants.size}`,
                        `房间 ID: ${tournament.roomId}`,
                    ];
                    if (tournament.startTime) {
                        lines.push(`开始时间: ${new Date(tournament.startTime).toLocaleString()}`);
                    }
                    api.sendCommandToUser(user.id, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: lines.join('\n'),
                        },
                    });
                    api.logger.info(`[比赛插件] 已向玩家 ${user.name} 播报比赛 ${tournament.id} 详情`);
                }
            }
        }));
        api.registerCommand('tournament', async (...args) => {
            if (args.length === 0) {
                api.logger.info('[比赛插件] 可用命令:');
                api.logger.info('  tournament list                           - 列出所有比赛');
                api.logger.info('  tournament create <id> <name> <roomId>    - 创建比赛');
                api.logger.info('  tournament info <id>                      - 查看比赛详情');
                api.logger.info('  tournament start <id>              - 开始比赛');
                api.logger.info('  tournament end <id>                - 结束比赛');
                api.logger.info('  tournament delete <id>             - 删除比赛');
                api.logger.info('  tournament register <id> <userId>  - 注册选手');
                api.logger.info('  tournament invite <id> <userId>    - 邀请选手');
                api.logger.info('  tournament unregister <id> <userId> - 取消注册');
                api.logger.info('  tournament leaderboard <id>        - 显示排行榜');
                return;
            }
            const subcommand = args[0];
            switch (subcommand) {
                case 'list': {
                    if (tournaments.size === 0) {
                        api.logger.info('[比赛插件] 暂无比赛');
                        return;
                    }
                    api.logger.info(`[比赛插件] 共有 ${tournaments.size} 个比赛:`);
                    for (const [id, t] of tournaments) {
                        api.logger.info(`  - ${id} (${t.name}) [${t.state}]`);
                    }
                    break;
                }
                case 'create': {
                    const id = args[1];
                    const roomId = args[args.length - 1];
                    const name = args.slice(2, -1).join(' ');
                    if (!id || !roomId || !name) {
                        api.logger.error('[比赛插件] 使用方法: tournament create <id> <name> <roomId>');
                        return;
                    }
                    if (tournaments.has(id)) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 已存在`);
                        return;
                    }
                    if (api.roomManager.getRoom(roomId)) {
                        api.logger.error(`[比赛插件] 房间 ${roomId} 已存在`);
                        return;
                    }
                    const tournament = {
                        id,
                        name,
                        roomId,
                        createdAt: Date.now(),
                        state: 'pending',
                        participants: new Map(),
                        entries: [],
                        scoreMode: defaultScoreMode,
                    };
                    tournaments.set(id, tournament);
                    await saveData();
                    const whitelist = Array.from(tournament.participants.keys());
                    try {
                        api.roomManager.createRoom({
                            id: roomId,
                            name: roomId,
                            ownerId: -1,
                            ownerInfo: { id: -1, name: '锦标赛系统', monitor: false },
                            connectionId: '',
                            maxPlayers: 32,
                        });
                        api.roomManager.setRoomWhitelist(roomId, whitelist);
                        api.logger.info(`[比赛插件] 比赛 ${id} (${name}) 创建成功，房间ID: ${roomId}，白名单人数: ${whitelist.length}`);
                    }
                    catch (err) {
                        tournaments.delete(id);
                        await saveData();
                        api.logger.error(`[比赛插件] 创建比赛房间失败: ${err}`);
                    }
                    break;
                }
                case 'info': {
                    const id = args[1];
                    if (!id) {
                        api.logger.error('[比赛插件] 使用方法: tournament info <id>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    api.logger.info(`[比赛插件] 比赛详情:`);
                    api.logger.info(`  ID: ${tournament.id}`);
                    api.logger.info(`  名称: ${tournament.name}`);
                    api.logger.info(`  状态: ${tournament.state}`);
                    api.logger.info(`  创建时间: ${new Date(tournament.createdAt).toLocaleString()}`);
                    if (tournament.startTime) {
                        api.logger.info(`  开始时间: ${new Date(tournament.startTime).toLocaleString()}`);
                    }
                    if (tournament.endTime) {
                        api.logger.info(`  结束时间: ${new Date(tournament.endTime).toLocaleString()}`);
                    }
                    api.logger.info(`  选手数量: ${tournament.participants.size}`);
                    api.logger.info(`  成绩记录: ${tournament.entries.length}`);
                    api.logger.info(`  计分模式: ${tournament.scoreMode === 'best' ? '最佳成绩' : '累计成绩'}`);
                    break;
                }
                case 'start': {
                    const id = args[1];
                    if (!id) {
                        api.logger.error('[比赛插件] 使用方法: tournament start <id>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    if (tournament.state === 'active') {
                        api.logger.error(`[比赛插件] 比赛 ${id} 已经在进行中`);
                        return;
                    }
                    if (tournament.state === 'ended') {
                        api.logger.error(`[比赛插件] 比赛 ${id} 已经结束`);
                        return;
                    }
                    tournament.state = 'active';
                    tournament.startTime = Date.now();
                    await saveData();
                    api.logger.info(`[比赛插件] 比赛 ${id} 已开始`);
                    break;
                }
                case 'end': {
                    const id = args[1];
                    if (!id) {
                        api.logger.error('[比赛插件] 使用方法: tournament end <id>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    if (tournament.state !== 'active') {
                        api.logger.error(`[比赛插件] 比赛 ${id} 未在进行中`);
                        return;
                    }
                    tournament.state = 'ended';
                    tournament.endTime = Date.now();
                    await saveData();
                    api.logger.info(`[比赛插件] 比赛 ${id} 已结束`);
                    const leaderboard = getLeaderboard(tournament);
                    if (leaderboard.length > 0) {
                        api.logger.info(`[比赛插件] 比赛 ${id} 最终排名:`);
                        for (let i = 0; i < Math.min(10, leaderboard.length); i++) {
                            const entry = leaderboard[i];
                            api.logger.info(`  ${i + 1}. ${entry.userName} - 分数: ${entry.score}, 准确率: ${entry.accuracy.toFixed(2)}%`);
                        }
                    }
                    break;
                }
                case 'delete': {
                    const id = args[1];
                    if (!id) {
                        api.logger.error('[比赛插件] 使用方法: tournament delete <id>');
                        return;
                    }
                    if (!tournaments.has(id)) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    tournaments.delete(id);
                    await saveData();
                    api.logger.info(`[比赛插件] 比赛 ${id} 已删除`);
                    break;
                }
                case 'register': {
                    const id = args[1];
                    const userId = parseInt(args[2]);
                    if (!id || isNaN(userId)) {
                        api.logger.error('[比赛插件] 使用方法: tournament register <id> <userId>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    if (tournament.participants.has(userId)) {
                        api.logger.error(`[比赛插件] 用户 ${userId} 已注册`);
                        return;
                    }
                    const player = api.getPlayer(userId);
                    const userName = player?.name ?? `用户${userId}`;
                    tournament.participants.set(userId, {
                        userId,
                        userName,
                        registeredAt: Date.now(),
                    });
                    await saveData();
                    if (tournament.roomId) {
                        const whitelist = Array.from(tournament.participants.keys());
                        api.roomManager.setRoomWhitelist(tournament.roomId, whitelist);
                    }
                    const info = generateTournamentInfo(tournament);
                    api.sendCommandToUser(userId, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: `你已成功注册参加比赛！\n${info}`,
                        },
                    });
                    api.logger.info(`[比赛插件] 用户 ${userName} (${userId}) 已注册到比赛 ${id}`);
                    break;
                }
                case 'invite': {
                    const id = args[1];
                    const userId = parseInt(args[2]);
                    if (!id || isNaN(userId)) {
                        api.logger.error('[比赛插件] 使用方法: tournament invite <id> <userId>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    const player = api.getPlayer(userId);
                    const userName = player?.name ?? `用户${userId}`;
                    tournament.participants.set(userId, {
                        userId,
                        userName,
                        registeredAt: Date.now(),
                        isInvited: true,
                    });
                    await saveData();
                    if (tournament.roomId) {
                        const whitelist = Array.from(tournament.participants.keys());
                        api.roomManager.setRoomWhitelist(tournament.roomId, whitelist);
                    }
                    const info = generateTournamentInfo(tournament);
                    api.sendCommandToUser(userId, {
                        type: 5,
                        message: {
                            type: 'Chat',
                            user: -1,
                            content: `你已被邀请参加比赛！\n${info}`,
                        },
                    });
                    api.logger.info(`[比赛插件] 用户 ${userName} (${userId}) 已被邀请到比赛 ${id}`);
                    break;
                }
                case 'unregister': {
                    const id = args[1];
                    const userId = parseInt(args[2]);
                    if (!id || isNaN(userId)) {
                        api.logger.error('[比赛插件] 使用方法: tournament unregister <id> <userId>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    const participant = tournament.participants.get(userId);
                    if (!participant) {
                        api.logger.error(`[比赛插件] 用户 ${userId} 未注册`);
                        return;
                    }
                    tournament.participants.delete(userId);
                    await saveData();
                    if (tournament.roomId) {
                        const whitelist = Array.from(tournament.participants.keys());
                        api.roomManager.setRoomWhitelist(tournament.roomId, whitelist);
                    }
                    api.logger.info(`[比赛插件] 用户 ${participant.userName} (${userId}) 已取消注册`);
                    break;
                }
                case 'leaderboard': {
                    const id = args[1];
                    if (!id) {
                        api.logger.error('[比赛插件] 使用方法: tournament leaderboard <id>');
                        return;
                    }
                    const tournament = tournaments.get(id);
                    if (!tournament) {
                        api.logger.error(`[比赛插件] 比赛 ${id} 不存在`);
                        return;
                    }
                    const leaderboard = getLeaderboard(tournament);
                    if (leaderboard.length === 0) {
                        api.logger.info(`[比赛插件] 比赛 ${id} 暂无成绩记录`);
                        return;
                    }
                    api.logger.info(`[比赛插件] 比赛 ${id} 排行榜:`);
                    for (let i = 0; i < Math.min(10, leaderboard.length); i++) {
                        const entry = leaderboard[i];
                        api.logger.info(`  ${i + 1}. ${entry.userName} - 分数: ${entry.score}, 准确率: ${entry.accuracy.toFixed(2)}%`);
                    }
                    break;
                }
                default:
                    api.logger.error(`[比赛插件] 未知命令: ${subcommand}`);
            }
        });
        api.registerRoute('get', '/api/tournament/list', requireAdmin((_req, res) => {
            const list = Array.from(tournaments.values()).map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                roomId: t.roomId,
                state: t.state,
                participantCount: t.participants.size,
                entryCount: t.entries.length,
                createdAt: t.createdAt,
                startTime: t.startTime,
                endTime: t.endTime,
            }));
            res.json({ success: true, data: list });
        }));
        api.registerRoute('post', '/api/tournament', requireAdmin(async (req, res) => {
            const { id, name, roomId, description, scoreMode = defaultScoreMode } = req.body;
            if (!id || !name || !roomId) {
                res.status(400).json({ success: false, message: '缺少必要参数: id, name, roomId' });
                return;
            }
            if (tournaments.has(id)) {
                res.status(400).json({ success: false, message: `比赛 ${id} 已存在` });
                return;
            }
            const tournament = {
                id,
                name,
                roomId,
                description,
                createdAt: Date.now(),
                state: 'pending',
                participants: new Map(),
                entries: [],
                scoreMode: scoreMode,
            };
            tournaments.set(id, tournament);
            await saveData();
            res.json({ success: true, message: `比赛 ${id} 创建成功` });
        }));
        api.registerRoute('get', '/api/tournament/:id', requireAdmin((req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            res.json({
                success: true,
                data: {
                    id: tournament.id,
                    name: tournament.name,
                    description: tournament.description,
                    roomId: tournament.roomId,
                    state: tournament.state,
                    createdAt: tournament.createdAt,
                    startTime: tournament.startTime,
                    endTime: tournament.endTime,
                    participantCount: tournament.participants.size,
                    entryCount: tournament.entries.length,
                    scoreMode: tournament.scoreMode,
                },
            });
        }));
        api.registerRoute('put', '/api/tournament/:id/start', requireAdmin(async (req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            if (tournament.state === 'active') {
                res.status(400).json({ success: false, message: '比赛已经在进行中' });
                return;
            }
            if (tournament.state === 'ended') {
                res.status(400).json({ success: false, message: '比赛已经结束' });
                return;
            }
            tournament.state = 'active';
            tournament.startTime = Date.now();
            await saveData();
            res.json({ success: true, message: '比赛已开始' });
        }));
        api.registerRoute('put', '/api/tournament/:id/end', requireAdmin(async (req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            if (tournament.state !== 'active') {
                res.status(400).json({ success: false, message: '比赛未在进行中' });
                return;
            }
            tournament.state = 'ended';
            tournament.endTime = Date.now();
            await saveData();
            res.json({ success: true, message: '比赛已结束' });
        }));
        api.registerRoute('delete', '/api/tournament/:id', requireAdmin(async (req, res) => {
            const id = p(req.params.id);
            if (!tournaments.has(id)) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            tournaments.delete(id);
            await saveData();
            res.json({ success: true, message: '比赛已删除' });
        }));
        api.registerRoute('post', '/api/tournament/:id/register', requireAdmin(async (req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            const { userId } = req.body;
            if (!userId) {
                res.status(400).json({ success: false, message: '缺少 userId 参数' });
                return;
            }
            if (tournament.participants.has(userId)) {
                res.status(400).json({ success: false, message: '用户已注册' });
                return;
            }
            const player = api.getPlayer(userId);
            const userName = player?.name ?? `用户${userId}`;
            tournament.participants.set(userId, {
                userId,
                userName,
                registeredAt: Date.now(),
            });
            await saveData();
            res.json({ success: true, message: `用户 ${userName} 已注册` });
        }));
        api.registerRoute('post', '/api/tournament/:id/invite', requireAdmin(async (req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            const { userId } = req.body;
            if (!userId) {
                res.status(400).json({ success: false, message: '缺少 userId 参数' });
                return;
            }
            const player = api.getPlayer(userId);
            const userName = player?.name ?? `用户${userId}`;
            tournament.participants.set(userId, {
                userId,
                userName,
                registeredAt: Date.now(),
                isInvited: true,
            });
            await saveData();
            res.json({ success: true, message: `用户 ${userName} 已被邀请` });
        }));
        api.registerRoute('delete', '/api/tournament/:id/register/:userId', requireAdmin(async (req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            const userId = parseInt(p(req.params.userId));
            if (isNaN(userId)) {
                res.status(400).json({ success: false, message: '无效的 userId' });
                return;
            }
            const participant = tournament.participants.get(userId);
            if (!participant) {
                res.status(400).json({ success: false, message: '用户未注册' });
                return;
            }
            tournament.participants.delete(userId);
            await saveData();
            res.json({ success: true, message: `用户 ${participant.userName} 已取消注册` });
        }));
        api.registerRoute('get', '/api/tournament/:id/leaderboard', requireAdmin((req, res) => {
            const tournament = tournaments.get(p(req.params.id));
            if (!tournament) {
                res.status(404).json({ success: false, message: '比赛不存在' });
                return;
            }
            const leaderboard = getLeaderboard(tournament);
            res.json({ success: true, data: leaderboard });
        }));
        if (!cfg.defaultScoreMode) {
            api.writePluginConfig({
                defaultScoreMode,
                maxLeaderboardEntries,
                announceResults: cfg.announceResults ?? true,
                resultAnnouncementChannel: cfg.resultAnnouncementChannel ?? 'all',
            });
        }
    },
    async destroy() {
        unsubscribers.forEach((unsub) => unsub());
        unsubscribers.length = 0;
        await saveData();
        tournaments.clear();
    },
};
exports.default = pluginModule;
