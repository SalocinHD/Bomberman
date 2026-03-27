
// ── CONFIGURACIÓN —
const FIREBASE_DB_URL = 'https://console.firebase.google.com/project/bomberman-a875e/overview';
// ── Estado online ──
let isHost        = false;
let myRoomCode    = '';
let myPlayerIndex = 0;
let guestInputInterval = null;
let syncInterval       = null;
let fireListeners      = [];   // refs de listeners para limpiarlos


function fbUrl(path) {
  return FIREBASE_DB_URL.replace(/\/$/, '') + '/' + path + '.json';
}

async function fbGet(path) {
  const r = await fetch(fbUrl(path));
  if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
  return r.json();
}

async function fbSet(path, data) {
  const r = await fetch(fbUrl(path), {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!r.ok) throw new Error('SET ' + path + ' → ' + r.status);
  return r.json();
}

async function fbPatch(path, data) {
  const r = await fetch(fbUrl(path), {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!r.ok) throw new Error('PATCH ' + path + ' → ' + r.status);
  return r.json();
}

async function fbDelete(path) {
  await fetch(fbUrl(path), { method: 'DELETE' });
}

/**
 * Escucha cambios en tiempo real usando EventSource (SSE de Firebase).
 * Devuelve una función para cancelar el listener.
 */
function fbListen(path, callback) {
  const url = fbUrl(path).replace('.json', '.json?orderBy="$key"&limitToLast=1');
  // Firebase SSE endpoint
  const src = new EventSource(
    FIREBASE_DB_URL.replace(/\/$/, '') + '/' + path + '.json',
    // Firebase acepta EventSource directamente
  );
  // Firebase SSE manda eventos 'put' y 'patch'
  const handler = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg && msg.data !== undefined) callback(msg.data);
    } catch(_) {}
  };
  src.addEventListener('put',   handler);
  src.addEventListener('patch', handler);
  src.onerror = () => {}; // silenciar errores de reconexión
  fireListeners.push(src);
  return () => { src.close(); };
}

// ─────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => ch[Math.floor(Math.random()*ch.length)]).join('');
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
  return (document.getElementById('player-name')?.value||'').trim() || 'Bombero';
}

// ─────────────────────────────────────────────────────────────
//  COMPROBAR CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────
function isFirebaseConfigured() {
  return FIREBASE_DB_URL && FIREBASE_DB_URL !== 'YOUR_DATABASE_URL_HERE';
}

function showFirebaseSetupError() {
  setOnlineStatus('Firebase no configurado — lee las instrucciones en online.js', true);

  // Mostrar overlay de instrucciones
  let ov = document.getElementById('firebase-setup-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'firebase-setup-overlay';
    ov.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.92);
      display:flex; flex-direction:column; align-items:center;
      justify-content:center; z-index:999;
      font-family:'Press Start 2P',monospace; color:#fff;
      padding:24px; text-align:center;
    `;
    ov.innerHTML = `
      <div style="font-size:18px;color:#ffcc00;margin-bottom:24px;text-shadow:0 0 20px #ffcc00;">
        ⚙ CONFIGURAR FIREBASE
      </div>
      <div style="font-size:8px;color:#aaa;line-height:2.2;max-width:500px;margin-bottom:24px;">
        Para el modo online necesitas una base de datos gratuita.<br><br>
        <span style="color:#44aaff;">1.</span> Ve a <span style="color:#ffcc00;">console.firebase.google.com</span><br>
        <span style="color:#44aaff;">2.</span> Crea un proyecto (gratis)<br>
        <span style="color:#44aaff;">3.</span> Realtime Database → Crear → Modo de prueba<br>
        <span style="color:#44aaff;">4.</span> Copia la URL de la base de datos<br>
        <span style="color:#44aaff;">5.</span> Pégala en <span style="color:#ffcc00;">online.js</span> línea 1:<br><br>
        <span style="color:#44ff88;font-size:7px;">const FIREBASE_DB_URL = 'https://TU-PROYECTO.firebaseio.com';</span>
      </div>
      <button onclick="document.getElementById('firebase-setup-overlay').remove();goToMenu();"
        style="font-family:'Press Start 2P',monospace;background:#ffcc00;color:#000;
               border:none;padding:12px 28px;cursor:pointer;font-size:11px;">
        ↩ VOLVER
      </button>
    `;
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────
//  CREAR SALA  (Host)
// ─────────────────────────────────────────────────────────────
async function createRoom() {
  if (!isFirebaseConfigured()) { showFirebaseSetupError(); return; }

  const hostName = getLocalName();
  setOnlineStatus('Creando sala...');

  // Generar código y verificar que no existe
  let code, attempts = 0;
  while (attempts < 10) {
    code = generateRoomCode();
    try {
      const existing = await fbGet('rooms/' + code + '/meta');
      if (!existing) break;   // sala libre
      attempts++;
    } catch(_) { break; }    // error de red → asumir libre
  }

  // Escribir sala en Firebase
  try {
    await fbSet('rooms/' + code, {
      meta:   { host: hostName, state: 'lobby', created: Date.now() },
      slots:  { 0: { name: hostName, connected: true } },
      inputs: {},
      state:  null,
    });
  } catch(e) {
    setOnlineStatus('Error al crear sala: ' + e.message, true); return;
  }

  isHost = true; myRoomCode = code; myPlayerIndex = 0;

  // Mostrar sala de espera
  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('waiting-menu').classList.remove('hidden');
  document.getElementById('room-code-show').textContent  = code;
  document.getElementById('host-name-label').textContent = hostName;
  setOnlineStatus('');

  // Escuchar cambios en los slots (guests uniéndose)
  const cancelSlots = fbListen('rooms/' + code + '/slots', (data) => {
    if (!data) return;
    updateHostLobbyFromData(data);
  });
  fireListeners.push({ close: cancelSlots });

  // Limpiar sala si el host cierra la pestaña
  window.addEventListener('beforeunload', () => fbDelete('rooms/' + code));

  console.log('[Host] Sala creada:', code);
}

function updateHostLobbyFromData(slots) {
  const ids  = ['guest-slot-1','guest-slot-2','guest-slot-3'];
  const cls  = ['p2','p3','p4'];
  const ico  = ['🟥','🟩','🟧'];

  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(ids[i]); if (!el) continue;
    const slot = slots[i + 1];
    if (slot?.name) {
      el.textContent = `${ico[i]} ${slot.name}`;
      el.className   = `lobby-slot ${cls[i]}`;
    } else {
      el.textContent = `⬜ Esperando jugador ${i+2}...`;
      el.className   = 'lobby-slot empty';
    }
  }

  // Contar guests conectados
  const guestCount = Object.keys(slots).filter(k => k !== '0' && slots[k]?.name).length;
  const btn = document.getElementById('start-online-btn');
  if (btn) { btn.disabled = guestCount < 1; btn.style.opacity = guestCount ? '1' : '0.35'; }
}

// ─────────────────────────────────────────────────────────────
//  UNIRSE A SALA  (Guest)
// ─────────────────────────────────────────────────────────────
async function joinRoomByCode() {
  if (!isFirebaseConfigured()) { showFirebaseSetupError(); return; }

  const raw  = document.getElementById('room-code-input')?.value || '';
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { setOnlineStatus('Código inválido (6 caracteres)', true); return; }

  const guestName = getLocalName();
  setOnlineStatus('Buscando sala ' + code + '...');

  // Verificar que la sala existe
  let roomData;
  try {
    roomData = await fbGet('rooms/' + code);
  } catch(e) {
    setOnlineStatus('Error de conexión: ' + e.message, true); return;
  }

  if (!roomData?.meta) {
    setOnlineStatus('Sala "' + code + '" no encontrada.', true); return;
  }
  if (roomData.meta.state === 'playing') {
    setOnlineStatus('La partida ya ha empezado.', true); return;
  }

  // Encontrar un slot libre
  const slots = roomData.slots || {};
  let mySlot = -1;
  for (let i = 1; i <= 3; i++) {
    if (!slots[i]?.name) { mySlot = i; break; }
  }
  if (mySlot === -1) { setOnlineStatus('Sala llena (máx. 4 jugadores).', true); return; }

  // Reservar slot
  try {
    await fbPatch('rooms/' + code + '/slots', {
      [mySlot]: { name: guestName, connected: true }
    });
  } catch(e) {
    setOnlineStatus('Error al unirse: ' + e.message, true); return;
  }

  isHost = false; myRoomCode = code; myPlayerIndex = mySlot;
  setOnlineStatus('¡Conectado! Esperando al host...');

  // Mostrar sala de espera del guest
  document.getElementById('join-menu').classList.add('hidden');
  document.getElementById('guest-waiting').classList.remove('hidden');
  document.getElementById('guest-room-show').textContent = code;

  // Escuchar slots (para actualizar la lista del lobby)
  const cancelSlots = fbListen('rooms/' + code + '/slots', (data) => {
    if (data) updateGuestLobby(data);
  });
  fireListeners.push({ close: cancelSlots });

  // Escuchar estado de la sala (cuando el host inicia la partida)
  const cancelMeta = fbListen('rooms/' + code + '/meta', (data) => {
    if (data?.state === 'playing') {
      startGuestGame(code);
    }
  });
  fireListeners.push({ close: cancelMeta });

  // Limpiar slot si el guest cierra la pestaña
  window.addEventListener('beforeunload', () =>
    fbDelete('rooms/' + code + '/slots/' + mySlot)
  );

  console.log('[Guest] Unido a sala:', code, 'como jugador', mySlot + 1);
}

function updateGuestLobby(slots) {
  const c = document.getElementById('guest-lobby-slots'); if (!c) return;
  const ico = ['🟦','🟥','🟩','🟧'], cls = ['filled','p2','p3','p4'];
  c.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const d   = document.createElement('div');
    const s   = slots[i];
    if (s?.name) {
      d.className   = `lobby-slot ${cls[i]}`;
      d.textContent = `${ico[i]} ${s.name}${i === myPlayerIndex ? ' (tú)' : ''}`;
    } else {
      d.className   = 'lobby-slot empty';
      d.textContent = `⬜ Esperando jugador ${i+1}...`;
    }
    c.appendChild(d);
  }
}

// ─────────────────────────────────────────────────────────────
//  INICIAR PARTIDA  (Host pulsa ▶ INICIAR)
// ─────────────────────────────────────────────────────────────
async function startOnlineGame() {
  if (!isHost) return;

  // Leer cuántos jugadores hay
  let slots;
  try { slots = await fbGet('rooms/' + myRoomCode + '/slots'); }
  catch(e) { setOnlineStatus('Error: ' + e.message, true); return; }

  const numPlayers = Object.keys(slots || {}).filter(k => slots[k]?.name).length;
  if (numPlayers < 2) { setOnlineStatus('Necesitas al menos 2 jugadores', true); return; }

  generateMap();

  // Serializar mapa (arrays de arrays → Firebase acepta JSON)
  const mapData = map.map(row => [...row]);

  // Escribir configuración + señal de inicio
  try {
    await fbPatch('rooms/' + myRoomCode + '/meta', {
      state:           'playing',
      numPlayers,
      blockDensity,
      powerupDropChance,
      gameTimeSecs:    configGameTime || 180,
      startLivesCount: startLives    || 3,
      mapData,
    });
  } catch(e) { setOnlineStatus('Error al iniciar: ' + e.message, true); return; }

  // Arrancar juego local del host
  currentMode = 'online';
  startGame(numPlayers);
  gameTime = configGameTime || 180;
  startStateSync();
}

// ─────────────────────────────────────────────────────────────
//  ARRANCAR PARTIDA  (Guest — cuando meta.state === 'playing')
// ─────────────────────────────────────────────────────────────
async function startGuestGame(code) {
  // Leer configuración desde Firebase
  let meta;
  try { meta = await fbGet('rooms/' + code + '/meta'); }
  catch(e) { setOnlineStatus('Error al recibir configuración: ' + e.message, true); return; }

  if (!meta || meta.state !== 'playing') return;

  map               = (meta.mapData || []).map(row => [...row]);
  blockDensity      = meta.blockDensity      ?? 0.7;
  powerupDropChance = meta.powerupDropChance ?? 0.30;
  const numPlayers  = meta.numPlayers        ?? 2;

  currentMode = 'online';
  initAudio();
  GS = 'playing'; gameTime = meta.gameTimeSecs ?? 180;
  bombs=[]; explosions=[]; powerups=[];
  initPlayers(numPlayers);
  players.forEach(p => { p.lives = meta.startLivesCount ?? 3; });
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

  // Escuchar estado del juego en tiempo real
  const cancelState = fbListen('rooms/' + code + '/state', (data) => {
    if (data && GS === 'playing') receiveGameState(data);
  });
  fireListeners.push({ close: cancelState });

  startGuestInputSend();
  console.log('[Guest] Juego iniciado como P', myPlayerIndex + 1);
}

// ─────────────────────────────────────────────────────────────
//  SYNC ESTADO  Host → Firebase → Guests  (~15 fps)
//  Reducimos a 15 fps para no exceder límites de Firebase free tier
// ─────────────────────────────────────────────────────────────
function startStateSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    if (GS !== 'playing') return;

    const state = {
      t: Date.now(),
      gameTime: Math.round(gameTime * 10) / 10,
      players: players.map(p => ({
        id:p.id, col:p.col, row:p.row,
        x: Math.round(p.x), y: Math.round(p.y),
        tCol:p.tCol, tRow:p.tRow,
        dir:p.dir, moving:p.moving ? 1 : 0,
        animState:p.animState, animFrame:p.animFrame,
        alive: p.alive ? 1 : 0,
        dying: p.dying ? 1 : 0,
        dyingT: Math.round((p.dyingT||0) * 10) / 10,
        inv: p.invincible ? 1 : 0,
        lives:p.lives, maxBombs:p.maxBombs,
        fireRange:p.fireRange, speedMult:p.speedMult,
      })),
      bombs: bombs.map(b => ({
        col:b.col, row:b.row,
        timer: Math.round(b.timer * 10) / 10,
        range:b.range, owner:b.owner,
        t: Math.round(b.t * 10) / 10,
      })),
      explosions: explosions.map(ex => ({
        cells:ex.cells,
        timer: Math.round(ex.timer * 10) / 10,
        t: Math.round(ex.t * 10) / 10,
      })),
      powerups: powerups.map(pu => ({
        col:pu.col, row:pu.row, type:pu.type,
        t: Math.round(pu.t * 10) / 10,
      })),
      map: map.map(row => [...row]),
    };

    try {
      await fbSet('rooms/' + myRoomCode + '/state', state);
    } catch(e) {
      console.warn('[Host] Error sync:', e.message);
    }
  }, 67); // ~15 fps
}

function receiveGameState(data) {
  if (GS !== 'playing' || !data) return;

  gameTime = data.gameTime ?? gameTime;

  if (data.players && players.length === data.players.length) {
    data.players.forEach((pd, i) => {
      const p = players[i]; if (!p) return;
      if (i !== myPlayerIndex) {
        p.x = pd.x; p.y = pd.y;
        p.col = pd.col; p.row = pd.row;
        p.tCol = pd.tCol; p.tRow = pd.tRow;
      }
      p.dir = pd.dir;
      p.moving    = !!pd.moving;
      p.animState = pd.animState;
      p.animFrame = pd.animFrame;
      p.alive     = !!pd.alive;
      p.dying     = !!pd.dying;
      p.dyingT    = pd.dyingT ?? 0;
      p.invincible = !!pd.inv;
      if (p.lives !== pd.lives) { p.lives = pd.lives; updateHUD(); }
      p.maxBombs  = pd.maxBombs;
      p.fireRange = pd.fireRange;
      p.speedMult = pd.speedMult;
    });
  }

  bombs = (data.bombs||[]).map(b => ({
    col:b.col, row:b.row, timer:b.timer, range:b.range,
    owner:b.owner, t:b.t, passSet:new Set()
  }));
  explosions = (data.explosions||[]).map(ex => ({
    cells:ex.cells, timer:ex.timer, t:ex.t
  }));
  powerups = (data.powerups||[]).map(pu => ({
    col:pu.col, row:pu.row, type:pu.type, t:pu.t
  }));
  if (data.map) map = data.map.map(row => [...row]);

  // Comprobar si la partida acabó
  const alivePlayers = players.filter(p => p.alive);
  if (alivePlayers.length <= 1 && players.length > 1) {
    endGame(alivePlayers.length === 1 ? alivePlayers[0].id : 0);
  }
}

// ─────────────────────────────────────────────────────────────
//  INPUT  Guest → Firebase → Host  (~20 fps)
// ─────────────────────────────────────────────────────────────
function startGuestInputSend() {
  if (guestInputInterval) clearInterval(guestInputInterval);

  // El host lee los inputs de Firebase cada frame en su loop
  startReadingGuestInputs();

  guestInputInterval = setInterval(async () => {
    if (GS !== 'playing') return;

    const cfg   = PLAYER_CONFIG[myPlayerIndex];
    const touch = virtualHeld[myPlayerIndex + 1] || new Set();
    let dir = null;
    if (touch.has('up')    || held.has(cfg?.keys?.up))    dir = 'up';
    if (touch.has('down')  || held.has(cfg?.keys?.down))  dir = 'down';
    if (touch.has('left')  || held.has(cfg?.keys?.left))  dir = 'left';
    if (touch.has('right') || held.has(cfg?.keys?.right)) dir = 'right';

    // Bomba: leer key bomb
    const bombPressed = held.has(cfg?.keys?.bomb) ||
                        (virtualHeld[myPlayerIndex+1]?.has('bomb'));

    try {
      await fbPatch('rooms/' + myRoomCode + '/inputs', {
        [myPlayerIndex]: { dir, bomb: bombPressed ? 1 : 0, t: Date.now() }
      });
    } catch(_) {}
  }, 50);
}

// El HOST lee inputs de los guests periódicamente
let inputReadInterval = null;
function startReadingGuestInputs() {
  if (!isHost) return;
  if (inputReadInterval) clearInterval(inputReadInterval);
  inputReadInterval = setInterval(async () => {
    if (GS !== 'playing') return;
    try {
      const inputs = await fbGet('rooms/' + myRoomCode + '/inputs');
      if (!inputs) return;
      Object.entries(inputs).forEach(([idx, inp]) => {
        const i = parseInt(idx);
        if (i === 0 || i >= players.length) return;
        const p = players[i];
        if (!p) return;
        // Aplicar movimiento
        if (inp.dir) applyGuestInput(p, inp);
        // Aplicar bomba
        if (inp.bomb && Date.now() - (inp.t||0) < 300) placeBomb(p);
      });
    } catch(_) {}
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
  if (inputReadInterval)  { clearInterval(inputReadInterval);  inputReadInterval=null; }

  // Cerrar EventSource listeners
  fireListeners.forEach(l => {
    if (typeof l === 'function')      l();
    else if (l?.close) try { l.close(); } catch(_){}
  });
  fireListeners = [];

  // Limpiar sala de Firebase si somos host
  if (isHost && myRoomCode) {
    fbDelete('rooms/' + myRoomCode).catch(()=>{});
  }

  isHost=false; myRoomCode=''; myPlayerIndex=0;
}
