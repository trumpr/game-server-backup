const fs = require("fs").promises;
const { exec } = require("child_process");

const USERS_FILE = "users.json";
const REQUESTS_FILE = "requests.json";
const STATS_FILE = "daily_stats.json";
const CONFIG_FILE = "config.json";
const MESSAGES_FILE = "messages.json";

let data = {
    users: {},
    requests: [],
    dailyStats: {},
    config: { commissionRate: 5, botsEnabled: true, highBalanceAlertEnabled: true, botWinMode: false },
    adminMessages: []
};

async function loadData() {
    const safeParse = async (file, fallback) => {
        try {
            const content = await fs.readFile(file, "utf8");
            return content && content.trim() ? JSON.parse(content) : fallback;
        } catch (e) { return fallback; }
    };

    data.users = await safeParse(USERS_FILE, {});
    data.requests = await safeParse(REQUESTS_FILE, []);
    data.dailyStats = await safeParse(STATS_FILE, {});
    data.config = await safeParse(CONFIG_FILE, { commissionRate: 5, botsEnabled: true, highBalanceAlertEnabled: true });
    data.adminMessages = await safeParse(MESSAGES_FILE, []);

    // Legacy data check for stats
    Object.keys(data.dailyStats).forEach(date => {
        if (typeof data.dailyStats[date] === "number") {
            data.dailyStats[date] = { total: data.dailyStats[date], tuz: data.dailyStats[date], aviator: 0 };
        }
    });

    console.log("Məlumatlar storage modulu vasitəsilə yükləndi.");
}

function autoBackup() {
    // Hər 5 dəqiqədən bir çox tez-tez push etməmək üçün limit qoyula bilər,
    // amma hazırda hər dəyişiklikdə sinxronizasiya edir.
    exec('git add . && git commit -m "Avtomatik yedək: ' + new Date().toLocaleString() + '" && git push origin master',
    (error, stdout, stderr) => {
        if (error) {
            console.log("⚠️ Yedəkləmə xətası:", error.message);
        } else {
            console.log("✅ Məlumatlar GitHub-a sinxronizasiya olundu.");
        }
    });
}

async function saveUsers(io) {
    await fs.writeFile(USERS_FILE, JSON.stringify(data.users));
    if(io) io.to("user_admin33").emit("adminUpdate");
    autoBackup();
}
async function saveRequests(io) {
    await fs.writeFile(REQUESTS_FILE, JSON.stringify(data.requests));
    if(io) io.to("user_admin33").emit("adminUpdate");
    autoBackup();
}
async function saveStats(io) {
    await fs.writeFile(STATS_FILE, JSON.stringify(data.dailyStats));
    if(io) io.to("user_admin33").emit("adminUpdate");
    autoBackup();
}
async function saveMessages(io) {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(data.adminMessages));
    if(io) io.to("user_admin33").emit("adminUpdate");
    autoBackup();
}
async function saveConfig(io) {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(data.config));
    if(io) io.to("user_admin33").emit("adminUpdate");
    autoBackup();
}

module.exports = {
    data,
    loadData,
    saveUsers,
    saveRequests,
    saveStats,
    saveMessages,
    saveConfig
};
