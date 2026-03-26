// ═══════════════════════════════════════════════════════════════
//  BomberDuo — Multijugador Online
//
//  SIGNALING: PeerJS usando el servidor público peerjs.com
//  con la API key por defecto "peerjs" — gratis, sin cuenta.
//
//  FLUJO:
//    Host  → crea Peer con ID "bd-XXXXXX" → espera conexiones
//    Guest → crea Peer con ID aleatorio   → conecta a "bd-XXXXXX"
//    Host  → simula el juego y sincroniza estado cada 50ms
//    Guest → sólo envía inputs al host
// ═══════════════════════════════════════════════════════════════

let peer          = null;
let isHost        = false;
let myRoomCode    = '';
let myPlayerIndex = 0;

// Host:  conns[i] = DataConnection al guest i
// Guest: conns[0] = DataConnection al host
let conns = [];

const guestNames       = {};
let hostName           = '';
let guestInputInterval = null;
let syncInterval       = null;

// ─────────────────────────────────────────────────────────────
//  SERVIDOR DE SEÑALIZACIÓN
//  peerjs.com es el broker público oficial de la librería.
//  No necesita cuenta — usa la key "peerjs" por defecto.
// ─────────────────────────────────────────────────────────────
const PEER_CFG = {
  // Sin host/port/path → usa el broker por defecto de la lib (peerjs.com)
  // Esto es lo mismo que new Peer() pero dejándolo explícito:
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302'      },
      { urls: 'stun:stun1.l.google.com:19302'     },
      { urls: 'stun:global.stun.twilio.com:3478'  },
    ]
  }
};

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => ch[Math.floor(Math.random()*ch.length)]).join('');
}

function codeToPeerId(code) {
  return 'bd-' + code.toUpperCase();
}

function setOnlineStatus(msg, isError = false) {
  ['online-status','join-status'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ff4444' : '#ffaa00';
  });
}

function getLocalName() {
  return (document.getElementById('player-name')?.value || '').trim() || 'Bombero';
}

// ─────────────────────────────────────────────────────────────
//  CREAR PEER  — promesa que se resuelve cuando el broker
//  confirma el ID, o se rechaza con un código de error.
// ─────────────────────────────────────────────────────────────
function makePeer(peerId) {
  return new Promise((resolve, reject) => {
    // Destruir instancia anterior
    if (peer) { try { peer.destroy(); } catch(_){} peer = null; }

    // Crear peer con o sin ID específico
    const p = (peerId != null) ? new Peer(peerId, PEER_CFG) : new Peer(PEER_CFG);

    let done = false;
    const finish = (ok, val) => {
      if (done) return;
      done = true;
      if (ok) { peer = p; resolve(val); }
      else    { try { p.destroy(); } catch(_){} reject(val); }
    };

    p.on('open', id => finish(true, id));

    p.on('error', err => {
      const t = err.type;
      console.error('[Peer] error:', t, err.message);

      if (!done) {
        // Errores fatales antes de que el peer esté abierto
        if (t === 'unavailable-id')  finish(false, 'ID_TAKEN');
        else if (t === 'network')    finish(false, 'NETWORK');
        else if (t === 'server-error') finish(false, 'SERVER');
        // peer-unavailable llega después de open (al conectar a alguien)
        // no lo manejamos aquí — se maneja en conn.on('error')
      }
      // Si ya está abierto y recibimos peer-unavailable, ignorar aquí
    });

    setTimeout(() => finish(false, 'TIMEOUT'), 15000);
  });
}

// ─────────────────────────────────────────────────────────────
//  CREAR SALA  (Host)
// ─────────────────────────────────────────────────────────────
async function createRoom() {
  hostName = getLocalName();
  setOnlineStatus('Conectando...');

  // Intentar hasta 5 códigos distintos (por si hay colisión de IDs)
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateRoomCode();
    try {
      await makePeer(codeToPeerId(code));
      break;
    } catch(e) {
      if (e === 'ID_TAKEN' && i < 4) continue;
      const msg = {
        TIMEOUT: 'Tiempo de espera agotado. Comprueba tu conexión.',
        NETWORK:  'Sin conexión a internet.',
        SERVER:   'Error del servidor de señalización.',
      };
      setOnlineStatus(msg[e] || 'Error al crear sala: ' + e, true);
      return;
    }
  }

  isHost = true; myRoomCode = code; myPlayerIndex = 0;
  peer.on('connection', handleGuestConnection);

  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('waiting-menu').classList.remove('hidden');
  document.getElementById('room-code-show').textContent  = code;
  document.getElementById('host-name-label').textContent = hostName;
  updateHostLobby();
  setOnlineStatus('');
  console.log('[Host] Sala:', code, ' PeerID:', peer.id);
}

// ─────────────────────────────────────────────────────────────
//  GESTIONAR CONEXIÓN ENTRANTE  (Host)
// ─────────────────────────────────────────────────────────────
function handleGuestConnection(conn) {
  const slot = conns.length + 1;
  if (slot >= 4) { conn.close(); return; }
  conns.push(conn);

  conn.on('open', () => {
    conn.send({ type:'welcome', playerIndex: slot });
    updateHostLobby();
  });

  conn.on('data', data => {
    if (data.type === 'join') {
      guestNames[slot] = data.name;
      updateHostLobby();
      broadcastLobby();
    }
    if (data.type === 'input' && GS === 'playing') {
      applyGuestInput(players[data.playerIndex], data);
    }
    if (data.type === 'bomb' && GS === 'playing') {
      placeBomb(players[data.playerIndex]);
    }
  });

  conn.on('close', () => {
    const i = conns.indexOf(conn);
    if (i !== -1) conns.splice(i, 1);
    delete guestNames[slot];
    updateHostLobby(); broadcastLobby();
  });

  conn.on('error', e => console.error('[Host conn] error:', e));
}

function updateHostLobby() {
  const ids  = ['guest-slot-1','guest-slot-2','guest-slot-3'];
  const cls  = ['p2','p3','p4'];
  const ico  = ['🟥','🟩','🟧'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id); if (!el) return;
    if (conns[i]) {
      el.textContent = `${ico[i]} ${guestNames[i+1]||'Jugador '+(i+2)}`;
      el.className   = `lobby-slot ${cls[i]}`;
    } else {
      el.textContent = `⬜ Esperando jugador ${i+2}...`;
      el.className   = 'lobby-slot empty';
    }
  });
  const btn = document.getElementById('start-online-btn');
  if (btn) { btn.disabled = conns.length < 1; btn.style.opacity = conns.length ? '1' : '0.35'; }
}

function broadcastLobby() {
  const slots = [hostName, ...Object.values(guestNames)];
  conns.forEach(c => { try { c.send({type:'lobby', slots}); } catch(_){} });
}

// ─────────────────────────────────────────────────────────────
//  UNIRSE A SALA  (Guest)
// ─────────────────────────────────────────────────────────────
async function joinRoomByCode() {
  const raw  = document.getElementById('room-code-input')?.value || '';
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');

  if (code.length !== 6) { setOnlineStatus('Código inválido (6 caracteres)', true); return; }

  const guestName = getLocalName();
  setOnlineStatus('Conectando al servidor...');

  // 1. Crear nuestro propio peer con ID aleatorio
  try {
    await makePeer(null);
  } catch(e) {
    const msg = { TIMEOUT:'Timeout al conectar al servidor.', NETWORK:'Sin conexión a internet.', SERVER:'Error del servidor.' };
    setOnlineStatus(msg[e] || 'Error: ' + e, true);
    return;
  }

  isHost = false; myRoomCode = code;
  const targetId = codeToPeerId(code);
  setOnlineStatus('Buscando sala ' + code + '...');
  console.log('[Guest] peer:', peer.id, '→ target:', targetId);

  // 2. Abrir conexión con el host
  const conn = peer.connect(targetId, { reliable: true, serialization: 'json' });
  conns = [conn];

  // ── Manejadores de la conexión ──
  conn.on('open', () => {
    console.log('[Guest] Conexión abierta');
    conn.send({ type:'join', name: guestName });
    setOnlineStatus('¡Conectado! Esperando al host...');
    document.getElementById('join-menu').classList.add('hidden');
    document.getElementById('guest-waiting').classList.remove('hidden');
    document.getElementById('guest-room-show').textContent = code;
  });

  conn.on('data', data => {
    if (data.type === 'welcome') { myPlayerIndex = data.playerIndex; }
    if (data.type === 'lobby')   { updateGuestLobby(data.slots); }
    if (data.type === 'start')   { receiveGameStart(data); }
    if (data.type === 'state')   { receiveGameState(data); }
    if (data.type === 'gameover'){ endGame(data.winnerId); }
  });

  conn.on('close', () => {
    console.warn('[Guest] conexión cerrada');
    if (GS !== 'playing') setOnlineStatus('Desconectado.', true);
  });

  // ── El error peer-unavailable llega AQUÍ (en el evento error del peer)
  //    después de que peer ya esté abierto, así que lo capturamos en el peer
  // ──
  peer.on('error', err => {
    console.error('[Guest peer] error post-open:', err.type);
    if (err.type === 'peer-unavailable') {
      setOnlineStatus('Sala "' + code + '" no encontrada. Comprueba el código.', true);
      conns = [];
      // Volver al menú de unirse
      document.getElementById('guest-waiting').classList.add('hidden');
      document.getElementById('join-menu').classList.remove('hidden');
    }
  });

  // Timeout de seguridad si conn.on('open') nunca llega
  setTimeout(() => {
    if (!conn.open && GS !== 'playing') {
      setOnlineStatus('Sin respuesta. ¿El host está conectado y tiene la sala abierta?', true);
      conns = [];
      document.getElementById('guest-waiting').classList.add('hidden');
      document.getElementById('join-menu').classList.remove('hidden');
    }
  }, 12000);
}

function updateGuestLobby(slots) {
  const c = document.getElementById('guest-lobby-slots'); if (!c) return;
  const ico = ['🟦','🟥','🟩','🟧'], cls = ['filled','p2','p3','p4'];
  c.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    if (slots[i]) {
      d.className   = `lobby-slot ${cls[i]}`;
      d.textContent = `${ico[i]} ${slots[i]}${i===myPlayerIndex?' (tú)':''}`;
    } else {
      d.className   = 'lobby-slot empty';
      d.textContent = `⬜ Esperando jugador ${i+1}...`;
    }
    c.appendChild(d);
  }
}

// ─────────────────────────────────────────────────────────────
//  INICIAR PARTIDA  (Host pulsa INICIAR)
// ─────────────────────────────────────────────────────────────
function startOnlineGame() {
  if (!isHost) return;
  const num = 1 + conns.length;
  generateMap();
  conns.forEach((c, i) => {
    try {
      c.send({
        type:'start', map, numPlayers:num,
        playerIndex: i+1,
        blockDensity, powerupDropChance,
        gameTimeSecs:    configGameTime || 180,
        startLivesCount: startLives    || 3,
      });
    } catch(_){}
  });
  currentMode = 'online';
  startGame(num);
  gameTime = configGameTime || 180;
  startStateSync();
}

// ─────────────────────────────────────────────────────────────
//  RECIBIR INICIO  (Guest)
// ─────────────────────────────────────────────────────────────
function receiveGameStart(data) {
  document.getElementById('guest-waiting').classList.add('hidden');
  map = data.map;
  blockDensity      = data.blockDensity      ?? 0.7;
  powerupDropChance = data.powerupDropChance ?? 0.30;
  myPlayerIndex     = data.playerIndex;

  currentMode = 'online';
  initAudio();
  GS = 'playing'; gameTime = data.gameTimeSecs ?? 180;
  bombs=[]; explosions=[]; powerups=[];
  initPlayers(data.numPlayers);
  players.forEach(p => { p.lives = data.startLivesCount ?? 3; });
  updateHUD();

  ['main-menu','mode-menu','pause-menu','gameover','online-menu',
   'join-menu','waiting-menu','guest-waiting'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.getElementById('hud').classList.remove('hidden');

  if (platformMode === 'mobile') {
    document.getElementById('mobile-overlay').classList.remove('hidden');
    applyMobileLayout();
  }

  stopMusic(); tuneIdx=0; startMusic();
  startGuestInputSend();
}

// ─────────────────────────────────────────────────────────────
//  SYNC ESTADO  Host → Guests  (20 fps)
// ─────────────────────────────────────────────────────────────
function startStateSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (GS !== 'playing' || !conns.length) return;
    const state = {
      type:'state', gameTime,
      players: players.map(p => ({
        id:p.id, col:p.col, row:p.row, x:p.x, y:p.y,
        tCol:p.tCol, tRow:p.tRow, dir:p.dir, moving:p.moving,
        animState:p.animState, animFrame:p.animFrame,
        alive:p.alive, dying:p.dying, dyingT:p.dyingT,
        invincible:p.invincible, lives:p.lives,
        maxBombs:p.maxBombs, fireRange:p.fireRange, speedMult:p.speedMult,
      })),
      bombs: bombs.map(b => ({col:b.col,row:b.row,timer:b.timer,range:b.range,owner:b.owner,t:b.t})),
      explosions: explosions.map(ex => ({cells:ex.cells,timer:ex.timer,t:ex.t})),
      powerups:   powerups.map(pu  => ({col:pu.col,row:pu.row,type:pu.type,t:pu.t})),
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
      const p = players[i]; if (!p) return;
      if (i !== myPlayerIndex) {
        p.x=pd.x; p.y=pd.y; p.col=pd.col; p.row=pd.row; p.tCol=pd.tCol; p.tRow=pd.tRow;
      }
      p.dir=pd.dir; p.moving=pd.moving;
      p.animState=pd.animState; p.animFrame=pd.animFrame;
      p.alive=pd.alive; p.dying=pd.dying; p.dyingT=pd.dyingT; p.invincible=pd.invincible;
      if (p.lives !== pd.lives) { p.lives=pd.lives; updateHUD(); }
      p.maxBombs=pd.maxBombs; p.fireRange=pd.fireRange; p.speedMult=pd.speedMult;
    });
  }
  bombs      = (data.bombs||[]).map(b  => ({...b,  passSet:new Set()}));
  explosions = (data.explosions||[]).map(ex => ({...ex}));
  powerups   = (data.powerups||[]).map(pu  => ({...pu}));
  if (data.map) map = data.map;
}

// ─────────────────────────────────────────────────────────────
//  INPUT  Guest → Host
// ─────────────────────────────────────────────────────────────
function startGuestInputSend() {
  if (guestInputInterval) clearInterval(guestInputInterval);
  guestInputInterval = setInterval(() => {
    if (GS !== 'playing' || !conns[0]?.open) return;
    const cfg   = PLAYER_CONFIG[myPlayerIndex];
    const touch = virtualHeld[myPlayerIndex+1] || new Set();
    let dir = null;
    if (touch.has('up')    || held.has(cfg?.keys?.up))    dir = 'up';
    if (touch.has('down')  || held.has(cfg?.keys?.down))  dir = 'down';
    if (touch.has('left')  || held.has(cfg?.keys?.left))  dir = 'left';
    if (touch.has('right') || held.has(cfg?.keys?.right)) dir = 'right';
    try { conns[0].send({type:'input', dir, playerIndex:myPlayerIndex}); } catch(_){}
  }, 50);
}

function applyGuestInput(player, data) {
  if (!player?.alive || player.dying) return;
  if (!data.dir) return;
  if (player.col !== player.tCol || player.row !== player.tRow) return;
  const m = {up:[0,-1,'up'],down:[0,1,'down'],left:[-1,0,'left'],right:[1,0,'right']};
  const [dc,dr,ds] = m[data.dir] || [0,0,player.dir];
  const nc=player.col+dc, nr=player.row+dr;
  if (player.isFree(nc,nr)) { player.tCol=nc; player.tRow=nr; }
  player.dir=ds;
}

// Hooks vacíos (cubiertos por state sync)
function onlineBombBroadcast()    {}
function onlineExplodeBroadcast() {}
function onlinePositionBroadcast(){}

// ─────────────────────────────────────────────────────────────
//  LIMPIAR
// ─────────────────────────────────────────────────────────────
function cancelRoom() { onlineCleanup(); goToMenu(); }

function onlineCleanup() {
  if (syncInterval)       { clearInterval(syncInterval);       syncInterval=null; }
  if (guestInputInterval) { clearInterval(guestInputInterval); guestInputInterval=null; }
  conns.forEach(c => { try { c.close(); } catch(_){} });
  conns=[];
  if (peer) { try { peer.destroy(); } catch(_){} peer=null; }
  isHost=false; myRoomCode=''; myPlayerIndex=0;
  Object.keys(guestNames).forEach(k => delete guestNames[k]);
}
