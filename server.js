const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const PORT = 8080;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Обслуговуємо файли сайту з папки 'public'
app.use(express.static(path.join(__dirname, 'public')));

// --- Стан гри ---
let players = {}; // { userId: { id, name, location, socketId } }
let gameZone = {
  latitude: 50.7472,
  longitude: 25.3253,
  radius: 5000,
};

io.on('connection', (socket) => {
  const { userId, isBeacon } = socket.handshake.query;

  if (!userId) {
    console.log(`[Сервер] Невідоме підключення без userId. Відключено.`);
    return socket.disconnect();
  }

  // Якщо це маячок (мобільний додаток)
  if (isBeacon) {
    console.log(`[Сервер] Маячок підключився: UserID ${userId}`);
    if (!players[userId]) {
      players[userId] = { id: userId, name: `Гравець ${userId.substring(0, 4)}`, location: null };
    }
    players[userId].beaconSocketId = socket.id; // Зберігаємо ID сокета маячка

    socket.on('update_location', (locationData) => {
      if (players[userId]) {
        players[userId].location = locationData;
        // Надсилаємо оновлення всім глядачам
        io.emit('game_update', { players: Object.values(players), zone: gameZone });
      }
    });
  }
  // Якщо це глядач (веб-браузер)
  else {
    console.log(`[Сервер] Глядач підключився: UserID ${userId}`);
  }

  // Надсилаємо актуальний стан гри всім при будь-якому підключенні
  io.emit('game_update', { players: Object.values(players), zone: gameZone });

  socket.on('disconnect', () => {
    // Якщо відключився маячок, гравець залишається у списку, але без сокета
    if (players[userId] && players[userId].beaconSocketId === socket.id) {
      console.log(`[Сервер] Маячок відключився: UserID ${userId}`);
      delete players[userId].beaconSocketId;
    } else {
      console.log(`[Сервер] Глядач відключився: UserID ${userId}`);
    }
    // Оновлюємо дані для всіх
    io.emit('game_update', { players: Object.values(players), zone: gameZone });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Сервер] Сервер запущено на всіх інтерфейсах, порт ${PORT}`);
});
