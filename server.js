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
    
    // Якщо гравець повернувся (має userId)
    if (currentUserId && players[currentUserId]) {
        console.log(`[Reconnect] Гравець '${players[currentUserId].name}' повернувся в гру.`);
        players[currentUserId].socketId = socket.id; // Оновлюємо ID сокета
        socket.join(currentUserId);
        // Негайно надсилаємо йому актуальний стан гри
        socket.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
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

    socket.on('admin_update_zone', (newZone) => {
        if (isAdmin === 'true') {
            gameZone = newZone;
            broadcastToPlayers('game_event', '⚠️ Адміністратор оновив ігрову зону!');
            broadcastLobbyUpdate();
        }
    });

    socket.on('admin_broadcast_message', (message) => {
        if (isAdmin === 'true') {
            broadcastToPlayers('game_event', `🗣️ [ОГОЛОШЕННЯ] ${message}`);
        }
    });

    socket.on('admin_start_game', () => {
        if (isAdmin === 'true' && gameState === 'LOBBY') {
            gameState = 'IN_PROGRESS';
            console.log('[Admin] Гру розпочато!');
            io.emit('game_started');
            broadcastLobbyUpdate();
        }
    });
    
    socket.on('admin_reset_game', () => {
        if (isAdmin === 'true') {
            // Не видаляємо гравців, а лише скидаємо стан гри
            Object.values(players).forEach(p => {
                p.location = null;
                p.eliminated = false;
            });
            gameState = 'LOBBY';
            console.log('[Admin] Гра скинута до стану лобі.');
            broadcastLobbyUpdate();
            io.emit('game_reset');
        }
    });

    socket.on('disconnect', () => {
        let disconnectedPlayer = Object.values(players).find(p => p.socketId === socket.id);
        if (disconnectedPlayer) {
            console.log(`[Disconnect] Гравець '${disconnectedPlayer.name}' тимчасово відключився.`);
        }
    });
});

function broadcastLobbyUpdate() {
    io.emit('game_state_update', { gameState, players: Object.values(players), zone: gameZone });
}

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
            players: [players[pId]],
            zone: gameZone,
        };
        io.to(pId).emit('game_update', playerData);
    }
}

server.listen(PORT, '0.0.0.0', () => console.log(`[Сервер] Сервер успішно запущено на порті ${PORT}`));