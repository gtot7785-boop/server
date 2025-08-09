const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const PORT = 8080;
const ADMIN_USER_ID = "super-secret-admin-key-123";
const OUT_OF_ZONE_TIMER = 600; // 10 хвилин в секундах

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// --- Стан гри ---
let users = {}; // { username: password }
let players = {}; // { userId: { id, name, location, socketId, isOutOfZone, outOfZoneSince, eliminated } }
let gameZone = {
  latitude: 50.7472,
  longitude: 25.3253,
  radius: 5000,
};

// Функція для розрахунку відстані між двома точками
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Радіус Землі в метрах
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- ГОЛОВНИЙ ІГРОВИЙ ЦИКЛ ---
setInterval(() => {
    const now = Math.floor(Date.now() / 1000); // Поточний час в секундах
    let needsUpdate = false;

    for (const userId in players) {
        const player = players[userId];
        if (player.eliminated || !player.location) continue;

        const distance = getDistance(
            player.location.latitude, player.location.longitude,
            gameZone.latitude, gameZone.longitude
        );

        // Перевірка, чи гравець поза зоною
        if (distance > gameZone.radius) {
            if (!player.isOutOfZone) {
                player.isOutOfZone = true;
                player.outOfZoneSince = now;
                needsUpdate = true;
                broadcastEvent(`Гравець ${player.name} вийшов за межі зони!`);
            }
            // Перевірка, чи не вичерпався час
            if (now - player.outOfZoneSince > OUT_OF_ZONE_TIMER) {
                player.eliminated = true;
                needsUpdate = true;
                broadcastEvent(`Гравець ${player.name} вибув (час вийшов)!`);
            }
        } else {
            if (player.isOutOfZone) {
                player.isOutOfZone = false;
                player.outOfZoneSince = null;
                needsUpdate = true;
                broadcastEvent(`Гравець ${player.name} повернувся в зону!`);
            }
        }
    }

    if (needsUpdate) {
        updateViewers();
    }
}, 1000); // Перевіряємо кожну секунду

io.on('connection', (socket) => {
    const { userId, isBeacon } = socket.handshake.query;
    if (!userId) return socket.disconnect();

    if (isBeacon) {
        // Логіка для маячків
        players[userId].beaconSocketId = socket.id;
        socket.on('update_location', (locationData) => {
            if (players[userId]) {
                players[userId].location = locationData;
                updateViewers();
            }
        });
    } else {
        // Логіка для веб-глядачів (гравці та адмін)
        if (userId === ADMIN_USER_ID) {
            socket.on('admin_update_zone', (newZone) => {
                gameZone = newZone;
                broadcastEvent('Адміністратор оновив ігрову зону!');
                updateViewers();
            });
            socket.on('admin_eliminate_player', (playerId) => {
                if (players[playerId]) {
                    players[playerId].eliminated = true;
                    broadcastEvent(`Гравець ${players[playerId].name} був виключений адміном!`);
                    updateViewers();
                }
            });
            socket.on('admin_broadcast_message', (message) => {
                broadcastEvent(`[ОГОЛОШЕННЯ] ${message}`);
            });
        }
    }
    
    // --- Система акаунтів ---
    socket.on('register', ({ username, password }, callback) => {
        if (users[username]) {
            return callback({ success: false, message: 'Користувач вже існує' });
        }
        users[username] = password;
        console.log(`[Реєстрація] Новий користувач: ${username}`);
        callback({ success: true });
    });

    socket.on('login', ({ username, password }, callback) => {
        if (users[username] && users[username] === password) {
            const newUserId = `user-${username}`;
            players[newUserId] = {
                id: newUserId,
                name: username,
                location: null,
                isOutOfZone: false,
                outOfZoneSince: null,
                eliminated: false,
            };
            console.log(`[Вхід] Користувач ${username} увійшов в систему.`);
            callback({ success: true, userId: newUserId });
            updateViewers();
        } else {
            callback({ success: false, message: 'Неправильний логін або пароль' });
        }
    });

    updateViewers(); // Надсилаємо дані при підключенні

    socket.on('disconnect', () => {
        if (players[userId]) {
            delete players[userId].beaconSocketId;
        }
        updateViewers();
    });
});

function broadcastEvent(message) {
    io.emit('game_event', message);
}

function updateViewers() {
    const now = Math.floor(Date.now() / 1000);
    io.sockets.sockets.forEach(socket => {
        const { userId, isBeacon } = socket.handshake.query;
        if (isBeacon) return;

        const fullData = { 
            players: Object.values(players), 
            zone: gameZone, 
            serverTime: now 
        };

        if (userId === ADMIN_USER_ID) {
            socket.emit('game_update', fullData);
        } else if (players[userId]) {
            const playerData = {
                ...fullData,
                players: [players[userId]], // Надсилаємо дані тільки про себе
            };
            socket.emit('game_update', playerData);
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Сервер] Сервер запущено на всіх інтерфейсах, порт ${PORT}`);
});
