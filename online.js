// ═══════════════════════════════════════════════════════════════
//  BomberDuo — Multijugador Online (PeerJS P2P)
//
//  ARQUITECTURA:
//  • El Host crea una "sala" con un código de 6 caracteres.
//  • Los Guests se conectan al Host usando ese código.
//  • El Host es la AUTORIDAD: ejecuta la simulación completa
//    y envía el estado a los guests cada frame.
//  • Los Guests sólo envían sus inputs al Host.
//  • Funciona sin servidor — PeerJS usa un servidor STUN público
//    de Cloudflare que ya está incluido en la librería.
//
//  MENSAJES (todos son JSON):
//    host→guest  { type:'state',  map, players, bombs, explosions, powerups, gameTime }
//    host→guest  { type:'start',  map, numPlayers, playerIndex }
//    host→guest  { type:'lobby',  slots }
//    guest→host  { type:'input',  dir, bomb, playerIndex }
//    guest→host  { type:'join',   name }
// ═══════════════════════════════════════════════════════════════

// ── Estado online ──
let peer         = null;   // instancia PeerJS
let isHost       = false;
let myRoomCode   = '';
let myPlayerIndex = 0;     // 0=P1(host), 1=P2, 2=P3, 3=P4

// Conexiones activas:
//   Host  → conns[i] = DataConnection con el guest i
//   Guest → conns[0] = DataConnection con el host
let conns = [];

// Info del lobby
const guestNames = {};   // { playerIndex: name }
let hostName     = '';

// Estado del input local del guest
const guestInput = { dir: null, bomb: false };
let guestInputInterval = null;

// ─────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────

/** Genera un código de sala de 6 caracteres alfanumérico */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

/** ID de peer del host a partir del código de sala */
function roomCodeToPeerId(code) {
  return 'bomberduo-room-' + code.toUpperCase();
}

/** Muestra un mensaje de estado en el menú activo */
function setOnlineStatus(msg, isError=false) {
  ['online-status','join-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.color = isError ? '#ff4444' : '#ff8800'; }
  });
}

/** Obtiene el nombre del jugador local */
function getLocalName() {
  return (document.getElementById('player-name')?.value || 'Bombero').trim() || 'Bombero';
}

// ─────────────────────────────────────────────────────────────
//  INICIALIZAR PEER
// ─────────────────────────────────────────────────────────────
function initPeer(peerId) {
  return new Promise((resolve, reject) => {
    // Destruir peer anterior si existe
    if (peer) { try { peer.destroy(); } catch(e){} }

    peer = new Peer(peerId, {
      // PeerJS usa servidores STUN de Google por defecto — funciona sin cuenta
      debug: 0
    });

    peer.on('open', id => {
      console.log('[PeerJS] Peer abierto con ID:', id);
      resolve(id);
    });

    peer.on('error', err => {
      console.error('[PeerJS] Error:', err);
      // ID ya en uso = sala ya existe
      if (err.type === 'unavailable-id') {
        reject(new Error('El código de sala ya existe. Prueba otro.'));
      } else if (err.type === 'peer-unavailable') {
        reject(new Error('Sala no encontrada. Comprueba el código.'));
      } else {
        reject(new Error('Error de conexión: ' + err.message));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  CREAR SALA (Host)
// ─────────────────────────────────────────────────────────────
async function createRoom() {
  hostName = getLocalName();
  if (!hostName) { setOnlineStatus('Escribe tu nombre primero', true); return; }

  setOnlineStatus('Conectando...');
  const code = generateRoomCode();

  try {
    await initPeer(roomCodeToPeerId(code));
  } catch(e) {
    setOnlineStatus(e.message, true); return;
  }

  isHost      = true;
  myRoomCode  = code;
  myPlayerIndex = 0;

  // El host escucha conexiones entrantes
  peer.on('connection', conn => handleGuestConnection(conn));

  // Mostrar sala de espera
  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('waiting-menu').classList.remove('hidden');
  document.getElementById('room-code-show').textContent = code;
  document.getElementById('host-name-label').textContent = hostName;

  updateHostLobby();
  console.log('[Host] Sala creada:', code);
}

/** El host gestiona una nueva conexión de un guest */
function handleGuestConnection(conn) {
  const slot = conns.length + 1; // índice del guest (1-3)
  if (slot >= 4) { conn.close(); return; } // sala llena

  conns.push(conn);
  console.log('[Host] Guest conectado en slot', slot);

  conn.on('open', () => {
    // Comunicar al guest su índice de jugador
    conn.send({ type: 'welcome', playerIndex: slot });
    updateHostLobby();
  });

  conn.on('data', data => {
    if (data.type === 'join') {
      // El guest nos dice su nombre
      guestNames[slot] = data.name;
      updateHostLobby();
      // Reenviar lobby actualizado a todos
      broadcastLobby();
    }
    if (data.type === 'input' && GS === 'playing') {
      // Aplicar input del guest a su jugador
      const p = players[data.playerIndex];
      if (p) applyGuestInput(p, data);
    }
  });

  conn.on('close', () => {
    // Guest desconectado
    conns.splice(conns.indexOf(conn), 1);
    delete guestNames[slot];
    updateHostLobby();
    broadcastLobby();
    console.log('[Host] Guest desconectado, slot', slot);
  });

  conn.on('error', err => console.error('[Host] Error con guest:', err));
}

/** Actualiza los slots visuales en la sala de espera del host */
function updateHostLobby() {
  const slotIds  = ['guest-slot-1','guest-slot-2','guest-slot-3'];
  const classes  = ['p2','p3','p4'];
  const emojis   = ['🟥','🟩','🟧'];

  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(slotIds[i]);
    if (!el) continue;
    const guestIdx = i + 1;
    if (conns[i]) {
      const name = guestNames[guestIdx] || `Jugador ${guestIdx+1}`;
      el.textContent = `${emojis[i]} ${name}`;
      el.className   = `lobby-slot ${classes[i]}`;
    } else {
      el.textContent = `⬜ Esperando jugador ${guestIdx+1}...`;
      el.className   = 'lobby-slot empty';
    }
  }

  // Habilitar botón de inicio si hay al menos 1 guest
  const btn = document.getElementById('start-online-btn');
  if (btn) {
    btn.disabled = conns.length < 1;
    btn.style.opacity = conns.length >= 1 ? '1' : '0.35';
  }
}

/** Envía el estado actual del lobby a todos los guests */
function broadcastLobby() {
  const slots = [hostName, ...Object.values(guestNames)];
  conns.forEach(c => {
    try { c.send({ type:'lobby', slots }); } catch(e){}
  });
}

// ─────────────────────────────────────────────────────────────
//  UNIRSE A SALA (Guest)
// ─────────────────────────────────────────────────────────────
async function joinRoomByCode() {
  const code = document.getElementById('room-code-input')?.value?.trim().toUpperCase();
  if (!code || code.length !== 6) { setOnlineStatus('Código inválido (6 caracteres)', true); return; }

  const guestName = getLocalName();
  setOnlineStatus('Conectando...');

  try {
    // ID aleatorio para el guest
    await initPeer('bomberduo-guest-' + Math.random().toString(36).slice(2,8));
  } catch(e) {
    setOnlineStatus('No se pudo inicializar conexión', true); return;
  }

  isHost     = false;
  myRoomCode = code;

  // Conectar al peer del host
  const conn = peer.connect(roomCodeToPeerId(code), { reliable: true });
  conns = [conn];

  conn.on('open', () => {
    console.log('[Guest] Conectado al host');
    conn.send({ type: 'join', name: guestName });
    setOnlineStatus('Conectado. Esperando host...');

    // Mostrar sala de espera del guest
    document.getElementById('join-menu').classList.add('hidden');
    document.getElementById('guest-waiting').classList.remove('hidden');
    document.getElementById('guest-room-show').textContent = code;
  });

  conn.on('data', data => {
    if (data.type === 'welcome') {
      myPlayerIndex = data.playerIndex;
      console.log('[Guest] Soy jugador', myPlayerIndex + 1);
    }
    if (data.type === 'lobby') {
      updateGuestLobby(data.slots);
    }
    if (data.type === 'start') {
      receiveGameStart(data);
    }
    if (data.type === 'state') {
      receiveGameState(data);
    }
  });

  conn.on('close', () => {
    setOnlineStatus('Desconectado del host', true);
    if (GS !== 'playing') goToMenu();
  });

  conn.on('error', err => {
    setOnlineStatus('Sala no encontrada o llena', true);
    console.error('[Guest] Error:', err);
  });

  // Timeout si no hay respuesta
  setTimeout(() => {
    if (GS !== 'playing' && document.getElementById('guest-waiting').classList.contains('hidden')) {
      setOnlineStatus('No se encontró la sala. Comprueba el código.', true);
    }
  }, 8000);
}

/** Actualiza el lobby visual del guest */
function updateGuestLobby(slots) {
  const container = document.getElementById('guest-lobby-slots');
  if (!container) return;
  const emojis  = ['🟦','🟥','🟩','🟧'];
  const classes  = ['p1','p2','p3','p4'];  // reutilizamos clases de CSS

  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const div = document.createElement('div');
    if (slots[i]) {
      div.className = `lobby-slot ${classes[i]}`;
      div.textContent = `${emojis[i]} ${slots[i]}${i === myPlayerIndex ? ' (tú)' : ''}`;
    } else {
      div.className = 'lobby-slot empty';
      div.textContent = `⬜ Esperando jugador ${i+1}...`;
    }
    container.appendChild(div);
  }
}

// ─────────────────────────────────────────────────────────────
//  INICIAR PARTIDA ONLINE (Host)
// ─────────────────────────────────────────────────────────────
function startOnlineGame() {
  if (!isHost) return;
  const numPlayers = 1 + conns.length; // host + guests conectados

  // Generar mapa
  generateMap();

  // Enviar datos de inicio a cada guest
  conns.forEach((c, i) => {
    try {
      c.send({
        type:        'start',
        map:         map,
        numPlayers:  numPlayers,
        playerIndex: i + 1,  // guest 0 → P2, guest 1 → P3, etc.
        blockDensity,
        powerupDropChance
      });
    } catch(e) {}
  });

  // Arrancar juego local del host
  currentMode = 'online';
  startGame(numPlayers);
  gameTime = configGameTime || 180;

  // Empezar a sincronizar estado
  startStateSync();
}

/** El guest recibe el inicio de partida */
function receiveGameStart(data) {
  document.getElementById('guest-waiting').classList.add('hidden');

  // Configurar parámetros del servidor
  map              = data.map;
  blockDensity     = data.blockDensity     || 0.7;
  powerupDropChance = data.powerupDropChance || 0.30;
  myPlayerIndex     = data.playerIndex;

  // Arrancar la presentación — el guest también necesita el canvas
  currentMode = 'online';
  initAudio();
  GS = 'playing'; gameTime = data.gameTime || configGameTime || 180;
  bombs = []; explosions = []; powerups = [];
  initPlayers(data.numPlayers);
  players.forEach(p => { p.lives = startLives || 3; });
  updateHUD();

  ['main-menu','mode-menu','pause-menu','gameover','online-menu',
   'join-menu','waiting-menu','guest-waiting'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  document.getElementById('hud').classList.remove('hidden');

  if (platformMode === 'mobile') {
    document.getElementById('mobile-overlay').classList.remove('hidden');
    scaleWrapperForMobile();
  }

  stopMusic(); tuneIdx = 0; startMusic();

  // El guest envía su input periódicamente
  startGuestInputSend();
  console.log('[Guest] Juego iniciado como jugador', myPlayerIndex + 1);
}

// ─────────────────────────────────────────────────────────────
//  SINCRONIZACIÓN DE ESTADO (Host → Guests)
//  El host envía el estado completo cada ~50ms (20 veces/s)
// ─────────────────────────────────────────────────────────────
let syncInterval = null;

function startStateSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (GS !== 'playing' || conns.length === 0) return;

    const state = {
      type: 'state',
      gameTime,
      players: players.map(p => ({
        id: p.id, col: p.col, row: p.row,
        x: p.x, y: p.y,
        tCol: p.tCol, tRow: p.tRow,
        dir: p.dir, moving: p.moving,
        animState: p.animState, animFrame: p.animFrame,
        alive: p.alive, dying: p.dying, dyingT: p.dyingT,
        invincible: p.invincible,
        lives: p.lives, maxBombs: p.maxBombs, fireRange: p.fireRange, speedMult: p.speedMult
      })),
      bombs: bombs.map(b => ({
        col:b.col, row:b.row, timer:b.timer, range:b.range, owner:b.owner, t:b.t
      })),
      explosions: explosions.map(ex => ({
        cells: ex.cells, timer: ex.timer, t: ex.t
      })),
      powerups: powerups.map(pu => ({
        col:pu.col, row:pu.row, type:pu.type, t:pu.t
      })),
      map  // enviamos el mapa sólo cuando cambia (al romper bloques)
    };

    conns.forEach(c => {
      try { c.send(state); } catch(e) {}
    });
  }, 50);
}

/** El guest recibe estado del host y actualiza su simulación local */
function receiveGameState(data) {
  if (GS !== 'playing') return;

  // Actualizar tiempo
  gameTime = data.gameTime;

  // Actualizar jugadores
  if (data.players && players.length === data.players.length) {
    data.players.forEach((pd, i) => {
      const p = players[i];
      if (!p) return;
      // No sobrescribir posición del jugador local (la interpola suavemente)
      if (i !== myPlayerIndex) {
        p.x = pd.x; p.y = pd.y;
        p.col = pd.col; p.row = pd.row;
        p.tCol = pd.tCol; p.tRow = pd.tRow;
      }
      p.dir = pd.dir; p.moving = pd.moving;
      p.animState = pd.animState; p.animFrame = pd.animFrame;
      p.alive = pd.alive; p.dying = pd.dying; p.dyingT = pd.dyingT;
      p.invincible = pd.invincible;
      if (p.lives !== pd.lives) { p.lives = pd.lives; updateHUD(); }
      p.maxBombs = pd.maxBombs; p.fireRange = pd.fireRange; p.speedMult = pd.speedMult;
    });
  }

  // Actualizar bombas
  bombs = (data.bombs || []).map(b => ({
    col:b.col, row:b.row, timer:b.timer, range:b.range,
    owner:b.owner, t:b.t, passSet: new Set()
  }));

  // Actualizar explosiones
  explosions = (data.explosions || []).map(ex => ({
    cells: ex.cells, timer: ex.timer, t: ex.t
  }));

  // Actualizar power-ups
  powerups = (data.powerups || []).map(pu => ({
    col:pu.col, row:pu.row, type:pu.type, t:pu.t
  }));

  // Actualizar mapa si ha cambiado
  if (data.map) map = data.map;

  // Comprobar fin de partida
  if (data.gameOver !== undefined) endGame(data.gameOver);
}

// ─────────────────────────────────────────────────────────────
//  ENVÍO DE INPUT DEL GUEST al Host
// ─────────────────────────────────────────────────────────────
function startGuestInputSend() {
  if (guestInputInterval) clearInterval(guestInputInterval);

  guestInputInterval = setInterval(() => {
    if (GS !== 'playing' || conns.length === 0) return;
    const conn = conns[0]; // el guest sólo tiene conexión con el host

    // Leer dirección actual (teclado + táctil)
    const cfg   = PLAYER_CONFIG[myPlayerIndex];
    const touch = virtualHeld[myPlayerIndex + 1] || new Set();
    let dir = null;

    if (touch.has('up')    || held.has(cfg?.keys?.up))    dir = 'up';
    if (touch.has('down')  || held.has(cfg?.keys?.down))  dir = 'down';
    if (touch.has('left')  || held.has(cfg?.keys?.left))  dir = 'left';
    if (touch.has('right') || held.has(cfg?.keys?.right)) dir = 'right';

    try {
      conn.send({ type:'input', dir, bomb: false, playerIndex: myPlayerIndex });
    } catch(e) {}
  }, 50);
}

/** Aplica el input de un guest a su jugador — llamado desde el host */
function applyGuestInput(player, data) {
  if (!player.alive || player.dying) return;
  if (data.dir === null) return;

  // Sólo si el jugador está en la celda destino (igual que _readInput)
  if (player.col !== player.tCol || player.row !== player.tRow) return;

  const dirMap = { up:[0,-1,'up'], down:[0,1,'down'], left:[-1,0,'left'], right:[1,0,'right'] };
  const [dc,dr,dirStr] = dirMap[data.dir] || [0,0,player.dir];
  const nc=player.col+dc, nr=player.row+dr;
  if (player.isFree(nc,nr)) { player.tCol=nc; player.tRow=nr; }
  player.dir=dirStr;
}

// ─────────────────────────────────────────────────────────────
//  HOOKS para game.js (llamados desde el sistema de juego)
//  El host los usa para notificar a los guests de eventos
// ─────────────────────────────────────────────────────────────

/** Llamado cuando el host coloca una bomba */
function onlineBombBroadcast(col, row, range, ownerId) {
  // El host ya gestiona las bombas en su loop; sólo necesitamos el estado sync
  // (incluido en startStateSync). Este hook existe por si quieres feedback inmediato.
}

/** Llamado cuando el host detona una bomba */
function onlineExplodeBroadcast(col, row) {
  // Idem — el estado completo se sincroniza vía startStateSync
}

/** Llamado cada frame por cada jugador (hook de posición) */
function onlinePositionBroadcast(player) {
  // El host sincroniza todo vía startStateSync — no necesitamos envío extra
}

// ─────────────────────────────────────────────────────────────
//  CANCELAR / LIMPIAR
// ─────────────────────────────────────────────────────────────
function cancelRoom() {
  onlineCleanup();
  goToMenu();
}

function onlineCleanup() {
  if (syncInterval)       { clearInterval(syncInterval);       syncInterval = null; }
  if (guestInputInterval) { clearInterval(guestInputInterval); guestInputInterval = null; }
  conns.forEach(c => { try { c.close(); } catch(e) {} });
  conns = [];
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }
  isHost = false; myRoomCode = ''; myPlayerIndex = 0;
  Object.keys(guestNames).forEach(k => delete guestNames[k]);
}
