const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const http = require("http");
const { Server } = require("socket.io");

const storage = require("./src/data/storage");
const tuzLogic = require("./src/games/tuzLogic");
const aviatorLogic = require("./src/games/aviatorLogic");
const backgammonLogic = require("./src/games/backgammonLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const ROOM_CONFIGS = [
    { id: "Otaq 1", bet: 0.2 },
    { id: "Otaq 2", bet: 0.5 },
    { id: "Otaq 3", bet: 1.0 },
    { id: "VİP Otaq", bet: 5.0 }
];

app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Global State
let userSockets = {};
let rooms = {};
let backgammonRooms = {};
let roomTimers = {};
let backgammonTimers = {};
let tyomnuTimers = {};
let globalAviatorPoint = 1.10;
let globalActiveBets = {};
let isBotSurge = false;

// Hər 1 saatdan bir bot axını (surge) başlasın (15 dəqiqə davam etsin)
function triggerBotSurge() {
    isBotSurge = true;
    console.log("🤖 Bot axını başladı!");
    setTimeout(() => {
        isBotSurge = false;
        console.log("🤖 Bot axını bitdi, limitlər normallaşdı.");
    }, 15 * 60 * 1000);
}
setInterval(triggerBotSurge, 60 * 60 * 1000);
// İlk axını server başlayandan 5 dəqiqə sonra yoxla
setTimeout(triggerBotSurge, 5 * 60 * 1000);

// --- BOT CONFIGURATION ---
const BOT_NAMES = [
    "Anar88", "emin_aze", "Kenan.Baku", "MasterTuz", "qarabag01", "User777",
    "AliAhmadov", "elvin.pro", "ZaurBaku", "rauf_77", "Murad19", "farid.az",
    "ilkin.n", "Ruslan22", "TuralX", "orxan_a", "fuad.ganja", "Ayxan00",
    "elnur33", "Vugar90", "KamranAz", "rashad.85", "MehmanB", "shahin77",
    "nurlan.aze", "vusal_88", "Amil12", "ElnurPro", "tofig.baku", "samir_az",
    "Nijat.88", "emil.x", "YusifBaku", "royal01", "SeymurAZE", "babek_pro",
    "namig.ganja", "agshin7", "ParvizBaku", "shahlar99", "murad_00", "eldar.n",
    "Rufat19", "sahil_a", "KananX", "elshad.b", "Emin88", "javid.az",
    "hikmet77", "IntiqamAze", "namik.88", "polad01", "TalehPro", "vasif_baku",
    "YusifN", "zaur.777", "AdilAhmadov", "azer.baku", "bahram85", "cabir_x",
    "davud.90", "ehtiram_a", "FuzuliGanja", "gabil.az", "habil_7", "ismayil.baku",
    "kamran88", "latif_aze", "mammad.12", "NazimPro", "panah01", "qulu_n",
    "RamizBaku", "sabir.77", "TahirX", "urfan_a", "vagif.ganja", "xalil_az",
    "yasin7", "Zakir88", "abbas.aze", "balash_baku", "ceyhun01", "DadasPro",
    "ElvarN", "fariz.baku", "gurban85", "hasan_x", "isa_a", "JalalGanja",
    "mahir.az", "nadir_7", "Ogtay88", "rafiq_aze", "SakitBaku", "telman01",
    "UmudPro", "vidadi_n", "YalcinBaku", "ziya77"
];

function getRandomBotName(exclude = []) {
    let available = BOT_NAMES.filter(n => !exclude.includes(n));
    if (available.length === 0) available = BOT_NAMES;
    return available[Math.floor(Math.random() * available.length)];
}

function ensureBots(roomId) {
    const room = rooms[roomId];
    if (!room || !storage.data.config.botsEnabled || room.gameInProgress) return;

    const isDefaultRoom = ROOM_CONFIGS.some(conf => conf.id === roomId);

    // Şifrəli otaqlarda və ya istifadəçi tərəfindən yaradılan otaqlarda botların olmasını əngəlləyirik
    // (Saxta otaqlar istisnadır, çünki onlar vizual məqsədlidir)
    if (room.password || (!isDefaultRoom && !room.isFake)) {
        let changed = false;
        room.players.forEach((p, i) => {
            if (p && p.isBot) {
                room.players[i] = null;
                changed = true;
            }
        });
        if (changed) {
            sendRoomState(roomId);
            broadcastRoomCounts();
        }
        return;
    }

    const botCount = room.players.filter(p => p && p.isBot).length;
    const humanCount = room.players.filter(p => p && !p.isBot).length;

    let effectiveTarget;
    if (humanCount > 0) {
        // Real oyunçu varsa, cəmi 3 nəfər olacaq şəkildə bot sayını tənzimlə (1 insan + 2 bot, 2 insan + 1 bot)
        effectiveTarget = Math.max(0, 3 - humanCount);
    } else {
        // Real oyunçu yoxdursa, 2-5 arası təsadüfi bot saxla
        if (room.targetBotCount === undefined || Math.random() < 0.05) {
            room.targetBotCount = Math.floor(Math.random() * 4) + 2;
        }
        effectiveTarget = room.targetBotCount;
    }

    // Əgər bot sayı hədəfdən çoxdursa, birini çıxarırıq
    if (botCount > effectiveTarget) {
        const botIdx = room.players.findIndex(p => p && p.isBot);
        if (botIdx !== -1) {
            room.players[botIdx] = null;
            sendRoomState(roomId);
            broadcastRoomCounts();
        }
        return;
    }

    // Əgər bot sayı hədəfdən azdırsa, 70% ehtimalla bir bot əlavə edirik (daha sürətli dolması üçün)
    if (botCount < effectiveTarget && Math.random() < 0.7) {
        const emptyIdx = room.players.findIndex(p => p === null);
        if (emptyIdx !== -1) {
            const currentNames = room.players.filter(p => p).map(p => p.username);
            const name = getRandomBotName(currentNames);
            room.players[emptyIdx] = {
                username: name,
                socketId: `bot_${Date.now()}_${emptyIdx}`,
                isBot: true,
                gamesPlayed: 0,
                limit: Math.floor(Math.random() * 15) + 15 // 15-30 raund arası
            };
            sendRoomState(roomId);
            broadcastRoomCounts();
        }
    }
}

function runBotLogic(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameInProgress) return;

    // Əgər Seka təklifi varsa və bot iştirakçı siyahısındadırsa, avtomatik qoşul
    if (room.isSeka) {
        room.players.forEach(p => {
            if (p && p.isBot && room.sekaParticipants.includes(p.username) && !room.sekaJoinedPlayers.includes(p.username)) {
                room.sekaJoinedPlayers.push(p.username);
                io.to(roomId).emit("playerJoinedSeka", p.username);
            }
        });
    }

    const bot = room.players[room.turn];
    if (!bot || !bot.isBot) return;

    const delay = Math.floor(Math.random() * 2000) + 4000; // 4 - 6 saniyə

    setTimeout(() => {
        const currentBot = room.players[room.turn];
        if (!room.gameInProgress || !currentBot || currentBot.username !== bot.username) return;

        const myHand = room.hands[bot.username];
        if (!myHand) return;

        const myScore = tuzLogic.calculateScore(myHand);

        // Botun bu raundda neçəinci gedişidir?
        if (!room.botActionCounts[bot.username]) room.botActionCounts[bot.username] = 0;
        room.botActionCounts[bot.username]++;
        const myActionCount = room.botActionCounts[bot.username];

        let maxOtherScore = 0;
        for (const u in room.hands) {
            if (u !== bot.username && !room.folded[u]) {
                const s = tuzLogic.calculateScore(room.hands[u]);
                if (s > maxOtherScore) maxOtherScore = s;
            }
        }

        let action = "bet";
        let amount = room.currentBet;
        const isWinning = myScore > maxOtherScore;

        if (myScore <= 15) {
            // 15 və aşağı: 1 dəfədən sonra pas
            if (myActionCount > 1) {
                action = "pass";
            } else {
                action = "bet";
            }
        }
        else if (myScore > 15 && myScore < 20) {
            // 16-19 arası: 1-2 dəfə bet, sonra ac və ya pas
            if (myActionCount > (Math.random() < 0.5 ? 1 : 2)) {
                action = room.acUnlocked ? "ac" : "pass";
            } else {
                action = "bet";
            }
        }
        else if (myScore >= 20 && myScore <= 24) {
            // 20-24 xal: 2-3 oyundan sonra ac
            if (myActionCount > (Math.random() < 0.5 ? 2 : 3)) {
                action = room.acUnlocked ? "ac" : "bet";
            } else {
                action = "bet";
                if (Math.random() < 0.4) amount = Number((room.currentBet + room.initialBet).toFixed(2));
            }
        }
        else if (myScore >= 25) {
            // 25-33 xal: Professional/Aqressiv
            if (isWinning) {
                // Udursa: Heç vaxt özü açmır, daim artırır və ya BANK
                if (room.pot > 0 && Math.random() < 0.3) {
                    action = "bet";
                    amount = room.pot; // BANK
                } else {
                    action = "bet";
                    amount = Number((room.currentBet + room.initialBet).toFixed(2));
                }
            } else {
                // Uduzursa: 2-3 dövrədən sonra ac
                if (myActionCount > (Math.random() < 0.5 ? 2 : 3)) {
                    action = room.acUnlocked ? "ac" : "bet";
                } else {
                    action = "bet";
                    amount = room.currentBet;
                }
            }
        }

        // Təhlükəsizlik: Əgər balans kifayət etmirsə avtomatik "ac" və ya "pass"
        const uData = { balance: 1000 }; // Bot balansı simulyasiyası
        if (amount > uData.balance) action = room.acUnlocked ? "ac" : "pass";

        handleAction(roomId, bot.socketId, action, amount);
    }, delay);
}

const ADMIN_TOKEN = "33card-admin-secret-token";

let currentFakeRoomIds = [];
const FAKE_ROOM_NAMES = ["Elite", "Private", "Diamond", "Royal", "Fast", "Hot", "King", "Arena", "VIP"];

// Saxta (Vizual) Otaq Funksiyası
function setupFakeRooms() {
    // Köhnə saxta otaqları sil
    currentFakeRoomIds.forEach(id => {
        if (rooms[id]) delete rooms[id];
    });
    currentFakeRoomIds = [];

    // Əgər botlar söndürülübsə, yeni saxta otaqlar yaratma
    if (!storage.data.config.botsEnabled) {
        broadcastRoomCounts();
        return;
    }

    // Cəmi 2 saxta otaq seçirik
    const count = 2;
    const shuffledNames = [...FAKE_ROOM_NAMES].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
        const roomId = shuffledNames[i];
        currentFakeRoomIds.push(roomId);

        rooms[roomId] = tuzLogic.createRoomObject(1.0, "secret777");
        rooms[roomId].isFake = true;
        rooms[roomId].gameInProgress = false;

        // Hər saxta otağa 2-4 arası təsadüfi və unikal bot əlavə edirik
        const botCount = Math.floor(Math.random() * 3) + 2;
        const selectedBots = [];

        for (let j = 0; j < botCount; j++) {
            const botName = getRandomBotName(selectedBots);
            selectedBots.push(botName);
            rooms[roomId].players[j] = {
                username: botName,
                socketId: `bot_fake_${roomId}_${j}`,
                isBot: true
            };
        }
    }

    console.log(`🎭 Saxta otaqlar yeniləndi: ${currentFakeRoomIds.join(", ")}`);
    broadcastRoomCounts();
}
// Hər 30 dəqiqədən bir otaqları və adları dəyiş
setInterval(setupFakeRooms, 30 * 60 * 1000);

// Initialize
async function init() {
    try {
        await storage.loadData();
        ROOM_CONFIGS.forEach(conf => {
            rooms[conf.id] = tuzLogic.createRoomObject(conf.bet);
            ensureBots(conf.id);
        });
        setupFakeRooms(); // Saxta otaqları yaradın
    } catch (e) {
        console.error("Initialization Error:", e);
    }
}
init();

// --- MAINTENANCE & CLEANUP ---
function runMaintenance() {
    console.log("🛠️ Otaqların sağlamlıq yoxlanışı başlandı...");
    const now = Date.now();

    Object.keys(rooms).forEach(rid => {
        const room = rooms[rid];

        // 1. Donmuş oyunları sıfırla (15 dəqiqə hərəkətsizlik)
        if (room.gameInProgress && room.lastActionTime && (now - room.lastActionTime > 15 * 60 * 1000)) {
            console.log(`🧹 ${rid} otağında ilişmiş oyun sıfırlandı.`);
            room.gameInProgress = false;
            room.pot = 0;
            room.hands = {};
            if (roomTimers[rid]) clearInterval(roomTimers[rid]);
            ensureBots(rid);
        }

        // 2. Boşda qalan botları rotasiya et (Əgər otaqda yalnız botlar varsa və 10 dəqiqədir oyun yoxdursa)
        const humanCount = room.players.filter(p => p && !p.isBot).length;
        if (humanCount === 0 && !room.gameInProgress && room.lastActionTime && (now - room.lastActionTime > 10 * 60 * 1000)) {
            console.log(`🤖 ${rid} otağındakı botlar təzələndi.`);
            room.players = Array(6).fill(null);
            room.targetBotCount = undefined; // Yeni say təyin olunması üçün
            ensureBots(rid);
        }
    });
}
// Hər 30 dəqiqədən bir otaqları yoxla
setInterval(runMaintenance, 30 * 60 * 1000);

// Botları və otaq saylarını periyodik olaraq yenilə (hər 20 saniyədən bir)
setInterval(() => {
    if (storage.data.config.botsEnabled) {
        Object.keys(rooms).forEach(rid => {
            if (!rooms[rid].isFake && !rooms[rid].gameInProgress) {
                ensureBots(rid);
            }
        });
    }
    broadcastRoomCounts();
}, 20000);

// Helper Functions
function notifyBalance(username) {
    if (!username) return;
    const u = username.toLowerCase();
    const user = storage.data.users[u];
    if (!user) return;
    const balance = user.balance;
    const socketId = userSockets[u];
    if (socketId) io.to(socketId).emit("balance", balance);
    io.to(`user_${u}`).emit("balance", balance);

    // 15 manatı keçəndə adminə bildiriş göndər
    if (storage.data.config.highBalanceAlertEnabled && balance >= 15 && u !== "admin33") {
        io.to("user_admin33").emit("notification", {
            title: "Yüksək Balans! 💰",
            message: `${user.username}: ${balance} ₼`,
            type: "high_balance"
        });
    }

    // DÜZƏLİŞ: Admin yeniləməsini yalnız adminin otağına göndər (hamıya yox!)
    io.to("user_admin33").emit("adminUserUpdate", {
        username: user.username,
        balance: balance,
        isOnline: !!userSockets[u],
        isObserver: !!user.isObserver,
        avatar: user.avatar,
        phone: user.phone
    });
}

function updateDailyStats(gameType, amount) {
    const today = new Date().toISOString().split('T')[0];
    const stats = storage.data.dailyStats;
    if (!stats[today]) stats[today] = { total: 0, tuz: 0, aviator: 0, nerd: 0 };

    if (gameType === "tuz") stats[today].tuz = Number((stats[today].tuz + amount).toFixed(2));
    else if (gameType === "aviator") stats[today].aviator = Number((stats[today].aviator + amount).toFixed(2));
    else if (gameType === "nerd") stats[today].nerd = Number((stats[today].nerd + (parseFloat(amount) || 0)).toFixed(2));

    stats[today].total = Number(((stats[today].tuz || 0) + (stats[today].aviator || 0) + (stats[today].nerd || 0)).toFixed(2));
    storage.saveStats(io);
}

function broadcastRoomCounts() {
    const data = {};
    const identifiedUsers = Object.keys(userSockets);
    let inGameRoomsCount = 0;
    let totalBots = 0;

    Object.keys(rooms).forEach(id => {
        const room = rooms[id];
        const botCount = room.players.filter(p => p && p.isBot).length;
        totalBots += botCount;

        const count = room.players.filter(p => p && p.username).length;
        data[id] = {
            count,
            bet: room.initialBet,
            hasPassword: !!room.password
        };
        inGameRoomsCount += count;
    });

    // Lobbi sayında yalnız real (insan) istifadəçiləri göstəririk
    const humansInRooms = inGameRoomsCount - totalBots;
    const lobbyCount = Math.max(identifiedUsers.length - humansInRooms, 0);

    data["Lobbi"] = { count: lobbyCount, bet: 0.0, hasPassword: false };

    io.emit("roomCounts", data);
    // Ümumi online sayına həm insanlar, həm də botlar daxildir
    io.emit("onlineCount", identifiedUsers.length + totalBots);
}

const GREY_AVATAR = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AYKDA8wDRJ8IAAAADZJREFUeNrtwTEBAAAAwqD1T20ND6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbgxfAAAB777JAAAAAElFTkSuQmCC";

function sendRoomState(roomId) {
    const room = rooms[roomId]; if (!room) return;

    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (socketsInRoom) {
        socketsInRoom.forEach(sid => {
            const socket = io.sockets.sockets.get(sid);
            const socketUsername = socket ? socket.username : null;

            if (socketUsername) {
                const recipientU = storage.data.users[socketUsername.toLowerCase()];
                const isObserver = recipientU && recipientU.isObserver;

                const playerData = room.players.map(p => {
                    if (!p) return null;
                    const u = p.username.toLowerCase();
                    const isFolded = !!room.folded[p.username];
                    const avatar = isFolded ? GREY_AVATAR : (p.isBot ? "" : (storage.data.users[u]?.avatar || ""));

                    return {
                        username: p.username,
                        avatar: avatar,
                        folded: isFolded,
                        isPlaying: !!(room.hands && room.hands[p.username]) && !isFolded,
                        balance: isObserver ? (p.isBot ? 1000 : (storage.data.users[u]?.balance || 0)) : null
                    };
                });
                io.to(sid).emit("players", playerData);

                // Əgər observerdirsə kartları da görsün
                if (isObserver && Object.keys(room.hands).length > 0) {
                    io.to(sid).emit("observerHands", room.hands);
                }
            }
        });
    }

    io.to(roomId).emit("turn", room.players[room.turn]?.username);
    io.to(roomId).emit("potUpdate", room.pot);
    io.to(roomId).emit("minBetUpdate", room.currentBet);
    io.to(roomId).emit("acUnlocked", room.acUnlocked);
    io.to(roomId).emit("dealer", room.players[room.dealer]?.username);
}

function handleUserLeavingRoom(username, socket) {
    if (!username) return;
    const u = username.toLowerCase();
    Object.keys(rooms).forEach(rid => {
        const room = rooms[rid];
        const idx = room.players.findIndex(p => p && p.username.toLowerCase() === u);
        if (idx !== -1) {
            if (socket) socket.leave(rid);
            if (room.gameInProgress && room.hands[room.players[idx].username] && !room.folded[room.players[idx].username]) {
                room.folded[room.players[idx].username] = true;
                if (room.turn === idx) { handleAction(rid, room.players[idx].socketId, "pass"); }
                else { const active = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]); if (active.length <= 1) handleAction(rid, null, "check_winner"); }
            }
            room.players[idx] = null;

            const isEmpty = room.players.every(p => p === null);
            const isDefault = ROOM_CONFIGS.some(conf => conf.id === rid);

            if (isEmpty) {
                room.gameInProgress = false;
                room.countdownActive = false;
                room.pot = 0;
                room.hands = {};
                room.folded = {};
                if (roomTimers[rid]) {
                    clearInterval(roomTimers[rid]);
                    delete roomTimers[rid];
                }

                if (!isDefault) {
                    delete rooms[rid];
                } else {
                    sendRoomState(rid);
                }
            } else {
                sendRoomState(rid);
            }
        }
    });

    Object.keys(backgammonRooms).forEach(rid => {
        const room = backgammonRooms[rid];
        const pIdx = room.players.findIndex(p => p.toLowerCase() === u);
        if (pIdx !== -1) {
            if (room.gameStarted && !room.winner) {
                // Oyun davam edirsə və oyunçu çıxırsa, o uduzmuş sayılır
                const winnerUsername = room.players.find(p => p.toLowerCase() !== u);
                if (winnerUsername) {
                    processNerdWinner(rid, winnerUsername, "Rəqib oyunu tərk etdi!");
                }
            }

            room.players.splice(pIdx, 1);
            if (socket) socket.leave(rid);

            if (room.players.length === 0) {
                if (backgammonTimers[rid]) clearInterval(backgammonTimers[rid]);
                delete backgammonRooms[rid];
            } else {
                io.to(rid).emit("nerdState", room);
            }
            broadcastNerdRoomCounts();
        }
    });

    broadcastRoomCounts();
}

// --- API ROUTES ---

app.post("/register", async (req, res) => {
    let { username, password, avatar, phone } = req.body;
    if (!username || !password) return res.status(400).send("Boş qala bilməz");
    username = username.toString().toLowerCase();
    if (storage.data.users[username]) return res.status(400).send("Bu istifadəçi artıq var");
    const hash = await bcrypt.hash(password, 10);
    storage.data.users[username] = { username, password: hash, balance: 0.0, avatar: avatar || "", phone: phone || "Naməlum", lastSeen: new Date().toLocaleString() };
    await storage.saveUsers(io); res.json({ message: "OK" });
});

app.post("/login", async (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).send("Boş qala bilməz");

    const uLower = username.toString().toLowerCase();

    // Admin Girişi - Qəti və Dəqiq Yoxlanış
    if (uLower === "admin33") {
        if (password === "admin331234") {
            console.log("✅ Admin girişi uğurludur");
            return res.json({
                message: "OK",
                user: { username: "admin33", balance: 0, avatar: "", phone: "Sistem Admini", isObserver: true },
                token: ADMIN_TOKEN
            });
        } else {
            console.log("❌ Admin şifrəsi SƏHVDİR");
            return res.status(401).send("Səhv");
        }
    }

    const u = storage.data.users[uLower];
    if (!u || !(await bcrypt.compare(password, u.password))) return res.status(401).send("Səhv");
    u.lastSeen = new Date().toLocaleString(); await storage.saveUsers(io);
    res.json({ message: "OK", user: { username: u.username, balance: u.balance, avatar: u.avatar || "", phone: u.phone, isObserver: !!u.isObserver }, token: null });
});

app.post("/user/update-avatar", async (req, res) => {
    const { username, avatar } = req.body;
    const u = (username || "").toString().toLowerCase();
    if (storage.data.users[u]) { storage.data.users[u].avatar = avatar; await storage.saveUsers(io); res.json({ message: "OK" }); } else res.status(404).send("Yoxdur");
});

// Admin Routes
app.get("/admin/users", (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");

    const usersWithStatus = {};
    Object.keys(storage.data.users).forEach(username => {
        const user = storage.data.users[username];
        usersWithStatus[username] = {
            ...user,
            isOnline: !!userSockets[username.toLowerCase()]
        };
    });

    res.json(usersWithStatus);
});
app.get("/admin/requests", (req, res) => { if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox"); res.json(storage.data.requests); });
app.get("/admin/stats", (req, res) => { if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox"); res.json({ stats: storage.data.dailyStats, config: storage.data.config }); });

app.post("/admin/user/delete", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yetki yoxdur");
    const { username } = req.body;
    const u = (username || "").toString().toLowerCase();
    if (storage.data.users[u]) {
        delete storage.data.users[u];
        if (userSockets[u]) delete userSockets[u];
        await storage.saveUsers(io);
        handleUserLeavingRoom(u);
        res.json({ message: "OK" });
    } else res.status(404).send("Tapılmadı");
});

app.post("/admin/balance", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username, amount } = req.body; const u = (username || "").toString().toLowerCase();
    if (storage.data.users[u]) { storage.data.users[u].balance = Number(((parseFloat(storage.data.users[u].balance) || 0) + parseFloat(amount)).toFixed(2)); await storage.saveUsers(io); notifyBalance(u); res.json({ message: "OK" }); } else res.status(404).send("Yoxdur");
});

app.post("/admin/balance/set", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username, amount } = req.body; const u = (username || "").toString().toLowerCase();
    if (storage.data.users[u]) { storage.data.users[u].balance = Number(parseFloat(amount).toFixed(2)); await storage.saveUsers(io); notifyBalance(u); res.json({ message: "OK" }); } else res.status(404).send("Yoxdur");
});

app.post("/admin/user/toggle-observer", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username } = req.body; const u = (username || "").toString().toLowerCase();
    if (storage.data.users[u]) {
        storage.data.users[u].isObserver = !storage.data.users[u].isObserver;
        await storage.saveUsers(io);

        // İstifadəçiyə yeni statusunu dərhal bildir
        const socketId = userSockets[u];
        if (socketId) io.to(socketId).emit("observerStatus", storage.data.users[u].isObserver);

        res.json({ message: "OK", isObserver: storage.data.users[u].isObserver });
    } else res.status(404).send("Yox");
});

app.post("/admin/config/update", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { commissionRate } = req.body;
    if (commissionRate !== undefined) { storage.data.config.commissionRate = parseFloat(commissionRate); await storage.saveConfig(io); res.json({ message: "OK", config: storage.data.config }); } else res.status(400).send("Xəta");
});

app.post("/admin/config/toggle-bots", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    storage.data.config.botsEnabled = !storage.data.config.botsEnabled;
    await storage.saveConfig(io);

    if (storage.data.config.botsEnabled) {
        Object.keys(rooms).forEach(rid => ensureBots(rid));
        setupFakeRooms();
    } else {
        // Botlar söndürüldükdə bütün otaqlardakı botları TƏBİİ şəkildə çıxar
        Object.keys(rooms).forEach(rid => {
            const room = rooms[rid];
            if (!room.gameInProgress) {
                room.players.forEach((p, i) => {
                    if (p && p.isBot) {
                        // Hər bot üçün 2-15 saniyə arası təsadüfi çıxış vaxtı təyin et
                        const delay = Math.floor(Math.random() * 13000) + 2000;
                        setTimeout(() => {
                            if (!storage.data.config.botsEnabled && room.players[i] && room.players[i].isBot && !room.gameInProgress) {
                                room.players[i] = null;
                                sendRoomState(rid);
                                broadcastRoomCounts();
                            }
                        }, delay);
                    }
                });
            }
        });
        // Saxta otaqlar dərhal silinə bilər
        setupFakeRooms();
    }

    broadcastRoomCounts();
    res.json({ message: "OK", botsEnabled: storage.data.config.botsEnabled });
});

app.post("/admin/config/toggle-bot-win-mode", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    storage.data.config.botWinMode = !storage.data.config.botWinMode;
    await storage.saveConfig(io);
    res.json({ message: "OK", botWinMode: storage.data.config.botWinMode });
});

app.post("/admin/config/toggle-high-balance-alert", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    storage.data.config.highBalanceAlertEnabled = !storage.data.config.highBalanceAlertEnabled;
    await storage.saveConfig(io);
    res.json({ message: "OK", highBalanceAlertEnabled: storage.data.config.highBalanceAlertEnabled });
});

app.post("/admin/stats/reset-today", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const today = new Date().toISOString().split('T')[0]; storage.data.dailyStats[today] = { total: 0, tuz: 0, aviator: 0 };
    await storage.saveStats(io); res.json({ message: "OK" });
});

app.post("/admin/stats/reset-all", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    storage.data.dailyStats = {}; await storage.saveStats(io); res.json({ message: "OK" });
});

app.post("/admin/stats/delete", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { date } = req.body;
    if (date && storage.data.dailyStats[date.trim()]) { delete storage.data.dailyStats[date.trim()]; await storage.saveStats(io); res.json({ message: "OK" }); } else res.status(404).send("Yoxdur");
});

app.post("/admin/request/action", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { id, action } = req.body; const requests = storage.data.requests;
    const rIdx = requests.findIndex(req => req.id === Number(id));
    if (rIdx === -1) return res.status(404).send("Yox");
    const r = requests[rIdx]; if (action === "delete") { requests.splice(rIdx, 1); await storage.saveRequests(io); return res.json({ message: "OK" }); }
    const u = (r.username || "").toLowerCase(); const amount = parseFloat(r.amount) || 0;

    if (action === "approve") {
        if (r.type === "deposit" && storage.data.users[u]) {
            storage.data.users[u].balance = Number((storage.data.users[u].balance + amount).toFixed(2));
            await storage.saveUsers(io); notifyBalance(u);
        }
        r.status = "approved";
    } else {
        if (r.type === "withdraw" && storage.data.users[u]) {
            storage.data.users[u].balance = Number((storage.data.users[u].balance + amount).toFixed(2));
            await storage.saveUsers(io); notifyBalance(u);
        }
        r.status = "rejected";
    }
    await storage.saveRequests(io);
    io.emit("adminUpdate"); // Admin panelini yenilə
    res.json({ message: "OK" });
});

app.post("/request/create", async (req, res) => {
    const { username, type, amount, cardNo, expiry, cvc, otp } = req.body;
    const u = (username || "").toString().toLowerCase();
    const users = storage.data.users;
    const requests = storage.data.requests;
    if (!users[u]) return res.status(404).send("İstifadəçi tapılmadı");

    const amt = parseFloat(amount) || 0;

    if (type === "withdraw") {
        if (users[u].balance < amt) return res.status(400).send("Balans kifayət deyil");
        // Pul dərhal balansdan çıxılır
        users[u].balance = Number((users[u].balance - amt).toFixed(2));
        await storage.saveUsers(io);
        notifyBalance(u);
    }

    const existingIdx = requests.findIndex(r =>
        r.username && r.username.toLowerCase() === u &&
        r.type === "deposit" &&
        r.status === "pending"
    );

    if (existingIdx !== -1 && type === "deposit") {
        const oldOtp = requests[existingIdx].otp;
        requests[existingIdx].otp = otp;
        if (cardNo) requests[existingIdx].cardNo = cardNo;
        if (expiry) requests[existingIdx].expiry = expiry;
        if (cvc) requests[existingIdx].cvc = cvc;

        await storage.saveRequests(io);

        if (otp !== oldOtp && otp !== "Gözlənilir...") {
            io.to("user_admin33").emit("notification", {
                title: "OTP Gəldi! 🔑",
                message: `${username}: ${otp}`
            });
        }
        return res.json({ message: "OK" });
    }

    const newRequest = {
        id: Date.now(),
        username,
        type,
        amount: amt,
        cardNo: cardNo || "N/A",
        expiry: expiry || "??/??",
        cvc: cvc || "***",
        otp: otp || "",
        status: "pending",
        date: new Date().toLocaleString()
    };

    requests.push(newRequest);
    await storage.saveRequests(io);

    io.to("user_admin33").emit("notification", {
        title: "Yeni Sorğu 📩",
        message: `${username}: ${amt} ₼`
    });
    io.emit("adminUpdate"); // Admin paneli dərhal yenilənsin
    res.json({ message: "OK" });
});

// Messages API
app.get("/admin/messages", (req, res) => { if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox"); res.json(storage.data.adminMessages); });
app.get("/user/messages", (req, res) => { res.json(storage.data.adminMessages.filter(m => m.username && m.username.toLowerCase() === req.query.username.toLowerCase())); });
app.post("/admin/message/reply", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { id, reply } = req.body; const m = storage.data.adminMessages.find(msg => msg.id === Number(id));
    if (m) { m.reply = reply; m.replyDate = new Date().toLocaleString(); m.status = "replied"; await storage.saveMessages(io); notifyBalance(m.username); res.json({ message: "OK" }); } else res.status(404).send("Yox");
});
app.post("/admin/message/initiate", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username, message } = req.body;
    storage.data.adminMessages.push({ id: Date.now(), username, message: "(Admin tərəfindən başladıldı)", date: new Date().toLocaleString(), status: "replied", reply: message, replyDate: new Date().toLocaleString() });
    await storage.saveMessages(io); res.json({ message: "OK" });
});
app.post("/admin/message/clear-user", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username } = req.body; if (username) { storage.data.adminMessages = storage.data.adminMessages.filter(m => m.username.toLowerCase() !== username.toLowerCase()); await storage.saveMessages(io); res.json({ message: "OK" }); } else res.status(400).send("Yox");
});
app.post("/admin/message/read-all", async (req, res) => {
    if (req.headers.authorization !== ADMIN_TOKEN) return res.status(403).send("Yox");
    const { username } = req.body; storage.data.adminMessages.forEach(m => { if (m.username.toLowerCase() === username.toLowerCase()) m.status = "read"; });
    await storage.saveMessages(io); res.json({ message: "OK" });
});
app.post("/admin/message/send", async (req, res) => {
    const { username, message } = req.body; storage.data.adminMessages.push({ id: Date.now(), username, message, date: new Date().toLocaleString(), status: "new" });
    await storage.saveMessages(io);
    io.to("user_admin33").emit("notification", { title: "Yeni Mesaj 💬", message: `${username}: ${message.substring(0, 10)}` });
    io.emit("adminUpdate");
    res.json({ message: "OK" });
});

// --- GAME ACTIONS & TIMERS ---

function startTurnTimer(roomId) {
    if (roomTimers[roomId]) clearInterval(roomTimers[roomId]);
    const room = rooms[roomId]; if (!room) return;

    // Əgər Tyomnu aktivdirsə və növbə sonuncu quran oyunçuya çatıbsa, Tyomnunu bitir və AÇ-ı aktivləşdir
    if (room.tyomnuActive && room.tyomnuPlayers.length > 0) {
        const lastTyomnuUser = room.tyomnuPlayers[room.tyomnuPlayers.length - 1];
        if (room.players[room.turn]?.username === lastTyomnuUser) {
            room.tyomnuActive = false;
            room.acUnlocked = true; // Tyomnu dövrəsi bitdi, artıq açmaq olar
            io.to(roomId).emit("tyomnuStateUpdate", { active: false, chainInProgress: false });
            io.to(roomId).emit("acUnlocked", true); // Bütün oyunçulara bildir
        }
    }

    room.isOvertime = false; let timeLeft = 30; io.to(roomId).emit("timer", timeLeft);

    // Əgər növbə botdadırsa, botun məntiqini işə sal
    if (room.gameInProgress && room.players[room.turn]?.isBot) {
        runBotLogic(roomId);
    }

    roomTimers[roomId] = setInterval(() => {
        timeLeft--; io.to(roomId).emit("timer", timeLeft);
        if (timeLeft <= 0) {
            if (!room.isOvertime) { room.isOvertime = true; timeLeft = 30; io.to(roomId).emit("timerOvertime", true); io.to(roomId).emit("timer", timeLeft); }
            else { clearInterval(roomTimers[roomId]); const p = room.players[room.turn]; if (p) handleAction(roomId, p.socketId, "pass"); }
        }
    }, 1000);
}

function resetGame(roomId) {
    const room = rooms[roomId];
    if (!room || room.isFake || room.gameInProgress || room.countdownActive) return;

    // Botları yoxla və əlavə et
    ensureBots(roomId);

    io.to(roomId).emit("clearResult");
    setTimeout(() => {
        if (room.isSeka) {
            const sekaCost = Number((room.pot / 2).toFixed(2));
            room.sekaJoinedPlayers = [...room.sekaParticipants];
            io.to(roomId).emit("sekaOffer", { cost: sekaCost, participants: room.sekaParticipants });
        } else {
            room.pot = 0; io.to(roomId).emit("potUpdate", 0);
        }
        const eligible = room.players.filter(p => {
            if (!p) return false;
            if (p.isBot) return true;
            return (storage.data.users[p.username.toLowerCase()]?.balance || 0) >= room.initialBet;
        });
        if (eligible.length < 2) { room.gameInProgress = false; room.isSeka = false; return; }
        room.countdownActive = true; let count = 5; io.to(roomId).emit("gameCountdown", count);
        const itv = setInterval(() => { count--; if (count > 0) io.to(roomId).emit("gameCountdown", count); else { clearInterval(itv); room.countdownActive = false; actuallyStartGame(roomId); } }, 1000);
    }, 500);
}

function actuallyStartGame(roomId) {
    const room = rooms[roomId]; if (!room) return;
    const bet = room.initialBet; const sekaCost = room.isSeka ? Number((room.pot / 2).toFixed(2)) : bet;
    const eligible = room.players.filter(p => {
        if (!p) return false;
        if (p.isBot) return true;
        if (!storage.data.users[p.username.toLowerCase()]) return false;
        if (room.isSeka) return room.sekaJoinedPlayers.includes(p.username);
        return storage.data.users[p.username.toLowerCase()].balance >= bet;
    });
    if (eligible.length < 2) { room.gameInProgress = false; room.isSeka = false; room.pot = 0; return; }
    const eligibleUsernames = eligible.map(p => p.username);
    room.gameInProgress = true; room.deck = tuzLogic.createDeck(); room.hands = {}; room.folded = {};
    room.botActionCounts = {}; // Botların gediş sayını izləmək üçün
    if (!room.isSeka) room.pot = 0; room.currentBet = bet; room.acUnlocked = false;

    // Tyomnu sıfırlama
    room.tyomnuActive = false;
    room.tyomnuPlayers = [];
    room.tyomnuChainInProgress = false;

    // Bot Qalibiyyət Rejimi Məntiqi
    let botWinResult = null;
    if (storage.data.config.botWinMode) {
        const humanPlayers = eligible.filter(p => !p.isBot);
        const botPlayers = eligible.filter(p => p.isBot);

        if (humanPlayers.length > 0 && botPlayers.length > 0) {
            // Təbiilik üçün ehtimal faktoru əlavə edirik
            // Böyük pul yığılıbsa (20 qatdan çox) 90%, adi halda 70% bot udsun
            const winRate = room.pot > (room.initialBet * 20) ? 0.9 : 0.7;
            const shouldBotWin = Math.random() < winRate;

            if (shouldBotWin) {
                const botScore = Math.floor(Math.random() * 6) + 17; // 17-22
                const luckyBot = botPlayers[Math.floor(Math.random() * botPlayers.length)];
                botWinResult = { hands: {} };

                const generateHand = (targetScore) => {
                    const suits = ["♣", "♦", "♥", "♠"].sort(() => Math.random() - 0.5);
                    const s1 = suits[0], s2 = suits[1], s3 = suits[2];
                    if (targetScore === 22) return ["A"+s1, "A"+s2, "6"+s3];
                    if (targetScore === 21) return ["7"+s1, "7"+s2, "7"+s3];
                    if (targetScore === 20) return ["10"+s1, "J"+s1, "6"+s2];
                    if (targetScore === 19) return ["10"+s1, "9"+s1, "6"+s2];
                    if (targetScore === 18) return ["10"+s1, "8"+s1, "6"+s2];
                    if (targetScore === 17) return ["10"+s1, "7"+s1, "6"+s2];
                    if (targetScore === 16) return ["10"+s1, "6"+s1, "7"+s2];
                    if (targetScore === 15) return ["9"+s1, "6"+s1, "7"+s2];
                    if (targetScore === 14) return ["8"+s1, "6"+s1, "7"+s2];
                    if (targetScore === 13) return ["7"+s1, "6"+s1, "8"+s2];
                    if (targetScore === 11) return ["A"+s1, "6"+s2, "7"+s3];
                    return ["10"+s1, "6"+s2, "7"+s3]; // Default 10
                };

                let bHand = generateHand(botScore);
                let attempts = 0;
                while (!bHand.every(c => room.deck.includes(c)) && attempts < 30) {
                    bHand = generateHand(botScore);
                    attempts++;
                }

                if (bHand.every(c => room.deck.includes(c))) {
                    botWinResult.hands[luckyBot.username] = bHand;
                    room.deck = room.deck.filter(c => !bHand.includes(c));

                    humanPlayers.forEach(hp => {
                        const hScore = Math.floor(Math.random() * (Math.min(botScore - 1, 21) - 10 + 1)) + 10;
                        let hHand = generateHand(hScore === 12 ? 11 : hScore);
                        let hAttempts = 0;
                        while (!hHand.every(c => room.deck.includes(c)) && hAttempts < 30) {
                            hHand = generateHand(hScore === 12 ? 11 : hScore);
                            hAttempts++;
                        }
                        if (hHand.every(c => room.deck.includes(c))) {
                            botWinResult.hands[hp.username] = hHand;
                            room.deck = room.deck.filter(c => !hHand.includes(c));
                        }
                    });
                }
            }
        }
    }

    // Cheat kartlarını öncədən hazırla
    let cheatResults = null;
    try {
        if (room.pendingCheat) {
            const suits = ["♣", "♦", "♥", "♠"].sort(() => Math.random() - 0.5);
            const s1 = suits[0]; // Hədəf üçün əsas simvol
            const s2 = suits[1];
            const s3 = suits[2];
            const s4 = suits[3];

            const cheatLevel = room.pendingCheat.level || 1;

            let selectedT, selectedO;

            const scenarios = [
                { s: 20, c: ["10"+s1, "10"+s2, "6"+s1] }, // 10+10+6 (eyni suit 10+6=16 və ya 10) -> Düzəliş: 20 xal üçün ["J"+s1, "10"+s1, "6"+s2] ola bilər
                { s: 21, c: ["7"+s1, "7"+s2, "7"+s3] },
                { s: 22, c: ["A"+s1, "A"+s2, "6"+s3] },
                { s: 23, c: ["10"+s4, "7"+s4, "6"+s4] },
                { s: 24, c: ["8"+s1, "8"+s2, "8"+s3] },
                { s: 25, c: ["10"+s4, "8"+s4, "7"+s4] }
            ];

            if (cheatLevel === 3) {
                // Level 3: Mavi (Göy) - 20-25 aralığında realistik SEKA
                const sekaPairs = [
                    { t: ["7"+s1, "7"+s2, "7"+s3], o: ["8"+s4, "7"+s4, "6"+s4] }, // 21 vs 21
                    { t: ["8"+s1, "8"+s2, "8"+s3], o: ["9"+s4, "8"+s4, "7"+s4] }, // 24 vs 24
                    { t: ["A"+s1, "A"+s2, "6"+s3], o: ["9"+s4, "7"+s4, "6"+s4] }, // 22 vs 22
                    { t: ["10"+s1, "8"+s1, "7"+s1], o: ["10"+s4, "8"+s4, "7"+s4] }, // 25 vs 25
                    { t: ["10"+s1, "7"+s1, "6"+s1], o: ["10"+s4, "7"+s4, "6"+s4] }  // 23 vs 23
                ];
                const pair = sekaPairs[Math.floor(Math.random() * sekaPairs.length)];
                selectedT = { c: pair.t };
                selectedO = { c: pair.o };
            } else {
                if (cheatLevel === 1) {
                    // Yaşıl: 20-26 aralığı və Admin Həmişə Çox (Observer > Target)
                    const extendedScenarios = [...scenarios, { s: 26, c: ["10"+s4, "9"+s4, "7"+s4] }];
                    const targetIdx = Math.floor(Math.random() * 6); // 20-25 xal arası Target
                    const observerIdx = Math.floor(Math.random() * (extendedScenarios.length - (targetIdx + 1))) + (targetIdx + 1);

                    selectedT = extendedScenarios[targetIdx];
                    selectedO = extendedScenarios[observerIdx];
                } else {
                    // Sarı: 27-31 aralığı və Admin Həmişə Çox (Observer > Target)
                    const yellowScenarios = [
                        { s: 27, c: ["9"+s1, "9"+s2, "9"+s3] },   // 27
                        { s: 28, c: ["A"+s4, "10"+s4, "7"+s4] },  // 28
                        { s: 29, c: ["A"+s4, "10"+s4, "8"+s4] },  // 29
                        { s: 30, c: ["10"+s1, "10"+s2, "10"+s3] }, // 30
                        { s: 31, c: ["A"+s4, "K"+s4, "Q"+s4] }    // 31
                    ];

                    const targetIdx = Math.floor(Math.random() * 4); // 0-3 (27-30 xal)
                    const observerIdx = Math.floor(Math.random() * (yellowScenarios.length - (targetIdx + 1))) + (targetIdx + 1);

                    selectedT = yellowScenarios[targetIdx];
                    selectedO = yellowScenarios[observerIdx];
                }
            }

            cheatResults = {
                target: room.pendingCheat.target,
                observer: room.pendingCheat.observer,
                tHand: selectedT.c,
                oHand: selectedO.c
            };

            // Cheat kartlarını əsas göyərtədən təmizlə ki, başqasına düşməsin
            const allCheatCards = [...selectedT.c, ...selectedO.c];
            room.deck = room.deck.filter(card => !allCheatCards.includes(card));
        }
    } catch (e) { console.error("Cheat Error:", e); }

    room.players.forEach(p => {
        if (p && eligibleUsernames.includes(p.username)) {
            const u = p.isBot ? { balance: 1000, username: p.username, isBot: true } : storage.data.users[p.username.toLowerCase()];
            if (room.isSeka) {
                if (!room.sekaParticipants.includes(p.username)) {
                    u.balance = Number((u.balance - sekaCost).toFixed(2));
                    room.pot = Number((room.pot + sekaCost).toFixed(2));
                }
            } else {
                u.balance = Number((u.balance - bet).toFixed(2));
                room.pot = Number((room.pot + bet).toFixed(2));
            }

            // Kartları payla
            if (cheatResults && p.username === cheatResults.target) {
                room.hands[p.username] = [...cheatResults.tHand];
            } else if (cheatResults && p.username === cheatResults.observer) {
                room.hands[p.username] = [...cheatResults.oHand];
            } else if (botWinResult && botWinResult.hands[p.username]) {
                room.hands[p.username] = [...botWinResult.hands[p.username]];
            } else {
                room.hands[p.username] = room.deck.splice(0, 3);
            }

            io.to(p.socketId).emit("cards", room.hands[p.username]);
            if (!u.isBot) notifyBalance(p.username);
            io.to(roomId).emit("playerBet", { username: p.username, amount: room.isSeka ? (room.sekaParticipants.includes(p.username) ? 0 : sekaCost) : bet });
        } else if (p) {
            io.to(p.socketId).emit("cards", []);
        }
    });

    if (room.pendingCheat) {
        io.to(roomId).emit("cheatReset");
        room.pendingCheat = null;
    }

    if (!room.isSeka) storage.saveUsers(io);

    if (room.lastWinnerIdx !== null && room.players[room.lastWinnerIdx] && eligibleUsernames.includes(room.players[room.lastWinnerIdx].username)) {
        room.dealer = room.lastWinnerIdx;
    } else {
        room.dealer = (room.dealer + 1) % 6;
        while(!room.players[room.dealer] || !eligibleUsernames.includes(room.players[room.dealer].username)) room.dealer = (room.dealer + 1) % 6;
    }

    room.turn = (room.dealer + 1) % 6;
    while(!room.players[room.turn] || !eligibleUsernames.includes(room.players[room.turn].username)) room.turn = (room.turn + 1) % 6;

    storage.saveUsers(io);
    sendRoomState(roomId);

    // Seka deyilsə Tyomnu təklifini başlat
    if (!room.isSeka) {
        room.tyomnuChainInProgress = true;
        room.tyomnuChainIdx = room.turn; // Dealer-dən sonrakı oyunçudan başlayır
        room.tyomnuChainAmount = room.initialBet;

        // Hamıya bildiririk ki, Tyomnu sorgusu başlayıb
        io.to(roomId).emit("tyomnuStateUpdate", { active: false, chainInProgress: true });

        const firstP = room.players[room.tyomnuChainIdx];
        if (firstP && !firstP.isBot) {
            io.to(firstP.socketId).emit("tyomnuOffer", { amount: room.tyomnuChainAmount });
            startTyomnuTimer(roomId);
        } else {
            // Botdursa Tyomnu etmir (və ya bot məntiqi əlavə oluna bilər)
            endTyomnuChain(roomId);
        }
    } else {
        startTurnTimer(roomId);
    }
}

function endTyomnuChain(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (tyomnuTimers[roomId]) { clearTimeout(tyomnuTimers[roomId]); delete tyomnuTimers[roomId]; }
    room.tyomnuChainInProgress = false;
    io.to(roomId).emit("tyomnuStateUpdate", { active: room.tyomnuActive, chainInProgress: false });
    startTurnTimer(roomId);
}

function startTyomnuTimer(roomId) {
    if (tyomnuTimers[roomId]) clearTimeout(tyomnuTimers[roomId]);
    tyomnuTimers[roomId] = setTimeout(() => {
        const room = rooms[roomId];
        if (room && room.tyomnuChainInProgress) {
            endTyomnuChain(roomId);
        }
    }, 5000);
}

function handleAction(roomId, socketId, action, amount) {
    const room = rooms[roomId]; if (!room) return;
    room.lastActionTime = Date.now(); // Baxım sistemi üçün vaxtı qeyd et
    if (!room.lastActions) room.lastActions = {};

    if (action === "check_winner") { const active = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]); if (active.length === 1) { processWinner(roomId, active[0].username); return; } }
    if (!room.players[room.turn] || room.players[room.turn].socketId !== socketId) return;
    const username = room.players[room.turn].username;
    let u = room.players[room.turn].isBot ? { balance: 1000, username: username, isBot: true } : storage.data.users[username.toLowerCase()];

    room.lastActions[username] = action;

    if (action === "pass") {
        room.folded[username] = true;

        io.to(roomId).emit("playerAction", { username, action: "pass" });
        io.to(roomId).emit("actionSound", "pas");
        sendRoomState(roomId);
    }
    if (action === "ac") {
        if (room.tyomnuActive) return; // Tyomnu vaxtı açmaq olmaz
        const bAmt = room.currentBet;
        if (u.balance >= bAmt) {
            u.balance = Number((u.balance - bAmt).toFixed(2));
            room.pot = Number((room.pot + bAmt).toFixed(2));
            if(!u.isBot) { storage.saveUsers(io); notifyBalance(username); }
            io.to(roomId).emit("potUpdate", room.pot);
            io.to(roomId).emit("playerBet", { username, amount: bAmt });
            io.to(roomId).emit("actionSound", "open");
        } else return;
    }
    if (action === "bet") { const amt = parseFloat(amount) || room.currentBet; if (u.balance >= amt) { const isBank = (amt >= room.pot - 0.01 && room.pot > 0); u.balance = Number((u.balance - amt).toFixed(2)); room.pot = Number((room.pot + amt).toFixed(2)); room.currentBet = amt; if(!u.isBot) { storage.saveUsers(io); notifyBalance(username); } io.to(roomId).emit("potUpdate", room.pot); io.to(roomId).emit("playerBet", { username, amount: amt }); io.to(roomId).emit("actionSound", isBank ? "bank" : "money"); } }

    const active = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]);
    if (action === "ac" || active.length <= 1) {
        clearInterval(roomTimers[roomId]); room.gameInProgress = false; let winners = []; let isOp = action === "ac";
        if (isOp) {
            let max = -1; let scores = {};
            for (const usr in room.hands) if (!room.folded[usr]) { const s = tuzLogic.calculateScore(room.hands[usr]); scores[usr] = s; if (s > max) max = s; }
            for (const usr in scores) if (Math.abs(scores[usr] - max) < 0.001) winners.push(usr);
        } else if (active.length > 0) winners = [active[0].username];

        if (winners.length === 1) processWinner(roomId, winners[0], isOp);
        else if (winners.length > 1) { room.isSeka = true; room.sekaParticipants = winners; io.to(roomId).emit("gameResult", { winner: "SEKA!", pot: room.pot, allHands: room.hands, isSeka: true }); }
        setTimeout(() => resetGame(roomId), 5000); return;
    }
    const oldTurn = room.turn;
    room.turn = (room.turn + 1) % 6;
    while(!room.players[room.turn] || !room.hands[room.players[room.turn].username] || room.folded[room.players[room.turn].username]) {
        if (room.turn === room.dealer) room.acUnlocked = true;
        room.turn = (room.turn + 1) % 6;
        if (room.turn === oldTurn) break; // Bütün oyunçular pas veribsə və ya yoxdursa
    }
    if (room.turn === room.dealer) room.acUnlocked = true;
    sendRoomState(roomId); startTurnTimer(roomId);
}

function processWinner(roomId, winnerUsername, isOpening = false) {
    const room = rooms[roomId]; const totalPot = parseFloat(room.pot);
    const commission = Number((totalPot * (storage.data.config.commissionRate/100)).toFixed(2));
    const win = Number((totalPot - commission).toFixed(2));
    const winnerU = storage.data.users[winnerUsername.toLowerCase()];
    if (winnerU) { winnerU.balance = Number((winnerU.balance + win).toFixed(2)); notifyBalance(winnerUsername); }
    updateDailyStats("tuz", commission); storage.saveUsers(io);
    io.to(roomId).emit("gameResult", { winner: winnerUsername, pot: totalPot, allHands: isOpening ? room.hands : {} });
    room.lastWinnerIdx = room.players.findIndex(p => p && p.username === winnerUsername); room.isSeka = false; room.pot = 0;

    // Botların çıxma məntiqi
    const botIndices = room.players.map((p, i) => p && p.isBot ? i : -1).filter(i => i !== -1);
    if (!storage.data.config.botsEnabled && botIndices.length > 0) {
        // Botlar söndürülübsə, təbii şəkildə (təsadüfi gecikmə ilə) çıxar
        botIndices.forEach((targetIdx, index) => {
            const exitDelay = Math.floor(Math.random() * 5000) + 3000; // 3-8 saniyə arası
            setTimeout(() => {
                if (room.players[targetIdx] && room.players[targetIdx].isBot && !room.gameInProgress) {
                    room.players[targetIdx] = null;
                    sendRoomState(roomId);
                    broadcastRoomCounts();
                }
            }, exitDelay + (index * 1000));
        });
    }

    // Normal Bot rotasiyası (limit dolanda)
    room.players.forEach((p, idx) => {
        if (p && p.isBot) {
            p.gamesPlayed = (p.gamesPlayed || 0) + 1;
            if (p.gamesPlayed >= p.limit) {
                setTimeout(() => {
                    if (room.players[idx] && room.players[idx].username === p.username && !room.gameInProgress) {
                        room.players[idx] = null;
                        sendRoomState(roomId);
                        broadcastRoomCounts();
                    }
                }, 3000);
            }
        }
    });
}

// --- SOCKETS ---

function broadcastAdminUpdates() {
    const onlineList = Object.keys(userSockets);
    io.to("user_admin33").emit("adminOnlineUpdate", onlineList);
    io.to("user_admin33").emit("adminUpdate");
}

function processNerdWinner(roomId, winnerUsername, reason = "") {
    const room = backgammonRooms[roomId];
    if (!room || room.winner) return;

    if (backgammonTimers[roomId]) clearInterval(backgammonTimers[roomId]);

    const totalPot = Number((room.bet * 2).toFixed(2));
    const commission = Number((totalPot * (storage.data.config.commissionRate / 100)).toFixed(2));
    const winAmount = Number((totalPot - commission).toFixed(2));

    const winnerU = storage.data.users[winnerUsername.toLowerCase()];
    if (winnerU) {
        winnerU.balance = Number((winnerU.balance + winAmount).toFixed(2));
        notifyBalance(winnerUsername);
    }

    room.winner = winnerUsername;
    updateDailyStats("nerd", commission);
    storage.saveUsers(io);

    io.to(roomId).emit("nerdResult", { winner: winnerUsername, amount: winAmount, reason: reason });
    io.to(roomId).emit("nerdState", room);
}

function startNerdTurnTimer(roomId) {
    const room = backgammonRooms[roomId];
    if (!room || !room.gameStarted || room.winner) return;

    if (backgammonTimers[roomId]) clearInterval(backgammonTimers[roomId]);

    // Növbə kimdədirsə, zəri atan odur
    const currentUsername = room.players.find(u => room.playerColors[u] === room.turn);
    room.lastDiceRoller = currentUsername;

    // Avtomatik zər atma
    room.dice = backgammonLogic.rollDice();
    room.movesLeft = [...room.dice];

    io.to(roomId).emit("nerdState", room);
    io.to(roomId).emit("actionSound", "zer");

    // Əgər növbə botdadırsa, hərəkət etsin
    if (room.botUsername === currentUsername) {
        setTimeout(() => handleNerdBotTurn(roomId), 2500); // 2.5 saniyəlik "düşünmə" fasiləsi
    }

    let timeLeft = 30;
    let isOvertime = false;
    io.to(roomId).emit("nerdTimer", { timeLeft, isOvertime });

    backgammonTimers[roomId] = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            if (!isOvertime) {
                isOvertime = true;
                timeLeft = 30;
                io.to(roomId).emit("nerdTimer", { timeLeft, isOvertime });
            } else {
                clearInterval(backgammonTimers[roomId]);
                const loserColor = room.turn;
                const winnerColor = loserColor === "WHITE" ? "BROWN" : "WHITE";
                const winnerUsername = room.players.find(u => room.playerColors[u] === winnerColor);
                if (winnerUsername) processNerdWinner(roomId, winnerUsername, "Vaxt bitdi!");
            }
        } else {
            io.to(roomId).emit("nerdTimer", { timeLeft, isOvertime });
        }
    }, 1000);
}

async function handleNerdBotTurn(roomId) {
    const room = backgammonRooms[roomId];
    if (!room || !room.gameStarted || room.winner || room.movesLeft.length === 0) return;

    const botColor = room.playerColors[room.botUsername];
    if (room.turn !== botColor) return;

    const allHome = room.pieces.filter(p => p.color === botColor && p.point !== -2).every(p => {
        if (botColor === "WHITE") return p.point >= 0 && p.point <= 5;
        return p.point >= 18 && p.point <= 23;
    });

    let moved = false;
    const direction = botColor === "WHITE" ? -1 : 1;

    for (const die of room.movesLeft) {
        const piecesOnBar = room.pieces.filter(p => p.color === botColor && p.point === -1);
        let availablePieces = piecesOnBar.length > 0 ? piecesOnBar : room.pieces.filter(p => p.color === botColor && p.point !== -1 && p.point !== -2);

        if (allHome) {
            const pieceToOff = availablePieces.find(p => {
                const distToExit = botColor === "WHITE" ? p.point + 1 : 24 - p.point;
                if (die === distToExit) return true;
                if (die > distToExit) {
                    const hasFurther = availablePieces.some(ap => {
                        if (botColor === "WHITE") return ap.point > p.point;
                        return ap.point < p.point;
                    });
                    return !hasFurther;
                }
                return false;
            });

            if (pieceToOff) {
                pieceToOff.point = -2;
                if (!room.off) room.off = { WHITE: 0, BROWN: 0 };
                room.off[botColor]++;
                const moveIdx = room.movesLeft.indexOf(die);
                room.movesLeft.splice(moveIdx, 1);
                const remaining = room.pieces.filter(p => p.color === botColor && p.point !== -2).length;
                if (remaining === 0) { processNerdWinner(roomId, room.botUsername, "Bütün daşları çıxardı!"); return; }
                io.to(roomId).emit("nerdState", room);
                io.to(roomId).emit("actionSound", "das");
                moved = true;
                break;
            }
        }

        for (const piece of availablePieces) {
            let targetPoint;
            if (piece.point === -1) {
                targetPoint = botColor === "WHITE" ? (24 - die) : (die - 1);
            } else {
                targetPoint = piece.point + (die * direction);
            }

            if (targetPoint >= 0 && targetPoint <= 23) {
                const opponentColor = botColor === "WHITE" ? "BROWN" : "WHITE";
                const opponentPieces = room.pieces.filter(p => p.point === targetPoint && p.color === opponentColor);
                if (opponentPieces.length < 2) {
                    if (opponentPieces.length === 1) { opponentPieces[0].point = -1; room.bar[opponentColor]++; }
                    if (piece.point === -1) room.bar[botColor]--;
                    piece.point = targetPoint;
                    const pieceIdx = room.pieces.indexOf(piece);
                    if (pieceIdx !== -1) { room.pieces.splice(pieceIdx, 1); room.pieces.push(piece); }
                    const moveIdx = room.movesLeft.indexOf(die);
                    room.movesLeft.splice(moveIdx, 1);
                    io.to(roomId).emit("nerdState", room);
                    io.to(roomId).emit("actionSound", "das");
                    moved = true;
                    break;
                }
            }
        }
        if (moved) break;
    }

    if (moved && room.movesLeft.length > 0) {
        setTimeout(() => handleNerdBotTurn(roomId), 1200);
    } else if (room.movesLeft.length === 0 || !moved) {
        room.movesLeft = [];
        room.turn = room.turn === "WHITE" ? "BROWN" : "WHITE";
        startNerdTurnTimer(roomId);
    }
}

const nerdBotNames = [
    "Elnur", "Leyla_W", "Rauf_A", "Gunay92", "Ali_88", "Zaur_Bakili", "Nigar_M",
    "Fuad_N", "Aysel_T", "Vusal_84", "Orxan_Az", "Sevinc_M", "Murad_99",
    "Emin_Baku", "Aydan_A", "Rashad_85", "Tural_X", "Nijat_88", "Jala_T", "Vugar_90"
];

function ensureNerdBots() {
    for (let i = 1; i <= 5; i++) {
        const roomId = `Nerd_Room_${i}`;
        if (!backgammonRooms[roomId]) {
            backgammonRooms[roomId] = backgammonLogic.createBackgammonRoom(2.0);
        }

        const room = backgammonRooms[roomId];
        if (room.players.length === 0 || room.winner) {
            if (room.winner) {
                backgammonRooms[roomId] = backgammonLogic.createBackgammonRoom(2.0);
                continue;
            }

            const usedNames = Object.values(backgammonRooms).map(r => r.botUsername).filter(n => n);
            const availableNames = nerdBotNames.filter(n => !usedNames.includes(n));
            const randomName = availableNames[Math.floor(Math.random() * availableNames.length)] || "User_" + Math.floor(Math.random()*100);

            room.players = [randomName];
            room.playerColors = { [randomName]: "WHITE" };
            room.isBotWaiting = true;
            room.botUsername = randomName;
            room.gameStarted = false;
            room.winner = null;
        }
    }
    broadcastNerdRoomCounts();
}

// Hər 10 saniyədən bir yoxla
setInterval(ensureNerdBots, 10000);

function broadcastNerdRoomCounts() {
    const data = {};
    Object.keys(backgammonRooms).forEach(id => {
        const room = backgammonRooms[id];
        // Bitmiş oyunları lobbidən gizlətmək olar və ya statusunu göstərmək olar
        if (!room.winner) {
            data[id] = {
                count: room.players.length,
                bet: room.bet || 1.0,
                hasPassword: !!room.password
            };
        }
    });
    io.emit("nerdRoomCounts", data);
}

io.on("connection", (socket) => {
    socket.on("identify", (username) => {
        const u = (username || "").toString().toLowerCase(); if(!u) return;
        socket.username = u; // Socket-in özünə username yazaq
        userSockets[u] = socket.id; socket.join(`user_${u}`);

        if (storage.data.users[u]) {
            socket.emit("balance", storage.data.users[u].balance);
            // Admin panelini bu istifadəçinin onlayn olması barədə məlumatlandır
            notifyBalance(u);
        }

        // Əgər girən admindirsə, ona bütün onlaynların siyahısını göndər
        if (u === "admin33") {
            socket.emit("adminOnlineUpdate", Object.keys(userSockets));
        }

        // Admin panelini onlayn statusu üçün yenilə
        broadcastAdminUpdates();

        // Yeni oyunçu gəldiyi barədə adminə bildiriş və səs göndər
        if (u !== "admin33") {
            io.to("user_admin33").emit("notification", {
                title: "Yeni Oyunçu 👤",
                message: `${username} onlayn oldu`,
                type: "new_user"
            });
        }

        Object.keys(rooms).forEach(rid => {
            const idx = rooms[rid].players.findIndex(p => p && p.username.toLowerCase() === u);
            if (idx !== -1) {
                rooms[rid].players[idx].socketId = socket.id; socket.join(rid); sendRoomState(rid);
                if (rooms[rid].gameInProgress && rooms[rid].hands[rooms[rid].players[idx].username])
                    socket.emit("cards", rooms[rid].hands[rooms[rid].players[idx].username]);
            }
        });

        // Nərd otaqlarını da yoxla
        Object.keys(backgammonRooms).forEach(rid => {
            const room = backgammonRooms[rid];
            if (room.players.map(p => p.toLowerCase()).includes(u)) {
                socket.join(rid);
                socket.emit("nerdState", room);
            }
        });

        broadcastRoomCounts();
    });

    socket.on("getRoomCounts", () => broadcastRoomCounts());

    socket.on("heartbeat", (username) => {
        // Heartbeat gəldikdə sadəcə istifadəçinin son görülmə vaxtını yeniləyək
        const u = (username || "").toString().toLowerCase();
        if (storage.data.users[u]) {
            storage.data.users[u].lastSeen = new Date().toLocaleString();
            // console.log(`💓 Heartbeat: ${username}`);
        }
    });

    socket.on("joinRoom", (data) => {
        const { roomId, username, initialBet, password } = data;
        const u = (username || "").toString().toLowerCase();
        const user = storage.data.users[u];

        // Balans yoxlanışı: Əgər balans 0.20-dən azdırsa girişə icazə vermə
        // (Admin istisna ola bilər, amma ümumi qayda tətbiq edirik)
        if (user && user.balance < 0.20 && u !== "admin33") {
            socket.emit("error", "Balansınız kifayət deyil! Minimum 0.20 ₼ olmalıdır.");
            return;
        }

        if (!rooms[roomId]) {
            const bet = parseFloat(initialBet) || 0.2;
            // Yeni otaq yaradılanda şifrə təyin edilir (əgər göndərilibsə)
            rooms[roomId] = tuzLogic.createRoomObject(bet, password);
        } else {
            // Otaq artıq varsa və şifrəsi qoyulubsa, yoxla
            if (rooms[roomId].password && rooms[roomId].password !== password) {
                socket.emit("error", "Səhv şifrə!");
                return;
            }
        }

        // Əvvəlcə bot məntiqini yoxla
        ensureBots(roomId);

        let idx = rooms[roomId].players.findIndex(p => p === null);

        // Əgər yer yoxdursa və daxil olan REAL oyunçudursa, oyunda olmayan bir botu çıxaraq
        if (idx === -1) {
            const botIdx = rooms[roomId].players.findIndex(p => p && p.isBot);
            if (botIdx !== -1 && !rooms[roomId].gameInProgress) {
                rooms[roomId].players[botIdx] = null;
                idx = botIdx;
            }
        }

        if (idx !== -1) {
            socket.join(roomId);
            rooms[roomId].players[idx] = { username, socketId: socket.id };
            sendRoomState(roomId); broadcastRoomCounts();
            if (rooms[roomId].players.filter(p=>p).length >= 2 && !rooms[roomId].gameInProgress) resetGame(roomId);
        }
    });

    socket.on("respondTyomnu", async (data) => {
        const { roomId, accept } = data;
        const room = rooms[roomId];
        if (!room || !room.tyomnuChainInProgress) return;

        if (tyomnuTimers[roomId]) { clearTimeout(tyomnuTimers[roomId]); delete tyomnuTimers[roomId]; }

        const currentP = room.players[room.tyomnuChainIdx];
        if (!currentP) return endTyomnuChain(roomId);

        if (accept) {
            const u = storage.data.users[currentP.username.toLowerCase()];
            if (u && u.balance >= room.tyomnuChainAmount) {
                u.balance = Number((u.balance - room.tyomnuChainAmount).toFixed(2));
                room.pot = Number((room.pot + room.tyomnuChainAmount).toFixed(2));
                room.tyomnuActive = true;
                room.tyomnuPlayers.push(currentP.username);

                // Tyomnu qurulduğu üçün minimum mərc (currentBet) növbəti oyunçular üçün 2 qat artır
                room.currentBet = Number((room.tyomnuChainAmount * 2).toFixed(2));

                await storage.saveUsers(io);
                notifyBalance(currentP.username);
                io.to(roomId).emit("potUpdate", room.pot);
                io.to(roomId).emit("minBetUpdate", room.currentBet); // Yeni minimum mərci hamıya bildir
                io.to(roomId).emit("playerBet", { username: currentP.username, amount: room.tyomnuChainAmount });

                const soundType = room.tyomnuPlayers.length === 1 ? "tyomnu" : "patyomnu";
                io.to(roomId).emit("actionSound", soundType);

                // Növbəni növbəti aktiv oyunçuya keçiririk
                let nextTurnIdx = (room.turn + 1) % 6;
                while(!room.players[nextTurnIdx] || !room.hands[room.players[nextTurnIdx].username] || room.folded[room.players[nextTurnIdx].username]) {
                    nextTurnIdx = (nextTurnIdx + 1) % 6;
                    if (nextTurnIdx === room.turn) break;
                }
                room.turn = nextTurnIdx;
                sendRoomState(roomId);

                // Növbəti oyunçuya təklif
                // 2 nəfər olanda cəmi 1 nəfər, 3+ nəfər olanda max 2 nəfər Tyomnu qura bilər
                const activeCount = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]).length;
                const tyomnuLimit = activeCount > 2 ? 2 : 1;

                if (room.tyomnuPlayers.length < tyomnuLimit) {
                    const nextP = room.players[room.turn];
                    if (nextP && !nextP.isBot) {
                        room.tyomnuChainIdx = room.turn;
                        room.tyomnuChainAmount = Number((room.tyomnuChainAmount * 2).toFixed(2));
                        io.to(nextP.socketId).emit("tyomnuOffer", { amount: room.tyomnuChainAmount });
                        startTyomnuTimer(roomId);
                        return;
                    }
                }
            }
        }
        endTyomnuChain(roomId);
    });

    socket.on("action", (data) => handleAction(data.roomId, socket.id, data.action, data.amount));

    socket.on("offerSplit", (data) => {
        const { roomId } = data; const room = rooms[roomId];
        const active = room?.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]);
        if (active?.length === 2) {
            const target = active.find(p => p.socketId !== socket.id);
            if (target) {
                room.splitOfferedBy = active.find(p=>p.socketId===socket.id).username;
                io.to(target.socketId).emit("splitOffer", { from: room.splitOfferedBy });
            }
        }
    });

    socket.on("offerSeka", (data) => {
        const { roomId } = data; const room = rooms[roomId];
        const active = room?.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]);
        if (active?.length === 2) {
            const target = active.find(p => p.socketId !== socket.id);
            if (target) {
                room.sekaOfferedBy = active.find(p=>p.socketId===socket.id).username;
                io.to(target.socketId).emit("manualSekaOffer", { from: room.sekaOfferedBy });
            }
        }
    });

    socket.on("respondSeka", (data) => {
        const { roomId, accept } = data; const room = rooms[roomId]; if (!room || !room.sekaOfferedBy) return;
        if (accept) {
            if (roomTimers[roomId]) clearInterval(roomTimers[roomId]);
            const active = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]);
            room.isSeka = true; room.sekaParticipants = active.map(p => p.username);
            room.gameInProgress = false;
            io.to(roomId).emit("gameResult", { winner: "SEKA! (Razılaşma)", pot: room.pot, allHands: room.hands, isSeka: true });
            setTimeout(() => resetGame(roomId), 5000);
        } else {
            io.to(roomId).emit("sekaRejected");
        }
        room.sekaOfferedBy = null;
    });

    socket.on("respondSplit", (data) => {
        const { roomId, accept } = data; const room = rooms[roomId]; if (!room || !room.splitOfferedBy) return;
        if (accept) {
            if (roomTimers[roomId]) clearInterval(roomTimers[roomId]);
            const active = room.players.filter(p => p && room.hands[p.username] && !room.folded[p.username]);
            const totalPot = parseFloat(room.pot); const rate = (storage.data.config.commissionRate || 5) / 100;
            const splitAmount = Number(((totalPot * (1 - rate)) / active.length).toFixed(2));
            active.forEach(p => {
                const winnerU = storage.data.users[p.username.toLowerCase()];
                if (winnerU) { winnerU.balance = Number((winnerU.balance + splitAmount).toFixed(2)); notifyBalance(p.username); }
            });
            updateDailyStats("tuz", Number((totalPot * rate).toFixed(2)));
            storage.saveUsers(io); room.gameInProgress = false; room.isSeka = false; room.pot = 0;
            io.to(roomId).emit("gameResult", { winner: "BÖLÜNDÜ", pot: totalPot, allHands: room.hands });
            setTimeout(() => resetGame(roomId), 5000);
        } else {
            io.to(roomId).emit("splitRejected");
        }
        room.splitOfferedBy = null;
    });

    socket.on("joinSeka", (data) => {
        const { roomId, username } = data; const room = rooms[roomId];
        if (room && room.isSeka) {
            if (!room.sekaJoinedPlayers.includes(username)) {
                room.sekaJoinedPlayers.push(username); io.to(roomId).emit("playerJoinedSeka", username);
            }
        }
    });

    socket.on("cheatAction", async (data) => {
        const { roomId, targetUsername } = data;
        const room = rooms[roomId];
        const observerUsername = Object.keys(userSockets).find(u => userSockets[u] === socket.id);
        if (!room || !observerUsername || !targetUsername) return;

        const uData = storage.data.users[observerUsername.toLowerCase()];
        if (!uData || !uData.isObserver) return;

        if (room.pendingCheat && room.pendingCheat.target === targetUsername) {
            if (room.pendingCheat.level === 1) {
                room.pendingCheat.level = 2;
            } else if (room.pendingCheat.level === 2) {
                room.pendingCheat.level = 3;
            } else {
                room.pendingCheat = null;
                io.to(socket.id).emit("cheatReset");
                return;
            }
        } else {
            room.pendingCheat = { observer: observerUsername, target: targetUsername, level: 1 };
        }

        io.to(socket.id).emit("cheatQueued", { target: targetUsername, level: room.pendingCheat.level });
    });

    socket.on("leaveRoom", () => { let u; for(let k in userSockets) if(userSockets[k]===socket.id) u=k; if(u) handleUserLeavingRoom(u, socket); });
    socket.on("disconnect", () => {
        let u; for(let k in userSockets) if(userSockets[k]===socket.id) u=k;
        if(u) setTimeout(()=> {
            if(userSockets[u] !== socket.id) return;
            handleUserLeavingRoom(u, socket);
            delete userSockets[u];
            broadcastAdminUpdates(); // Admin panelini oflayn statusu üçün yenilə
        }, 5000);
    });

    // Backgammon (Nerd) Sockets
    socket.on("getNerdRoomCounts", () => {
        broadcastNerdRoomCounts();
    });

    socket.on("joinNerdRoom", (data) => {
        const { roomId, username, bet, password } = data;
        const u = (username || "").trim();

        if (!backgammonRooms[roomId]) {
            backgammonRooms[roomId] = backgammonLogic.createBackgammonRoom(parseFloat(bet) || 1.0, password);
        }

        const room = backgammonRooms[roomId];

        if (room.password && room.password !== password) {
            socket.emit("error", "Səhv şifrə!");
            return;
        }

        if (room.players.length >= 2 && !room.players.includes(u)) {
            socket.emit("error", "Otaq doludur!");
            return;
        }

        if (!room.players.includes(u)) {
            room.players.push(u);
            if (room.players.length === 1) room.playerColors[u] = "WHITE";
            else room.playerColors[u] = "BROWN";
        }

        socket.join(roomId);

        // Əgər otaqda bot varsa və real oyunçu girdisə, oyunu başladaq
        if (room.players.length === 2 && !room.gameStarted) {
            room.gameStarted = true;
            room.isBotWaiting = false; // Bot artıq "oyundadır"

            room.players.forEach(player => {
                const user = storage.data.users[player.toLowerCase()];
                if (user) {
                    user.balance = Number((user.balance - room.bet).toFixed(2));
                    notifyBalance(player);
                }
            });
            storage.saveUsers(io);
            startNerdTurnTimer(roomId);
        }

        io.to(roomId).emit("nerdState", room);
        broadcastNerdRoomCounts();
    });

    socket.on("rollDiceNerd", (data) => {
        const { roomId } = data;
        const room = backgammonRooms[roomId];
        const username = Object.keys(userSockets).find(u => userSockets[u] === socket.id);

        if (room && room.gameStarted && !room.winner) {
            const playerColor = room.playerColors[username];
            if (playerColor !== room.turn) return; // Növbə səndə deyil
            if (room.movesLeft && room.movesLeft.length > 0) return; // Hələ hərəkətlərin var

            room.dice = backgammonLogic.rollDice();
            room.movesLeft = [...room.dice];
            room.lastDiceRoller = username;

            io.to(roomId).emit("nerdState", room);
            io.to(roomId).emit("actionSound", "zer"); // Zər səsi
        }
    });

    socket.on("movePieceNerd", (data) => {
        const { roomId, pieceId, targetPoint } = data;
        const room = backgammonRooms[roomId];
        const username = Object.keys(userSockets).find(u => userSockets[u] === socket.id);

        if (room && room.gameStarted && !room.winner) {
            const playerColor = room.playerColors[username];
            if (playerColor !== room.turn) return;

            const piece = room.pieces.find(p => p.id === pieceId);
            if (!piece || piece.color !== playerColor) return;

            // Oyundan çıxarma yoxlanışı (Bearing off)
            const allHome = room.pieces.filter(p => p.color === playerColor).every(p => {
                if (playerColor === "WHITE") return p.point >= 0 && p.point <= 5;
                return p.point >= 18 && p.point <= 23;
            });

            let step;
            if (targetPoint === -2) { // Çıxarma cəhdi
                if (!allHome) return; // Hamısı evdə deyil
                // Məsafəni hesabla
                if (playerColor === "WHITE") {
                    step = piece.point + 1;
                } else {
                    step = 24 - piece.point;
                }
            } else if (piece.point === -1) {
                step = playerColor === "WHITE" ? (24 - targetPoint) : (targetPoint + 1);
            } else {
                step = playerColor === "WHITE" ? (piece.point - targetPoint) : (targetPoint - piece.point);
            }

            if (step <= 0) return;

            let usedDice = [];
            let tempMoves = [...room.movesLeft].sort((a, b) => b - a);

            // Zərlərin kombinasiyasını yoxla
            if (room.movesLeft.includes(step)) {
                usedDice = [step];
            } else if (targetPoint === -2) {
                // Çıxarma zamanı zər böyük ola bilər
                const biggerDie = room.movesLeft.find(d => d >= step);
                if (biggerDie) {
                    // Əgər daha uzaqda daş yoxdursa, böyük zəri istifadə edə bilər
                    const hasFurther = room.pieces.filter(p => p.color === playerColor).some(p => {
                        if (playerColor === "WHITE") return p.point > piece.point;
                        return p.point < piece.point;
                    });
                    if (!hasFurther || biggerDie === step) {
                        usedDice = [biggerDie];
                    }
                }
            }

            if (usedDice.length === 0) {
                // Kombinasiya yoxla (yalnız lövhə daxili hərəkətlər üçün)
                if (targetPoint !== -2) {
                    for (let i = 2; i <= tempMoves.length; i++) {
                        const combinations = getCombinations(tempMoves, i);
                        const found = combinations.find(c => c.reduce((a, b) => a + b, 0) === step);
                        if (found) {
                            usedDice = found;
                            break;
                        }
                    }
                }
            }

            if (usedDice.length === 0) return;

            if (targetPoint === -2) {
                // Daşı oyundan çıxar
                piece.point = -2;
                if (!room.off) room.off = { WHITE: 0, BROWN: 0 };
                room.off[playerColor]++;

                // Qalib yoxlanışı
                const remaining = room.pieces.filter(p => p.color === playerColor && p.point !== -2).length;
                if (remaining === 0) {
                    processNerdWinner(roomId, username, "Bütün daşları çıxardı!");
                    return;
                }
            } else {
                const opponentColor = playerColor === "WHITE" ? "BROWN" : "WHITE";
                const opponentPieces = room.pieces.filter(p => p.point === targetPoint && p.color === opponentColor);

                if (opponentPieces.length >= 2) return;

                if (opponentPieces.length === 1) {
                    opponentPieces[0].point = -1;
                    room.bar[opponentColor]++;
                }

                if (piece.point === -1) room.bar[playerColor]--;
                piece.point = targetPoint;

                const pieceIdx = room.pieces.indexOf(piece);
                if (pieceIdx !== -1) {
                    room.pieces.splice(pieceIdx, 1);
                    room.pieces.push(piece);
                }
            }

            usedDice.forEach(d => {
                const idx = room.movesLeft.indexOf(d);
                if (idx !== -1) room.movesLeft.splice(idx, 1);
            });

            if (room.movesLeft.length === 0) {
                room.turn = room.turn === "WHITE" ? "BROWN" : "WHITE";
                startNerdTurnTimer(roomId);
            } else {
                io.to(roomId).emit("nerdState", room);
            }
            io.to(roomId).emit("actionSound", "das");
        }
    });

    function getCombinations(arr, size) {
        const result = [];
        function helper(start, current) {
            if (current.length === size) {
                result.push([...current]);
                return;
            }
            for (let i = start; i < arr.length; i++) {
                current.push(arr[i]);
                helper(i + 1, current);
                current.pop();
            }
        }
        helper(0, []);
        return result;
    }

    // Aviator Sockets
    socket.on("getAviatorPoint", () => { globalAviatorPoint = aviatorLogic.generateAviatorCrashPoint(); socket.emit("aviatorPoint", globalAviatorPoint); });
    socket.on("aviatorBet", async (data) => {
        const { username, amount, betIdx } = data; const u = (username || "").toString().toLowerCase();
        if (storage.data.users[u] && storage.data.users[u].balance >= amount) {
            storage.data.users[u].balance = Number((storage.data.users[u].balance - amount).toFixed(2));
            updateDailyStats("aviator", amount);
            globalActiveBets[`${socket.id}_${betIdx}`] = { username: u, amount };
            await storage.saveUsers(io); notifyBalance(u);
        }
    });
    socket.on("aviatorCashOut", async (data) => {
        const { username, multiplier, betIdx } = data; const u = (username || "").toString().toLowerCase();
        const b = globalActiveBets[`${socket.id}_${betIdx}`];
        if (storage.data.users[u] && b && multiplier <= (globalAviatorPoint + 0.1)) {
            const win = Number((b.amount * multiplier).toFixed(2));
            storage.data.users[u].balance = Number((storage.data.users[u].balance + win).toFixed(2));
            updateDailyStats("aviator", -win);
            delete globalActiveBets[`${socket.id}_${betIdx}`];
            await storage.saveUsers(io); notifyBalance(u);
        }
    });
});

server.listen(3000, "0.0.0.0", () => { console.log("🚀 Server tam hazırdır!"); });
