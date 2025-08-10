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

// --- Стан гри ---
let players = {};
let gameState = 'LOBBY';
// !!! Повертаємо об'єкт ігрової зони
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
    let currentUserId = null; 
    const { isAdmin, userId: restoredUserId } = socket.handshake.query;

    if (isAdmin === 'true') {
        socket.join('admins');
        console.log(`[Connect] Адміністратор підключився.`);
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
    }
    
    // Якщо гравець перепідключається (наприклад, відкрив карту)
    if (restoredUserId && players[restoredUserId]) {
        currentUserId = restoredUserId;
        players[currentUserId].socketId = socket.id;
        socket.join(currentUserId);
    }

    socket.on('join_game', (playerName, callback) => {
        if (gameState !== 'LOBBY') {
            return callback({ success: false, message: 'Гра вже почалася.' });
        }
        const newPlayerId = uuidv4();
        players[newPlayerId] = { id: newPlayerId, name: playerName, socketId: socket.id, location: null, eliminated: false };
        currentUserId = newPlayerId;
        socket.join(newPlayerId);
        console.log(`[Join] Гравець '${playerName}' приєднався.`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });

    socket.on('update_location', (locationData) => {
        if (currentUserId && players[currentUserId]) {
            players[currentUserId].location = locationData;
        }
    });

    // --- Нові адмін-команди ---
    socket.on('admin_update_zone', (newZone) => {
        if (isAdmin === 'true') {
            gameZone = newZone;
            broadcastToPlayers('game_event', '⚠️ Адміністратор оновив ігрову зону!');
        }
    });

    socket.on('admin_broadcast_message', (message) => {
        if (isAdmin === 'true') {
            broadcastToPlayers('game_event', `🗣️ [ОГОЛОШЕННЯ] ${message}`);
        }
    });

    socket.on('admin_start_game', () => { /* ... без змін ... */ });
    socket.on('admin_reset_game', () => { /* ... без змін ... */ });

    socket.on('disconnect', () => {
        let disconnectedPlayerId = null;
        for (const pId in players) {
            if (players[pId].socketId === socket.id) {
                disconnectedPlayerId = pId;
                break;
            }
        }
        if (disconnectedPlayerId) {
            console.log(`[Disconnect] Гравець '${players[disconnectedPlayerId].name}' відключився.`);
            delete players[disconnectedPlayerId];
            broadcastLobbyUpdate();
        }
    });
});

function broadcastLobbyUpdate() {
    io.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
}

// Функція для розсилки подій тільки гравцям (не адміну)
function broadcastToPlayers(event, data) {
    Object.keys(players).forEach(pId => {
        io.to(pId).emit(event, data);
    });
}

function updateGameData() {
    const dataForAdmin = { gameState, players: Object.values(players), zone: gameZone };
    io.to('admins').emit('game_state_update', dataForAdmin);

    for (const pId in players) {
        const playerData = {
            gameState,
            players: [players[pId]], // Гравець бачить тільки себе
            zone: gameZone, // !!! Надсилаємо зону гравцю
        };
        io.to(pId).emit('game_update', playerData);
    }
}

server.listen(PORT, '0.0.0.0', () => console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`));