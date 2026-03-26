// ═══════════════════════════════════════════════════════════════
//  BomberDuo — Multijugador Online (PeerJS P2P)
//
//  ARQUITECTURA:
//  • Host crea sala → recibe código de 6 chars → lo comparte.
//  • Guest introduce el código → se conecta directamente al Host.
//  • Host es la AUTORIDAD: ejecuta toda la simulación y envía
//    el estado completo a los guests cada ~50 ms.
//  • Guests sólo envían su dirección de movimiento al Host.
//
//  SERVIDOR DE SEÑALIZACIÓN:
//  Usamos el servidor público de PeerJS (0.peerjs.com) con
//  configuración explícita para evitar fallos del broker por
//  defecto. NO se necesita cuenta ni servidor propio.
// ═══════════════════════════════════════════════════════════════

// ── Estado online ──
let peer          = null;
let isHost        = false;
let myRoomCode    = '';
let myPlayerIndex = 0;   // 0 = host (P1), 1-3 = guests

// Host  → conns[i] = DataConnection al guest i
// Guest → conns[0] = DataConnection al host
let conns = [];

const guestNames = {};
let hostName = '';
let guestInputInterval = null;
let syncInterval       = null;

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DEL SERVIDOR PEERJS
//  Usamos el servidor público oficial con HTTPS/WSS.
// ─────────────────────────────────────────────────────────────
const PEER_CONFIG = {
  host:   '0.peerjs.com',
  port:    443,
  path:   '/',
  secure:  true,
  debug:   0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// ─────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  // Evitamos caracteres confusos: 0/O, 1/I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

// El peer ID del host se construye como: bd-<CODE> (corto y sin caracteres raros)
function codeToPeerId(code) {
  return 'bd-' + code.toUpperCase();
}

function setOnlineStatus(msg, isError = false) {
  ['online-status', 'join-status'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = isError ? '#ff4444' : '#ff8800';
  });
}

function getLocalName() {
  return (document.getElementById('player-name')?.value || '').trim() || 'Bombero';
}

// ─────────────────────────────────────────────────────────────
//  CREAR UN PEER  (promesa que resuelve cuando el broker confirma)
// ─────────────────────────────────────────────────────────────
function makePeer(peerId) {
  return new Promise((resolve, reject) => {
    // Destruir instancia anterior limpiamente
    if (peer) {
      try { peer.destroy(); } catch(_) {}
      peer = null;
    }

    const p = peerId
      ? new Peer(peerId, PEER_CONFIG)
      : new Peer(PEER_CONFIG);          // ID aleatorio para guests

    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    p.on('open',  id  => { peer = p; done(resolve, id); });
    p.on('error', err => {
      console.error('[PeerJS] error:', err.type, err.message);
      // unavailable-id = código ya en uso → el host reintenta con otro código
      if (err.type === 'unavailable-id') {
        done(reject, new Error('ID_TAKEN'));
      } else if (err.type === 'peer-unavailable') {
        done(reject, new Error('PEER_NOT_FOUND'));
      } else if (err.type === 'network' || err.type === 'server-error') {
        done(reject, new Error('NETWORK'));
      } else {
        // Errores no fatales (p.ej. conexión individual fallida) — NO rechazar
        console.warn('[PeerJS] error no fatal:', err.type);
      }
    });

    // Timeout de seguridad: si el broker tarda más de 12 s → error
    setTimeout(() => done(reject, new Error('TIMEOUT')), 12000);
  });
}

// ─────────────────────────────────────────────────────────────
//  CREAR SALA  (Host)
// ─────────────────────────────────────────────────────────────
async function createRoom() {
  hostName = getLocalName();
  setOnlineStatus('Conectando al servidor...');

  // Intentar hasta 5 códigos distintos por si hay colisión
  let code, attempt = 0;
  while (attempt < 5) {
    code = generateRoomCode();
    try {
      await makePeer(codeToPeerId(code));
      break;                            // éxito
    } catch(e) {
      if (e.message === 'ID_TAKEN') {
        attempt++; continue;            // probar con otro código
      }
      const msgs = {
        TIMEOUT: 'No se pudo conectar al servidor (timeout). Comprueba tu conexión.',
        NETWORK:  'Error de red. Comprueba tu conexión a internet.',
      };
      setOnlineStatus(msgs[e.message] || 'Error: ' + e.message, true);
      return;
    }
  }
  if (attempt >= 5) { setOnlineStatus('No se pudo crear sala. Inténtalo de nuevo.', true); return; }

  isHost        = true;
  myRoomCode    = code;
  myPlayerIndex = 0;

  peer.on('connection', conn => handleGuestConnection(conn));

  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('waiting-menu').classList.remove('hidden');
  document.getElementById('room-code-show').textContent   = code;
  document.getElementById('host-name-label').textContent  = hostName;

  updateHostLobby();
  setOnlineStatus('');
  console.log('[Host] Sala lista. Código:', code, '| Peer ID:', peer.id);
}

// ─────────────────────────────────────────────────────────────
//  GESTIONAR CONEXIÓN DE UN GUEST  (lado Host)
// ─────────────────────────────────────────────────────────────
function handleGuestConnection(conn) {
  const slot = conns.length + 1;       // 1, 2, 3
  if (slot >= 4) { conn.close(); return; }

  conns.push(conn);
  console.log('[Host] Guest conectando en slot', slot);

  conn.on('open', () => {
    console.log('[Host] Guest abierto, slot', slot);
    conn.send({ type: 'welcome', playerIndex: slot });
    updateHostLobby();
  });

  conn.on('data', data => {
    if (data.type === 'join') {
      guestNames[slot] = data.name;
      updateHostLobby();
      broadcastLobby();
    }
    if (data.type === 'input' && GS === 'playing') {
      const p = players[data.playerIndex];
      if (p) applyGuestInput(p, data);
    }
    if (data.type === 'bomb' && GS === 'playing') {
      const p = players[data.playerIndex];
      if (p) placeBomb(p);
    }
  });

  conn.on('close', () => {
    const idx = conns.indexOf(conn);
    if (idx !== -1) conns.splice(idx, 1);
    delete guestNames[slot];
    updateHostLobby();
    broadcastLobby();
    console.log('[Host] Guest desconectado, slot', slot);
  });

  conn.on('error', err => console.error('[Host] Error con guest:', err));
}

function updateHostLobby() {
  const slotIds = ['guest-slot-1','guest-slot-2','guest-slot-3'];
  const classes = ['p2','p3','p4'];
  const emojis  = ['🟥','🟩','🟧'];

  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(slotIds[i]);
    if (!el) continue;
    if (conns[i]) {
      const name = guestNames[i+1] || `Jugador ${i+2}`;
      el.textContent = `${emojis[i]} ${name}`;
      el.className   = `lobby-slot ${classes[i]}`;
    } else {
      el.textContent = `⬜ Esperando jugador ${i+2}...`;
      el.className   = 'lobby-slot empty';
    }
  }

  const btn = document.getElementById('start-online-btn');
  if (btn) {
    btn.disabled      = conns.length < 1;
    btn.style.opacity = conns.length >= 1 ? '1' : '0.35';
  }
}

function broadcastLobby() {
  const slots = [hostName, ...Object.values(guestNames)];
  conns.forEach(c => { try { c.send({ type:'lobby', slots }); } catch(_){} });
}

// ─────────────────────────────────────────────────────────────
//  UNIRSE A SALA  (Guest)
// ─────────────────────────────────────────────────────────────
async function joinRoomByCode() {
  const raw  = document.getElementById('room-code-input')?.value || '';
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (code.length !== 6) {
    setOnlineStatus('El código debe tener 6 caracteres', true); return;
  }

  const guestName = getLocalName();
  setOnlineStatus('Conectando al servidor...');

  // Crear peer con ID aleatorio para el guest
  try {
    await makePeer(null);
  } catch(e) {
    const msgs = {
      TIMEOUT: 'No se pudo conectar al servidor (timeout).',
      NETWORK: 'Error de red. Comprueba tu conexión.',
    };
    setOnlineStatus(msgs[e.message] || 'Error al conectar: ' + e.message, true);
    return;
  }

  isHost     = false;
  myRoomCode = code;

  setOnlineStatus('Buscando sala...');
  console.log('[Guest] Mi peer ID:', peer.id, '| Conectando a:', codeToPeerId(code));

  const conn = peer.connect(codeToPeerId(code), {
    reliable:    true,
    serialization: 'json',
  });
  conns = [conn];

  // Timeout si no se abre en 10 s
  const connTimeout = setTimeout(() => {
    if (conn.open) return;
    setOnlineStatus('Sala no encontrada o sin respuesta. Comprueba el código.', true);
    try { conn.close(); } catch(_){}
    conns = [];
  }, 10000);

  conn.on('open', () => {
    clearTimeout(connTimeout);
    console.log('[Guest] Conexión abierta con host');
    conn.send({ type: 'join', name: guestName });
    setOnlineStatus('¡Conectado! Esperando al host...');

    document.getElementById('join-menu').classList.add('hidden');
    document.getElementById('guest-waiting').classList.remove('hidden');
    document.getElementById('guest-room-show').textContent = code;
  });

  conn.on('data', data => {
    if (data.type === 'welcome') {
      myPlayerIndex = data.playerIndex;
      console.log('[Guest] Soy jugador', myPlayerIndex + 1);
    }
    if (data.type === 'lobby')  updateGuestLobby(data.slots);
    if (data.type === 'start')  receiveGameStart(data);
    if (data.type === 'state')  receiveGameState(data);
    if (data.type === 'gameover') endGame(data.winnerId);
  });

  conn.on('close', () => {
    console.warn('[Guest] Conexión cerrada');
    if (GS !== 'playing') {
      setOnlineStatus('Desconectado del host.', true);
    }
  });

  conn.on('error', err => {
    clearTimeout(connTimeout);
    console.error('[Guest] Error de conexión:', err);
    if (err.type === 'peer-unavailable') {
      setOnlineStatus('Sala no encontrada. Comprueba el código.', true);
    } else {
      setOnlineStatus('Error de conexión: ' + err.type, true);
    }
  });
}

function updateGuestLobby(slots) {
  const container = document.getElementById('guest-lobby-slots');
  if (!container) return;
  const emojis  = ['🟦','🟥','🟩','🟧'];
  const classes  = ['filled','p2','p3','p4'];
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const div = document.createElement('div');
    if (slots[i]) {
      div.className   = `lobby-slot ${classes[i]}`;
      div.textContent = `${emojis[i]} ${slots[i]}${i === myPlayerIndex ? ' (tú)' : ''}`;
    } else {
      div.className   = 'lobby-slot empty';
      div.textContent = `⬜ Esperando jugador ${i+1}...`;
    }
    container.appendChild(div);
  }
}

// ─────────────────────────────────────────────────────────────
//  INICIAR PARTIDA ONLINE  (Host pulsa ▶ INICIAR)
// ─────────────────────────────────────────────────────────────
function startOnlineGame() {
  if (!isHost) return;
  const numPlayers = 1 + conns.length;

  generateMap();

  // Enviar 'start' a cada guest
  conns.forEach((c, i) => {
    try {
      c.send({
        type:             'start',
        map:              map,
        numPlayers,
        playerIndex:      i + 1,
        blockDensity,
        powerupDropChance,
        gameTimeSecs:     configGameTime || 180,
        startLivesCount:  startLives     || 3,
      });
    } catch(_) {}
  });

  currentMode = 'online';
  startGame(numPlayers);          // startGame en game.js
  gameTime = configGameTime || 180;

  startStateSync();
}

// ─────────────────────────────────────────────────────────────
//  RECIBIR INICIO DE PARTIDA  (Guest)
// ─────────────────────────────────────────────────────────────
function receiveGameStart(data) {
  document.getElementById('guest-waiting').classList.add('hidden');

  map               = data.map;
  blockDensity      = data.blockDensity      ?? 0.7;
  powerupDropChance = data.powerupDropChance ?? 0.30;
  myPlayerIndex     = data.playerIndex;

  currentMode = 'online';
  initAudio();
  GS        = 'playing';
  gameTime  = data.gameTimeSecs ?? 180;
  bombs     = []; explosions = []; powerups = [];
  initPlayers(data.numPlayers);
  players.forEach(p => { p.lives = data.startLivesCount ?? 3; });
  updateHUD();

  ['main-menu','mode-menu','pause-menu','gameover','online-menu',
   'join-menu','waiting-menu','guest-waiting'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  document.getElementById('hud').classList.remove('hidden');

  if (platformMode === 'mobile') {
    document.getElementById('mobile-overlay').classList.remove('hidden');
    applyMobileLayout();
  }

  stopMusic(); tuneIdx = 0; startMusic();
  startGuestInputSend();
  console.log('[Guest] Juego iniciado como P', myPlayerIndex + 1);
}

// ─────────────────────────────────────────────────────────────
//  SYNC DE ESTADO  Host → Guests  (~20 fps)
// ─────────────────────────────────────────────────────────────
function startStateSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (GS !== 'playing' || conns.length === 0) return;

    const state = {
      type: 'state',
      gameTime,
      players: players.map(p => ({
        id: p.id, col: p.col, row: p.row,
        x: p.x, y: p.y, tCol: p.tCol, tRow: p.tRow,
        dir: p.dir, moving: p.moving,
        animState: p.animState, animFrame: p.animFrame,
        alive: p.alive, dying: p.dying, dyingT: p.dyingT,
        invincible: p.invincible,
        lives: p.lives, maxBombs: p.maxBombs,
        fireRange: p.fireRange, speedMult: p.speedMult,
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
      map,
    };

    conns.forEach(c => { try { c.send(state); } catch(_){} });
  }, 50);
}

function receiveGameState(data) {
  if (GS !== 'playing') return;

  gameTime = data.gameTime;

  if (data.players && players.length === data.players.length) {
    data.players.forEach((pd, i) => {
      const p = players[i];
      if (!p) return;
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
      p.maxBombs  = pd.maxBombs;
      p.fireRange = pd.fireRange;
      p.speedMult = pd.speedMult;
    });
  }

  bombs      = (data.bombs      || []).map(b  => ({ ...b,  passSet: new Set() }));
  explosions = (data.explosions || []).map(ex => ({ ...ex }));
  powerups   = (data.powerups   || []).map(pu => ({ ...pu }));
  if (data.map) map = data.map;
}

// ─────────────────────────────────────────────────────────────
//  ENVÍO DE INPUT  Guest → Host
// ─────────────────────────────────────────────────────────────
function startGuestInputSend() {
  if (guestInputInterval) clearInterval(guestInputInterval);

  guestInputInterval = setInterval(() => {
    if (GS !== 'playing' || !conns[0]?.open) return;

    const cfg   = PLAYER_CONFIG[myPlayerIndex];
    const touch = virtualHeld[myPlayerIndex + 1] || new Set();
    let dir = null;

    if (touch.has('up')    || held.has(cfg?.keys?.up))    dir = 'up';
    if (touch.has('down')  || held.has(cfg?.keys?.down))  dir = 'down';
    if (touch.has('left')  || held.has(cfg?.keys?.left))  dir = 'left';
    if (touch.has('right') || held.has(cfg?.keys?.right)) dir = 'right';

    try {
      conns[0].send({ type: 'input', dir, playerIndex: myPlayerIndex });
    } catch(_) {}
  }, 50);
}

function applyGuestInput(player, data) {
  if (!player.alive || player.dying) return;
  if (!data.dir) return;
  if (player.col !== player.tCol || player.row !== player.tRow) return;

  const dirMap = {
    up:    [0, -1, 'up'],
    down:  [0,  1, 'down'],
    left:  [-1, 0, 'left'],
    right: [1,  0, 'right'],
  };
  const [dc, dr, dirStr] = dirMap[data.dir] || [0, 0, player.dir];
  const nc = player.col + dc, nr = player.row + dr;
  if (player.isFree(nc, nr)) { player.tCol = nc; player.tRow = nr; }
  player.dir = dirStr;
}

// ─────────────────────────────────────────────────────────────
//  HOOKS  (llamados desde game.js)
// ─────────────────────────────────────────────────────────────
function onlineBombBroadcast()     {}   // cubierto por state sync
function onlineExplodeBroadcast()  {}   // cubierto por state sync
function onlinePositionBroadcast() {}   // cubierto por state sync

// ─────────────────────────────────────────────────────────────
//  LIMPIAR
// ─────────────────────────────────────────────────────────────
function cancelRoom() { onlineCleanup(); goToMenu(); }

function onlineCleanup() {
  if (syncInterval)       { clearInterval(syncInterval);       syncInterval = null; }
  if (guestInputInterval) { clearInterval(guestInputInterval); guestInputInterval = null; }
  conns.forEach(c => { try { c.close(); } catch(_){} });
  conns = [];
  if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
  isHost = false; myRoomCode = ''; myPlayerIndex = 0;
  Object.keys(guestNames).forEach(k => delete guestNames[k]);
}
