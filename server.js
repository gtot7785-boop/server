const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const ADMIN_USER_ID = "super-secret-admin-key-123";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// !!! ВАЖЛИВЕ ДОПОВНЕННЯ: Додаємо обробник помилок для сервера
server.on('error', (err) => {
  console.error('[ПОМИЛКА СЕРВЕРА]:', err);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/player.html', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));

let players = {};
let gameState = 'LOBBY';

setInterval(() => {
    if (gameState !== 'IN_PROGRESS') return;
    updateGameData();
}, 2000);

io.on('connection', (socket) => {
    const { userId, isAdmin } = socket.handshake.query;

    if (isAdmin === 'true') {
        socket.join('admins');
        console.log(`[Connect] Адміністратор підключився.`);
        socket.emit('game_state_update', { gameState, players: Object.values(players) });
    }

    socket.on('join_game', (playerName, callback) => {
        if (gameState !== 'LOBBY') {
            return callback({ success: false, message: 'Гра вже почалася.' });
        }
        const newPlayerId = uuidv4();
        players[newPlayerId] = {
            id: newPlayerId,
            name: playerName,
            location: null,
            eliminated: false,
        };
        console.log(`[Join] Гравець '${playerName}' приєднався з ID: ${newPlayerId}`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });

    if (userId && players[userId]) {
        socket.join(userId);
        socket.on('update_location', (locationData) => {
            if (players[userId]) {
                players[userId].location = locationData;
            }
        });
    }

    socket.on('admin_start_game', () => {
        if (gameState === 'LOBBY') {
            gameState = 'IN_PROGRESS';
            console.log('[Admin] Гру розпочато!');
            io.emit('game_started');
            broadcastLobbyUpdate();
        }
    });

    socket.on('admin_reset_game', () => {
        players = {};
        gameState = 'LOBBY';
        console.log('[Admin] Гра скинута до стану лобі.');
        broadcastLobbyUpdate();
    });
});

function broadcastLobbyUpdate() {
    io.emit('game_state_update', { gameState, players: Object.values(players) });
}

function updateGameData() {
    const dataForAdmin = { gameState, players: Object.values(players) };
    io.to('admins').emit('game_state_update', dataForAdmin);
    for (const pId in players) {
        const playerData = {
            gameState,
            players: [players[pId]],
        };
        io.to(pId).emit('game_update', playerData);
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`);
});