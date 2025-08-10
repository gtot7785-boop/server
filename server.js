const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Будемо генерувати унікальні ID для гравців

const PORT = 8080;
const ADMIN_USER_ID = "super-secret-admin-key-123";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Обслуговуємо адмінку та карту гравця
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/player.html', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));

// --- Стан гри ---
let players = {}; // { userId: { id, name, location, ... } }
let gameState = 'LOBBY'; // Можливі стани: 'LOBBY', 'IN_PROGRESS'

// --- Ігровий цикл (запускається тільки коли гра в процесі) ---
setInterval(() => {
    if (gameState !== 'IN_PROGRESS') return;
    
    // Тут буде логіка зони, коли ви її додасте.
    // Зараз вона не виконується, поки гра не почалася.
    
    updateGameData(); // Регулярно надсилаємо оновлення під час гри
}, 2000);

io.on('connection', (socket) => {
    const { userId, isAdmin } = socket.handshake.query;

    if (isAdmin === 'true') {
        socket.join('admins');
        console.log(`[Connect] Адміністратор підключився.`);
        // Надсилаємо адміну поточний стан при підключенні
        socket.emit('game_state_update', { gameState, players: Object.values(players) });
    }

    // Нова подія для приєднання до гри
    socket.on('join_game', (playerName, callback) => {
        if (gameState !== 'LOBBY') {
            return callback({ success: false, message: 'Гра вже почалася.' });
        }
        
        const newPlayerId = uuidv4(); // Генеруємо унікальний ID
        players[newPlayerId] = {
            id: newPlayerId,
            name: playerName,
            location: null,
            eliminated: false,
        };

        console.log(`[Join] Гравець '${playerName}' приєднався з ID: ${newPlayerId}`);
        callback({ success: true, userId: newPlayerId });
        
        // Оновлюємо інформацію для всіх
        broadcastLobbyUpdate();
    });
    
    // Коли гравець з додатку перепідключається
    if (userId && players[userId]) {
        socket.join(userId);
        socket.on('update_location', (locationData) => {
            if (players[userId]) {
                players[userId].location = locationData;
            }
        });
    }

    // --- Адмін-команди ---
    socket.on('admin_start_game', () => {
        if (gameState === 'LOBBY') {
            gameState = 'IN_PROGRESS';
            console.log('[Admin] Гру розпочато!');
            io.emit('game_started'); // Повідомляємо всім клієнтам, що гра почалася
            broadcastLobbyUpdate(); // Останнє оновлення лобі
        }
    });
    
    socket.on('admin_reset_game', () => {
        players = {};
        gameState = 'LOBBY';
        console.log('[Admin] Гра скинута до стану лобі.');
        broadcastLobbyUpdate();
    });
});

// Функція для розсилки стану лобі
function broadcastLobbyUpdate() {
    io.emit('game_state_update', { gameState, players: Object.values(players) });
}

// Функція для розсилки ігрових даних (положення на карті)
function updateGameData() {
    const dataForAdmin = { gameState, players: Object.values(players) };
    io.to('admins').emit('game_state_update', dataForAdmin);

    for (const pId in players) {
        const playerData = {
            gameState,
            players: [players[pId]], // Гравець бачить тільки себе
            // ... можна додати інфу про зону
        };
        io.to(pId).emit('game_update', playerData);
    }
}