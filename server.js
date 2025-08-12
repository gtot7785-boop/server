const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const VIBRATION_INTERVAL = 30000; // 30 секунд
const KICK_TIMEOUT = 600000; // 10 хвилин

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

server.on('error', (err) => console.error('[ПОМИЛКА СЕРВЕРА]:', err));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/player.html', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));

let players = {};
let gameState = 'LOBBY';
let gameZone = {
  latitude: 50.7472,
  longitude: 25.3253,
  radius: 5000,
};

// Функція для розрахунку відстані
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Радіус Землі в метрах
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Повертає відстань в метрах
}

// Головний ігровий цикл
setInterval(() => {
    if (gameState !== 'IN_PROGRESS') return;
    
    // Перевіряємо кожного гравця
    Object.values(players).forEach(player => {
        if (!player.location) return;

        const distance = getDistance(
            player.location.latitude, player.location.longitude,
            gameZone.latitude, gameZone.longitude
        );

        if (distance > gameZone.radius) {
            // Гравець ПОЗА зоною
            if (!player.isOutside) {
                // Він щойно вийшов
                player.isOutside = true;
                player.outsideSince = Date.now();
                player.lastWarningTime = 0; // Скидаємо, щоб відразу надіслати попередження
                console.log(`Гравець '${player.name}' покинув зону.`);
            }

            // Перевіряємо, чи не час надіслати вібрацію
            if (Date.now() - player.lastWarningTime > VIBRATION_INTERVAL) {
                io.to(player.socketId).emit('vibrate_warning');
                player.lastWarningTime = Date.now();
            }

            // Перевіряємо, чи не час його "викинути" з гри
            if (Date.now() - player.outsideSince > KICK_TIMEOUT) {
                io.to(player.socketId).emit('game_event', 'Ви були занадто довго поза зоною і вибули з гри!');
                io.to(player.socketId).emit('game_reset'); // Команда на скидання до лобі
                delete players[player.id];
                broadcastLobbyUpdate(); // Оновлюємо список гравців для всіх
            }

        } else {
            // Гравець У ЗОНІ
            if (player.isOutside) {
                console.log(`Гравець '${player.name}' повернувся в зону.`);
                player.isOutside = false;
                player.outsideSince = null;
                io.to(player.socketId).emit('game_event', 'Ви повернулись у безпечну зону!');
            }
        }
    });

    updateGameData();
}, 2000); // Перевірка кожні 2 секунди

io.on('connection', (socket) => {
    const { isAdmin, userId } = socket.handshake.query;
    let currentUserId = userId || null;

    if (isAdmin === 'true') {
        socket.join('admins');
        console.log(`[Connect] Адміністратор підключився.`);
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    }
    else if (currentUserId && players[currentUserId]) {
        console.log(`[Reconnect] Гравець '${players[currentUserId].name}' повернувся в гру.`);
        players[currentUserId].socketId = socket.id;
        socket.join(currentUserId);
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    } 
    else if (currentUserId && !players[currentUserId]) {
        console.log(`[Invalid ID] Гравець з недійсним ID '${currentUserId}' спробував підключитись. Скидаємо.`);
        socket.emit('game_reset');
    }

    socket.on('join_game', (playerName, callback) => {
        if (gameState !== 'LOBBY') {
            return callback({ success: false, message: 'Гра вже почалася.' });
        }
        const newPlayerId = uuidv4();
        // Додаємо нові поля для гравця
        players[newPlayerId] = { 
            id: newPlayerId, 
            name: playerName, 
            socketId: socket.id, 
            location: null, 
            isOutside: false, 
            outsideSince: null,
            lastWarningTime: 0 
        };
        currentUserId = newPlayerId;
        socket.join(newPlayerId);
        console.log(`[Join] Гравець '${playerName}' приєднався.`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });
    
    // Решта коду без змін...
    socket.on('leave_game', () => { /* ... */ });
    socket.on('update_location', (locationData) => { /* ... */ });
    socket.on('admin_start_game', () => { /* ... */ });
    socket.on('admin_update_zone', (newZone) => { /* ... */ });
    socket.on('admin_broadcast_message', (message) => { /* ... */ });
    socket.on('admin_reset_game', () => { /* ... */ });
    socket.on('disconnect', () => { /* ... */ });
});

function broadcastLobbyUpdate() { /* ... */ }
function broadcastToPlayers(event, data) { /* ... */ }
function updateGameData() { /* ... */ }

// Залишаємо реалізації функцій без змін
function getLeaveGameHandler(currentUserId) { return () => { if (currentUserId && players[currentUserId]) { console.log(`[Leave] Гравець '${players[currentUserId].name}' покинув гру.`); delete players[currentUserId]; broadcastLobbyUpdate(); } } }
function getUpdateLocationHandler(currentUserId) { return (locationData) => { if (currentUserId && players[currentUserId]) { players[currentUserId].location = locationData; } } }
function getAdminStartGameHandler(isAdmin) { return () => { if (isAdmin === 'true' && gameState === 'LOBBY') { gameState = 'IN_PROGRESS'; console.log('[Admin] Гру розпочато!'); io.emit('game_started'); setTimeout(() => { updateGameData(); }, 500); } } }
function getAdminUpdateZoneHandler(isAdmin) { return (newZone) => { if (isAdmin === 'true') { gameZone = newZone; io.emit('force_reload'); } } }
function getAdminBroadcastMessageHandler(isAdmin) { return (message) => { if (isAdmin === 'true') { broadcastToPlayers('game_event', `🗣️ [ОГОЛОШЕННЯ] ${message}`); } } }
function getAdminResetGameHandler(isAdmin) { return () => { if (isAdmin === 'true') { players = {}; gameState = 'LOBBY'; console.log('[Admin] Гру скинуто, лобі очищено.'); io.emit('game_reset'); broadcastLobbyUpdate(); } } }
function getDisconnectHandler(socket, isAdmin) { return () => { const disconnectedPlayer = Object.values(players).find(p => p.socketId === socket.id); if (disconnectedPlayer) { console.log(`[Disconnect] Гравець '${disconnectedPlayer.name}' тимчасово відключився.`); } else if (isAdmin === 'true') { console.log(`[Disconnect] Адміністратор відключився.`); } } }

server.listen(PORT, '0.0.0.0', () => console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`));