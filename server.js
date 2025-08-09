const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const PORT = 8080;
// !!! ВАЖЛИВО: Це ваш секретний ID. Не діліться ним ні з ким. !!!
const ADMIN_USER_ID = "super-secret-admin-key-123";

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

  if (!userId) return socket.disconnect();

  // --- ЛОГІКА ДЛЯ МАЯЧКІВ (мобільних додатків) ---
  if (isBeacon) {
    console.log(`[Сервер] Маячок підключився: UserID ${userId}`);
    if (!players[userId]) {
      players[userId] = { id: userId, name: `Гравець ${userId.substring(0, 4)}`, location: null };
    }
    players[userId].beaconSocketId = socket.id;

    socket.on('update_location', (locationData) => {
      if (players[userId]) {
        players[userId].location = locationData;
        // Надсилаємо оновлення ВСІМ глядачам (і адміну, і гравцям)
        updateViewers();
      }
    });
  } 
  // --- ЛОГІКА ДЛЯ ГЛЯДАЧІВ (веб-браузерів) ---
  else {
    console.log(`[Сервер] Глядач підключився: UserID ${userId}`);
    // Якщо це адмін, додаємо йому слухачі для керування грою
    if (userId === ADMIN_USER_ID) {
        console.log(`[Сервер] !!! АДМІН УВІЙШОВ У СИСТЕМУ !!!`);
        socket.on('admin_update_zone', (newZone) => {
            gameZone = newZone;
            console.log(`[Адмін] Зона оновлена`);
            updateViewers();
        });
    }
  }

  // При будь-якому новому підключенні, надсилаємо актуальні дані
  updateViewers();

  socket.on('disconnect', () => {
    if (players[userId] && players[userId].beaconSocketId === socket.id) {
      console.log(`[Сервер] Маячок відключився: UserID ${userId}`);
      delete players[userId].beaconSocketId;
    } else {
      console.log(`[Сервер] Глядач відключився: UserID ${userId}`);
    }
    updateViewers();
  });
});

// Функція, що надсилає оновлення всім веб-клієнтам
function updateViewers() {
    // Проходимо по всіх активних з'єднаннях
    io.sockets.sockets.forEach(socket => {
        const { userId, isBeacon } = socket.handshake.query;
        if (isBeacon) return; // Ігноруємо маячки

        // Якщо це адмін, надсилаємо йому дані про ВСІХ гравців
        if (userId === ADMIN_USER_ID) {
            socket.emit('game_update', { players: Object.values(players), zone: gameZone });
        } 
        // Якщо це звичайний гравець, надсилаємо дані ТІЛЬКИ про нього
        else if (players[userId]) {
            socket.emit('game_update', { players: [players[userId]], zone: gameZone });
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Сервер] Сервер запущено на всіх інтерфейсах, порт ${PORT}`);
});
