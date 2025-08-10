const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
    // Зберігаємо userId, пов'язаний з цим сокетом, для подальшого використання
    let currentUserId = null; 

    const { isAdmin } = socket.handshake.query;

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
            socketId: socket.id, // !!! Зберігаємо ID сокета гравця
            location: null,
            eliminated: false,
        };

        currentUserId = newPlayerId; // Запам'ятовуємо, хто підключився
        socket.join(newPlayerId);
        console.log(`[Join] Гравець '${playerName}' приєднався з ID: ${newPlayerId}`);
        callback({ success: true, userId: newPlayerId });
        broadcastLobbyUpdate();
    });

    socket.on('update_location', (locationData) => {
        if (currentUserId && players[currentUserId]) {
            players[currentUserId].location = locationData;
        }
    });

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
    
    // !!! ОСНОВНА ЗМІНА: Обробляємо відключення
    socket.on('disconnect', () => {
        if (currentUserId && players[currentUserId]) {
            console.log(`[Disconnect] Гравець '${players[currentUserId].name}' відключився.`);
            delete players[currentUserId]; // Видаляємо гравця зі списку
            broadcastLobbyUpdate(); // Оновлюємо лобі для всіх
        }
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