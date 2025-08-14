const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const MAIN_INTERVAL = 2000; // Головний цикл сервера (2 секунди)
const WARNING_INTERVAL = 60000; // Інтервал для попереджень (1 хвилина)
const KICK_TIMEOUT = 600000; // 10 хвилин
const WARNING_TICKS = WARNING_INTERVAL / MAIN_INTERVAL; // Кількість "тіків" до наступного попередження

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

function getDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

setInterval(() => {
    if (gameState !== 'IN_PROGRESS') return;
    
    const now = Date.now();
    Object.values(players).forEach(player => {
        if (!player || !player.location) return;

        const distance = getDistance(player.location.latitude, player.location.longitude, gameZone.latitude, gameZone.longitude);

        if (distance > gameZone.radius) {
            if (!player.isOutside) {
                player.isOutside = true;
                player.outsideSince = now;
                player.warningTickCounter = WARNING_TICKS; // Гарантуємо перше попередження відразу
            }
            
            player.warningTickCounter++;

            if (player.warningTickCounter >= WARNING_TICKS) {
                console.log(`[Warning] Надсилаю попередження гравцю ${player.name}`);
                io.to(player.socketId).emit('zone_warning');
                player.warningTickCounter = 0; // Скидаємо лічильник для наступної хвилини
            }
            
            if (now - player.outsideSince > KICK_TIMEOUT) {
                io.to(player.socketId).emit('game_event', 'Ви були занадто довго поза зоною і вибули з гри!');
                io.to(player.socketId).emit('game_reset');
                if (players[player.id]) delete players[player.id];
                broadcastLobbyUpdate();
            }
        } else {
            if (player.isOutside) {
                player.isOutside = false;
                player.outsideSince = null;
                player.warningTickCounter = 0;
                io.to(player.socketId).emit('game_event', 'Ви повернулись у безпечну зону!');
            }
        }
    });
    updateGameData();
}, MAIN_INTERVAL);

io.on('connection', (socket) => {
    const { isAdmin, userId } = socket.handshake.query;
    let currentUserId = userId || null;

    if (isAdmin === 'true') {
        socket.join('admins');
        console.log(`[Connect] Адміністратор підключився.`);
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    }
    else if (currentUserId && players[currentUserId]) {
        players[currentUserId].socketId = socket.id;
        socket.join(currentUserId);
        console.log(`[Reconnect] Гравець '${players[currentUserId].name}' повернувся в гру.`);
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    } 
    else if (currentUserId && !players[currentUserId]) {
        console.log(`[Invalid ID] Гравець з недійсним ID '${currentUserId}' спробував підключитись. Скидаємо.`);
        socket.emit('game_reset');
    }

    socket.on('join_game', (playerName, callback) => {
        if (gameState !== 'LOBBY') return callback({ success: false, message: 'Гра вже почалася.' });
        const newPlayerId = uuidv4();
        players[newPlayerId] = { id: newPlayerId, name: playerName, socketId: socket.id, location: null, isOutside: false, outsideSince: null, warningTickCounter: 0 };
        currentUserId = newPlayerId;
        socket.join(newPlayerId);
        console.log(`[Join] Гравець '${playerName}' приєднався.`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });
    
    socket.on('leave_game', () => {
        if (currentUserId && players[currentUserId]) {
            console.log(`[Leave] Гравець '${players[currentUserId].name}' покинув гру.`);
            delete players[currentUserId];
            broadcastLobbyUpdate();
        }
    });

    socket.on('update_location', (locationData) => {
        if (currentUserId && players[currentUserId]) {
            players[currentUserId].location = locationData;
        }
    });

    socket.on('admin_start_game', () => {
        if (isAdmin === 'true' && gameState === 'LOBBY') {
            gameState = 'IN_PROGRESS';
            console.log('[Admin] Гру розпочато!');
            io.emit('game_started');
            setTimeout(() => updateGameData(), 500);
        }
    });

    socket.on('admin_update_zone', (newZone) => {
        if (isAdmin === 'true') {
            gameZone = newZone;
            broadcastToPlayers('force_reload', {});
        }
    });

    socket.on('admin_broadcast_message', (message) => {
        if (isAdmin === 'true') {
            broadcastToPlayers('game_event', `🗣️ [ОГОЛОШЕННЯ] ${message}`);
        }
    });
    
    socket.on('admin_reset_game', () => {
        if (isAdmin === 'true') {
            // Скидаємо стан зони для всіх гравців, які є в лобі
            Object.values(players).forEach(p => {
                p.isOutside = false;
                p.outsideSince = null;
                p.warningTickCounter = 0;
            });
            gameState = 'LOBBY';
            console.log('[Admin] Гру скинуто. Стан гравців очищено.');
            io.emit('game_reset'); // Команда клієнтам повернутись в лобі
            broadcastLobbyUpdate(); // Оновлення списку гравців
        }
    });

    socket.on('disconnect', () => {
        const disconnectedPlayer = Object.values(players).find(p => p.socketId === socket.id);
        if (disconnectedPlayer) {
            console.log(`[Disconnect] Гравець '${disconnectedPlayer.name}' тимчасово відключився.`);
        } else if (isAdmin === 'true') {
            console.log(`[Disconnect] Адміністратор відключився.`);
        }
    });
});

function broadcastLobbyUpdate() {
    io.emit('game_state_update', { gameState, players: Object.values(players) });
}

function broadcastToPlayers(event, data) {
    Object.keys(players).forEach(pId => {
        if(players[pId] && players[pId].socketId) {
            io.to(players[pId].socketId).emit(event, data);
        }
    });
}

function updateGameData() {
    io.to('admins').emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    const now = Date.now();
    for (const pId in players) {
        if (players[pId] && players[pId].socketId) {
            const player = players[pId];
            const timeLeft = player.isOutside ? KICK_TIMEOUT - (now - player.outsideSince) : KICK_TIMEOUT;
            const playerData = { 
                gameState, 
                players: [player], 
                zone: gameZone, 
                zoneStatus: { 
                    isOutside: player.isOutside, 
                    timeLeft: timeLeft > 0 ? timeLeft : 0 
                }
            };
            io.to(pId).emit('game_update', playerData);
        }
    }
}

server.listen(PORT, '0.0.0.0', () => console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`));