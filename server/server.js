const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
//  GAME ROOMS / SESSIONS
// ═══════════════════════════════════════════════════════════════
const rooms = new Map();  // roomId → { p1, p2, gameState, ... }
const players = new Map(); // socketId → { name, roomId, playerId, ... }

function createRoom() {
  const roomId = Math.random().toString(36).substr(2, 9).toUpperCase();
  rooms.set(roomId, {
    id: roomId,
    p1: null,
    p2: null,
    status: 'waiting', // waiting | playing | finished
    gameState: null,
    createdAt: Date.now()
  });
  return roomId;
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET.IO EVENTS
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  // Player creates a new room and waits for opponent
  socket.on('createRoom', (playerName, callback) => {
    const roomId = createRoom();
    const room = rooms.get(roomId);
    room.p1 = { socketId: socket.id, name: playerName };
    
    players.set(socket.id, { name: playerName, roomId, playerId: 1 });
    socket.join(roomId);
    
    console.log(`[CREATE ROOM] ${playerName} created room ${roomId}`);
    callback({ success: true, roomId });
  });

  // Player joins an existing room
  socket.on('joinRoom', (roomId, playerName, callback) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    
    if (room.p2) {
      callback({ success: false, error: 'Room is full' });
      return;
    }

    room.p2 = { socketId: socket.id, name: playerName };
    players.set(socket.id, { name: playerName, roomId, playerId: 2 });
    socket.join(roomId);
    
    // Notify both players that the game can start
    io.to(roomId).emit('bothPlayersReady', {
      p1: room.p1.name,
      p2: room.p2.name
    });
    
    console.log(`[JOIN ROOM] ${playerName} joined room ${roomId}`);
    callback({ success: true, roomId });
  });

  // Get list of available rooms
  socket.on('listRooms', (callback) => {
    const availableRooms = Array.from(rooms.values())
      .filter(r => r.status === 'waiting' && !r.p2)
      .map(r => ({ roomId: r.id, host: r.p1.name }));
    callback(availableRooms);
  });

  // Game starts - sync initial state
  socket.on('startGame', (gameState) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const room = rooms.get(playerInfo.roomId);
    room.status = 'playing';
    room.gameState = gameState;
    
    io.to(playerInfo.roomId).emit('gameStarted');
  });

  // Game state update - broadcast to opponent
  socket.on('gameUpdate', (gameState) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const room = rooms.get(playerInfo.roomId);
    if (!room) return;
    
    room.gameState = gameState;
    
    // Send to the other player
    socket.to(playerInfo.roomId).emit('gameUpdate', {
      gameState,
      from: playerInfo.playerId
    });
  });

  // Player input
  socket.on('playerInput', (input) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    socket.to(playerInfo.roomId).emit('playerInput', {
      playerId: playerInfo.playerId,
      input
    });
  });

  // Game over
  socket.on('gameOver', (winner) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const room = rooms.get(playerInfo.roomId);
    if (room) room.status = 'finished';
    
    io.to(playerInfo.roomId).emit('gameOver', { winner });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const room = rooms.get(playerInfo.roomId);
      console.log(`[DISCONNECT] ${playerInfo.name} left room ${playerInfo.roomId}`);
      
      // Notify opponent
      socket.to(playerInfo.roomId).emit('opponentLeft');
      
      // Clean up if both players are gone
      if (!room.p1 || (room.p1.socketId !== socket.id && (!room.p2 || room.p2.socketId !== socket.id))) {
        if (room.p1?.socketId === socket.id) room.p1 = null;
        if (room.p2?.socketId === socket.id) room.p2 = null;
        
        if (!room.p1 && !room.p2) {
          rooms.delete(playerInfo.roomId);
        }
      }
    }
    
    players.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🎮 BomberDuo Server running on http://localhost:${PORT}`);
});
