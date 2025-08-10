const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs'); // Додано для роботи з файлами

const PORT = 8080;
const ADMIN_USER_ID = "super-secret-admin-key-123";
const OUT_OF_ZONE_TIMER = 600; // 10 хвилин в секундах
const USERS_DB_PATH = path.join(__dirname, 'users.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Обслуговуємо адмінку та карту гравця
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/player.html', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));

// --- Стан гри ---
let users = {};
let players = {}; // { userId: { ... } }
let gameZone = {
  latitude: 50.7472,
  longitude: 25.3253,
  radius: 5000,
};

// --- Завантаження та збереження користувачів ---
function loadUsers() {
    if (fs.existsSync(USERS_DB_PATH)) {
        const data = fs.readFileSync(USERS_DB_PATH);
        users = JSON.parse(data);
        console.log('[DB] База користувачів завантажена.');
    }
}
function saveUsers() {
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
}
loadUsers(); // Завантажуємо на старті

function getDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null) return Infinity;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const d = Math.acos(Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2) * Math.cos(Δλ)) * R;
    return d;
}

// --- ГОЛОВНИЙ ІГРОВИЙ ЦИКЛ (ОПТИМІЗОВАНО) ---
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    let needsUpdate = false;

    for (const userId in players) {
        const player = players[userId];
        if (player.eliminated) continue;

        const distance = getDistance(player.location?.latitude, player.location?.longitude, gameZone.latitude, gameZone.longitude);

        if (distance > gameZone.radius) {
            if (!player.isOutOfZone) {
                player.isOutOfZone = true;
                player.outOfZoneSince = now;
                needsUpdate = true;
                broadcastEvent(`Гравець ${player.name} вийшов за межі зони!`);
            }
            if (now - player.outOfZoneSince > OUT_OF_ZONE_TIMER) {
                player.eliminated = true;
                needsUpdate = true;
                broadcastEvent(`Гравець ${player.name} вибув (час вийшов)!`);
            }
        } else if (player.isOutOfZone) {
            player.isOutOfZone = false;
            player.outOfZoneSince = null;
            needsUpdate = true;
            broadcastEvent(`Гравець ${player.name} повернувся в зону!`);
        }
    }

    // Надсилаємо оновлення, тільки якщо щось змінилося
    if (needsUpdate) {
        updateViewers();
    }
}, 2000); // Збільшили інтервал до 2 секунд, щоб зменшити навантаження

// Оновлена логіка підключення
io.on('connection', (socket) => {
    const { userId, isBeacon } = socket.handshake.query;

    if (userId) {
        // Кожен клієнт приєднується до кімнати зі своїм ID
        socket.join(userId);
    }
    
    if (userId === ADMIN_USER_ID) {
        socket.join('admins'); // Адміни приєднуються до своєї кімнати
        console.log(`[Connect] Адміністратор підключився.`);
    }

    if (isBeacon === 'true' && userId && players[userId]) {
        players[userId].beaconSocketId = socket.id;
        console.log(`[Connect] Маячок гравця ${players[userId].name} підключився.`);
        
        socket.on('update_location', (locationData) => {
            if (players[userId]) {
                players[userId].location = locationData;
                // Замість повного оновлення, просто відправляємо дані всім, хто слухає
                updateViewers(); 
            }
        });
    }

    socket.on('register', ({ username, password }, callback) => {
        if (users[username]) return callback({ success: false, message: 'Користувач вже існує' });
        users[username] = password;
        saveUsers(); // Зберігаємо нових користувачів
        callback({ success: true });
    });

    socket.on('login', ({ username, password }, callback) => {
        if (users[username] === password) {
            const newUserId = `user-${username}`;
            if (!players[newUserId]) {
                players[newUserId] = {
                    id: newUserId, name: username, location: null, isOutOfZone: false,
                    outOfZoneSince: null, eliminated: false,
                };
            }
            callback({ success: true, userId: newUserId });
            broadcastEvent(`Гравець ${username} увійшов у гру!`);
            updateViewers(); // Оновлюємо всіх після входу нового гравця
        } else {
            callback({ success: false, message: 'Неправильний логін або пароль' });
        }
    });

    // Адмін-команди
    socket.on('admin_update_zone', (newZone) => {
        if (userId === ADMIN_USER_ID) {
            gameZone = newZone;
            broadcastEvent('Адміністратор оновив ігрову зону!');
            updateViewers();
        }
    });

    socket.on('admin_broadcast_message', (message) => {
        if (userId === ADMIN_USER_ID) {
            broadcastEvent(`[ОГОЛОШЕННЯ] ${message}`);
        }
    });

    // Надсилаємо початковий стан новому клієнту
    updateSingleViewer(socket);
});

function broadcastEvent(message) {
    io.emit('game_event', message);
}

// ОПТИМІЗОВАНА функція оновлення
function updateViewers() {
    const now = Math.floor(Date.now() / 1000);
    const fullData = { players: Object.values(players), zone: gameZone, serverTime: now };
    
    // Адміни отримують повну інформацію
    io.to('admins').emit('game_update', fullData);
    
    // Кожен гравець отримує інформацію тільки про себе
    for (const pId in players) {
        if (players[pId] && !players[pId].eliminated) {
            const playerData = {
                players: [players[pId]],
                zone: gameZone,
                serverTime: now
            };
            io.to(pId).emit('game_update', playerData);
        }
    }
}

// Функція для оновлення одного клієнта при підключенні
function updateSingleViewer(socket) {
    const { userId } = socket.handshake.query;
    if (!userId) return;

    const now = Math.floor(Date.now() / 1000);
    if (userId === ADMIN_USER_ID) {
        socket.emit('game_update', { players: Object.values(players), zone: gameZone, serverTime: now });
    } else if (players[userId]) {
        socket.emit('game_update', { players: [players[userId]], zone: gameZone, serverTime: now });
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`);
});