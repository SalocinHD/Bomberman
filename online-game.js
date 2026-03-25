// ═══════════════════════════════════════════════════════════════
//  ONLINE MULTIPLAYER FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════

let socket = null;
let currentRoom = null;
let currentPlayerId = null;
let isOnlineGame = false;
let remoteGameState = null;

/**
 * Initialize Socket.io connection
 * @param {string} serverUrl - URL to the server (e.g., 'http://localhost:3000')
 */
function initOnlineGame(serverUrl = window.location.origin) {
  if (socket) return;
  
  socket = io(serverUrl, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('🟢 Connected to server');
  });

  socket.on('disconnect', () => {
    console.log('🔴 Disconnected from server');
  });

  socket.on('bothPlayersReady', (data) => {
    console.log(`✓ Opponent joined! ${data.p1} vs ${data.p2}`);
    goToGameStartOnline();
  });

  socket.on('gameStarted', () => {
    console.log('▶ Game started for opponent');
  });

  socket.on('gameUpdate', (data) => {
    remoteGameState = data.gameState;
  });

  socket.on('playerInput', (data) => {
    // Handle opponent's input (if needed for server-authoritative logic)
    console.log('Input from player ' + data.playerId);
  });

  socket.on('gameOver', (data) => {
    console.log('Game over! Winner: ' + data.winner);
  });

  socket.on('opponentLeft', () => {
    alert('⚠ Your opponent disconnected!');
    goToMenu();
  });
}

/**
 * Create a new online room
 */
function createOnlineRoom() {
  const playerName = document.getElementById('player-name').value.trim();
  
  if (!playerName) {
    alert('Por favor ingresa tu nombre');
    return;
  }

  if (!socket) initOnlineGame();

  socket.emit('createRoom', playerName, (response) => {
    if (response.success) {
      currentRoom = response.roomId;
      currentPlayerId = 1;
      isOnlineGame = true;

      // Show waiting screen
      document.getElementById('online-menu').classList.add('hidden');
      document.getElementById('waiting-menu').classList.remove('hidden');
      document.getElementById('waiting-room-id').textContent = response.roomId;
      
      console.log(`✓ Room created: ${response.roomId}`);
    } else {
      alert('Error creating room: ' + response.error);
    }
  });
}

/**
 * Show join room menu and list available rooms
 */
function showJoinMenu() {
  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('join-menu').classList.remove('hidden');
  
  if (!socket) initOnlineGame();
  
  socket.emit('listRooms', (rooms) => {
    const listEl = document.getElementById('rooms-list');
    
    if (rooms.length === 0) {
      listEl.innerHTML = '<p style="color: #888; text-align: center;">No hay salas disponibles</p>';
      return;
    }

    listEl.innerHTML = rooms.map(room => 
      `<div class="room-item" onclick="joinRoomBySelection('${room.roomId}')">
        <div style="color: #ffcc00;">Anfitrión: ${room.host}</div>
        <div style="color: #666; font-size: 8px;">ID: ${room.roomId}</div>
      </div>`
    ).join('');
  });
}

/**
 * Join room by selection from list
 */
function joinRoomBySelection(roomId) {
  const playerName = document.getElementById('player-name').value.trim();
  
  if (!playerName) {
    alert('Por favor ingresa tu nombre');
    return;
  }

  if (!socket) initOnlineGame();

  socket.emit('joinRoom', roomId, playerName, (response) => {
    if (response.success) {
      currentRoom = roomId;
      currentPlayerId = 2;
      isOnlineGame = true;
      console.log(`✓ Joined room: ${roomId}`);
      // Game will auto-start when both players are ready
    } else {
      alert('Error: ' + response.error);
    }
  });
}

/**
 * Join room by typing in Room ID
 */
function joinRoomById() {
  const roomId = document.getElementById('room-id-input').value.trim().toUpperCase();
  
  if (!roomId) {
    alert('Por favor ingresa un Room ID válido');
    return;
  }

  joinRoomBySelection(roomId);
}

/**
 * Cancel online game and return to menu
 */
function cancelOnlineGame() {
  if (socket && currentRoom) {
    socket.emit('disconnect');
  }
  currentRoom = null;
  currentPlayerId = null;
  isOnlineGame = false;
  goToMenu();
}

/**
 * Show online menu
 */
function showOnlineMenu() {
  document.getElementById('mode-menu').classList.add('hidden');
  document.getElementById('online-menu').classList.remove('hidden');
}

/**
 * Set game mode and show appropriate menu
 */
function setGameMode(mode) {
  if (mode === 'local') {
    GS = 'menu';
    document.getElementById('mode-menu').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    isOnlineGame = false;
  } else if (mode === 'locura') {
    // Set 100% powerup drop chance for Locura mode
    powerupDropChance = 1.0;
    GS = 'menu';
    document.getElementById('mode-menu').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    isOnlineGame = false;
  } else if (mode === 'online') {
    showOnlineMenu();
  }
}

/**
 * Show the mode selection menu
 */
function showModeMenu() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('mode-menu').classList.remove('hidden');
}

/**
 * Send game state to opponent (call this during game loop)
 */
function sendGameState(gameState) {
  if (socket && currentRoom && isOnlineGame) {
    socket.emit('gameUpdate', gameState);
  }
}

/**
 * Broadcast game over to opponent
 */
function sendGameOver(winner) {
  if (socket && currentRoom && isOnlineGame) {
    socket.emit('gameOver', { winner });
  }
}

/**
 * Transition to game start for online mode
 */
function goToGameStartOnline() {
  document.getElementById('waiting-menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  startGame();
}

// Initialize on page load
window.addEventListener('load', () => {
  initOnlineGame();
});
