const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;

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

setInterval(() => {
    if (gameState !== 'IN_PROGRESS') return;
    updateGameData();
}, 2000);

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
        const isNameTaken = Object.values(players).some(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (isNameTaken) {
            return callback({ success: false, message: 'Це ім\'я вже зайняте.' });
        }
        const newPlayerId = uuidv4();
        players[newPlayerId] = { id: newPlayerId, name: playerName, socketId: socket.id, location: null, eliminated: false };
        currentUserId = newPlayerId; // Важливо: оновлюємо ID для поточної сесії
        socket.join(newPlayerId);
        console.log(`[Join] Гравець '${playerName}' приєднався.`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });

    // !!! НОВИЙ ОБРОБНИК ДЛЯ ВИХОДУ З ГРИ !!!
    // Вирішує проблему "привидів" у лобі
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
            updateGameData();
        }
    });

    socket.on('admin_update_zone', (newZone) => {
        if (isAdmin === 'true') {
            gameZone = newZone;
            broadcastToPlayers('game_event', '⚠️ Адміністратор оновив ігровую зону!');
            updateGameData();
        }
    });

    socket.on('admin_broadcast_message', (message) => {
        if (isAdmin === 'true') {
            broadcastToPlayers('game_event', `🗣️ [ОГОЛОШЕННЯ] ${message}`);
        }
    });

    socket.on('admin_reset_game', () => {
        if (isAdmin === 'true') {
            players = {};
            gameState = 'LOBBY';
            console.log('[Admin] Гру скинуто, лобі очищено.');
            io.emit('game_reset');
            broadcastLobbyUpdate();
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
    const data = { gameState, players: Object.values(players), zone: gameZone };
    io.emit('game_state_update', data);
}

function broadcastToPlayers(event, data) {
    Object.keys(players).forEach(pId => {
        io.to(pId).emit(event, data);
    });
}

function updateGameData() {
    io.to('admins').emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    for (const pId in players) {
        if (players[pId].socketId) {
            const playerData = {
                gameState,
                players: [players[pId]],
                zone: gameZone,
            };
            io.to(pId).emit('game_update', playerData);
        }
    }
}

server.listen(PORT, '0.0.0.0', () => console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`));