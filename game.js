//Para ignacio: te e puesto muchisimos comentarios pa q no te quejes
// ── Constantes del grid ──
const CELL = 48;
const COLS = 15;
const ROWS = 13;
const CW   = COLS * CELL;   // 720 px
const CH   = ROWS * CELL;   // 624 px

const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

const T = { FLOOR: 0, WALL: 1, BREAK: 2 };

// ─────────────────────────────────────────────────────────────
//  ESTADO GLOBAL
// ─────────────────────────────────────────────────────────────
let GS               = 'menu';   // menu | playing | paused | gameover
let globalVol        = 0.7;
let blockDensity     = 0.7;
let powerupDropChance = 0.30;
let gameTime         = 180;

let map        = [];
let powerups   = [];
let bombs      = [];
let explosions = [];
let players    = [];

// Modo actual: 'local' | 'locura' | 'online'
let currentMode = 'local';

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE JUGADORES (colores, spawns, controles PC)
// ─────────────────────────────────────────────────────────────
const PLAYER_CONFIG = [
  { id:1, col:1,      row:1,      body:'#3399ff', accent:'#1155cc',
    keys:{ up:'KeyW',      down:'KeyS',    left:'KeyA',     right:'KeyD',    bomb:'Space' } },
  { id:2, col:COLS-2, row:ROWS-2, body:'#ff4444', accent:'#aa1111',
    keys:{ up:'ArrowUp',   down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', bomb:'Enter' } },
  { id:3, col:1,      row:ROWS-2, body:'#44ff88', accent:'#118844',
    keys:{ up:'KeyI',      down:'KeyK',    left:'KeyJ',     right:'KeyL',    bomb:'KeyO' } },
  { id:4, col:COLS-2, row:1,      body:'#ff8800', accent:'#aa5500',
    keys:{ up:'Numpad8',   down:'Numpad5', left:'Numpad4',  right:'Numpad6', bomb:'Numpad0' } },
];

// ─────────────────────────────────────────────────────────────
//  AUDIO
// ─────────────────────────────────────────────────────────────
let AC = null;

function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
}

function setVolume(v) {
  globalVol = v / 100;
  document.getElementById('vol-val').textContent = v;
}

function sfx(type) {
  if (!AC) return;
  const now = AC.currentTime;
  const mg  = AC.createGain();
  mg.gain.value = globalVol * 0.35;
  mg.connect(AC.destination);

  if (type === 'explosion') {
    const len = AC.sampleRate * 0.45;
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = AC.createBufferSource();
    s.buffer = buf;
    const g = AC.createGain();
    g.gain.setValueAtTime(globalVol * 0.6, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    s.connect(g); g.connect(AC.destination);
    s.start(now);
    return;
  }

  const o = AC.createOscillator();
  o.connect(mg);
  switch (type) {
    case 'place':
      o.type = 'square';
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(90, now + 0.12);
      mg.gain.setValueAtTime(globalVol * 0.18, now);
      mg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      o.start(now); o.stop(now + 0.12); break;
    case 'death':
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(500, now);
      o.frequency.exponentialRampToValueAtTime(50, now + 0.9);
      mg.gain.setValueAtTime(globalVol * 0.3, now);
      mg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      o.start(now); o.stop(now + 0.9); break;
    case 'powerup':
      o.type = 'square';
      [523,659,784,1047].forEach((f,i) => o.frequency.setValueAtTime(f, now + i*0.08));
      mg.gain.setValueAtTime(globalVol*0.15, now);
      mg.gain.setValueAtTime(0.001, now+0.35);
      o.start(now); o.stop(now+0.38); break;
    case 'win':
      o.type = 'square';
      [523,659,784,1047,784,1047,1319].forEach((f,i) => o.frequency.setValueAtTime(f, now+i*0.1));
      mg.gain.setValueAtTime(globalVol*0.2, now);
      mg.gain.setValueAtTime(0.001, now+0.8);
      o.start(now); o.stop(now+0.82); break;
  }
}

// ── Música ──
const TUNE = [
  [659,150],[659,150],[659,150],[659,75],[588,75],[659,150],[784,150],
  [659,150],[659,150],[659,150],[659,75],[588,75],[659,150],[880,150],
  [784,150],[784,150],[784,75],[659,75],[784,150],[880,150],[988,300],
  [880,150],[880,150],[880,150],[880,75],[784,75],[880,150],[988,150],
  [1047,150],[1047,150],[1047,150],[1047,75],[988,75],[1047,150],[1175,150],
  [1047,150],[988,150],[880,150],[784,150],[659,300],[659,150],
];
let musicPlaying=false, tuneIdx=0, musicTO=null;

function startMusic() {
  if (!AC || musicPlaying) return;
  musicPlaying=true; tuneIdx=0; playTuneNote();
}
function playTuneNote() {
  if (!musicPlaying||!AC) return;
  const [freq,dur] = TUNE[tuneIdx % TUNE.length]; tuneIdx++;
  const o=AC.createOscillator(), g=AC.createGain();
  o.type='square'; o.frequency.value=freq;
  const now=AC.currentTime;
  g.gain.setValueAtTime(0.07*globalVol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now+dur/1000-0.02);
  o.connect(g); g.connect(AC.destination);
  o.start(now); o.stop(now+dur/1000);
  musicTO = setTimeout(playTuneNote, dur);
}
function stopMusic() { musicPlaying=false; if(musicTO) clearTimeout(musicTO); }

// ─────────────────────────────────────────────────────────────
//  INPUT — teclado
// ─────────────────────────────────────────────────────────────
const held    = new Set();
const pressed = new Set();

window.addEventListener('keydown', e => {
  if (!held.has(e.code)) pressed.add(e.code);
  held.add(e.code);
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (GS==='playing') pauseGame();
    else if (GS==='paused') resumeGame();
  }
  if (GS==='playing') {
    for (const p of players) {
      if (e.code === p.keys.bomb) placeBomb(p);
    }
  }
});
window.addEventListener('keyup', e => { held.delete(e.code); pressed.delete(e.code); });

// ─────────────────────────────────────────────────────────────
//  INPUT — táctil (D-pads móvil)
//  Cada botón del D-pad inyecta directamente en held/pressed
//  igual que si fuera teclado, de forma transparente para el resto
// ─────────────────────────────────────────────────────────────

// virtualHeld almacena qué direcciones están siendo tocadas por cada jugador
// Estructura: { 1: Set<dir>, 2: Set<dir> }
const virtualHeld = { 1: new Set(), 2: new Set() };

function initTouchControls() {
  const overlay = document.getElementById('mobile-overlay');

  // D-pad buttons
  overlay.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
    const pid = parseInt(btn.dataset.player);
    const dir = btn.dataset.dir;

    const press = (e) => {
      e.preventDefault();
      virtualHeld[pid].add(dir);
      btn.classList.add('pressed');
      // Trigger bomb if needed (handled by bomb-btn separately)
    };
    const release = (e) => {
      e.preventDefault();
      virtualHeld[pid].delete(dir);
      btn.classList.remove('pressed');
    };

    btn.addEventListener('touchstart',  press,   { passive: false });
    btn.addEventListener('touchend',    release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    // También mouse para debug en escritorio
    btn.addEventListener('mousedown',  press);
    btn.addEventListener('mouseup',    release);
    btn.addEventListener('mouseleave', release);
  });

  // Bomb buttons
  overlay.querySelectorAll('.bomb-btn').forEach(btn => {
    const pid = parseInt(btn.dataset.player);
    const fire = (e) => {
      e.preventDefault();
      if (GS==='playing') {
        const p = players.find(p => p.id === pid);
        if (p) placeBomb(p);
      }
    };
    btn.addEventListener('touchstart', fire, { passive: false });
    btn.addEventListener('mousedown',  fire);
  });
}

// ─────────────────────────────────────────────────────────────
//  GENERACIÓN DEL MAPA
// ─────────────────────────────────────────────────────────────
const SPAWN_SAFE = new Set([
  '1,1','2,1','1,2',
  `${COLS-2},1`,`${COLS-3},1`,`${COLS-2},2`,
  `1,${ROWS-2}`,`2,${ROWS-2}`,`1,${ROWS-3}`,
  `${COLS-2},${ROWS-2}`,`${COLS-3},${ROWS-2}`,`${COLS-2},${ROWS-3}`,
]);

function generateMap() {
  map = []; powerups = [];
  for (let r = 0; r < ROWS; r++) {
    map[r] = [];
    for (let c = 0; c < COLS; c++) {
      if (r===0||r===ROWS-1||c===0||c===COLS-1) { map[r][c]=T.WALL; continue; }
      if (r%2===0 && c%2===0)                    { map[r][c]=T.WALL; continue; }
      if (SPAWN_SAFE.has(`${c},${r}`))            { map[r][c]=T.FLOOR; continue; }
      map[r][c] = Math.random() < blockDensity ? T.BREAK : T.FLOOR;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  EXPLOSIONES
// ─────────────────────────────────────────────────────────────
function explodeBomb(bomb) {
  const bi = bombs.indexOf(bomb);
  if (bi !== -1) bombs.splice(bi, 1);

  const cells = [{ col:bomb.col, row:bomb.row, seg:'center' }];
  const dirs  = [{dc:0,dr:-1},{dc:0,dr:1},{dc:-1,dr:0},{dc:1,dr:0}];

  for (const {dc,dr} of dirs) {
    for (let i = 1; i <= bomb.range; i++) {
      const nc=bomb.col+dc*i, nr=bomb.row+dr*i;
      if (nr<0||nr>=ROWS||nc<0||nc>=COLS) break;
      if (map[nr][nc]===T.WALL) break;
      cells.push({ col:nc, row:nr, seg: i===bomb.range?'end':'mid' });
      if (map[nr][nc]===T.BREAK) {
        map[nr][nc]=T.FLOOR;
        if (Math.random() < powerupDropChance) {
          const types=['bomb','fire','speed'];
          powerups.push({ col:nc, row:nr, type:types[Math.floor(Math.random()*3)], t:0 });
        }
        break;
      }
    }
  }
  explosions.push({ cells, timer:0.65, t:0 });
  sfx('explosion');

  // Si es online, el host transmite la explosión a los guests
  if (typeof onlineExplodeBroadcast === 'function') onlineExplodeBroadcast(bomb.col, bomb.row);
}

function updateBombs(dt) {
  let again = true;
  while (again) {
    again = false;
    for (const bomb of [...bombs]) {
      const inFire = explosions.some(ex => ex.cells.some(c=>c.col===bomb.col&&c.row===bomb.row));
      if (inFire || bomb.timer<=0) { explodeBomb(bomb); again=true; break; }
    }
  }
  for (const b of bombs) {
    b.timer-=dt; b.t+=dt;
    for (const p of players) {
      if (b.passSet.has(p.id) && (p.col!==b.col||p.row!==b.row)) b.passSet.delete(p.id);
    }
  }
}

function updateExplosions(dt) {
  for (let i=explosions.length-1;i>=0;i--) {
    explosions[i].timer-=dt; explosions[i].t+=dt;
    if (explosions[i].timer<=0) explosions.splice(i,1);
  }
}

// ─────────────────────────────────────────────────────────────
//  BOMBAS
// ─────────────────────────────────────────────────────────────
function placeBomb(player) {
  if (!player.alive||player.dying) return;
  if (bombs.filter(b=>b.owner===player.id).length >= player.maxBombs) return;
  if (bombs.some(b=>b.col===player.col&&b.row===player.row)) return;
  const ps=new Set(); ps.add(player.id);
  bombs.push({ col:player.col, row:player.row, timer:3, range:player.fireRange, owner:player.id, passSet:ps, t:0 });
  sfx('place');

  // Notificar a online si está activo
  if (typeof onlineBombBroadcast === 'function') onlineBombBroadcast(player.col, player.row, player.fireRange, player.id);
}

// ─────────────────────────────────────────────────────────────
//  CLASE PLAYER
// ─────────────────────────────────────────────────────────────
class Player {
  constructor(id, col, row, bodyColor, accentColor, keys) {
    this.id=id; this.col=col; this.row=row;
    this.tCol=col; this.tRow=row;
    this.x=col*CELL+CELL/2; this.y=row*CELL+CELL/2;
    this.bodyColor=bodyColor; this.accentColor=accentColor; this.keys=keys;

    this.lives=3; this.maxBombs=1; this.fireRange=1; this.speedMult=1;
    this.alive=true; this.dying=false; this.dyingT=0;
    this.invincible=false; this.invincT=0;

    this.animState='idle'; this.animFrame=0; this.animT=0;
    this.dir='down'; this.moving=false;

    // Spawn original para reaparición
    this.spawnCol=col; this.spawnRow=row;
  }

  get speed() { return (3.2 + this.speedMult * 0.8) * CELL; }

  isFree(c,r) {
    if (c<0||c>=COLS||r<0||r>=ROWS) return false;
    if (map[r][c]!==T.FLOOR) return false;
    for (const b of bombs) {
      if (b.col===c&&b.row===r&&!b.passSet.has(this.id)) return false;
    }
    return true;
  }

  update(dt) {
    if (!this.alive) return;
    if (this.invincible) { this.invincT-=dt; if(this.invincT<=0) this.invincible=false; }

    if (this.dying) {
      this.dyingT-=dt; this.animT+=dt; this.animState='dying';
      this.animFrame=Math.floor(this.animT*8)%8;
      if (this.dyingT<=0) {
        this.dying=false;
        if (this.lives<=0) {
          this.alive=false;
          checkWin(); // ahora sí: alive=false, el filtro lo excluye correctamente
          return;
        }
        // Tiene vidas restantes → reaparece
        this.col=this.tCol=this.spawnCol;
        this.row=this.tRow=this.spawnRow;
        this.x=this.spawnCol*CELL+CELL/2;
        this.y=this.spawnRow*CELL+CELL/2;
        this.invincible=true; this.invincT=2.5;
      }
      return;
    }

    // Movimiento suave
    const tx=this.tCol*CELL+CELL/2, ty=this.tRow*CELL+CELL/2;
    const dx=tx-this.x, dy=ty-this.y, dist=Math.hypot(dx,dy);
    const step=this.speed*dt;
    if (dist<=step||dist<0.5) {
      this.x=tx; this.y=ty; this.col=this.tCol; this.row=this.tRow;
      this.moving=false; this._readInput();
    } else {
      this.x+=dx/dist*step; this.y+=dy/dist*step; this.moving=true;
    }

    // Animación
    this.animT+=dt;
    const fps=this.moving?9:1.5;
    if (this.animT>1/fps) { this.animT=0; this.animFrame=(this.animFrame+1)%4; }
    this.animState=this.moving?'walk'+this.dir:'idle';

    // Power-ups
    for (let i=powerups.length-1;i>=0;i--) {
      const pu=powerups[i];
      if (pu.col===this.col&&pu.row===this.row) {
        switch(pu.type) {
          case 'bomb':  this.maxBombs =Math.min(this.maxBombs+1,5);  break;
          case 'fire':  this.fireRange=Math.min(this.fireRange+1,6);  break;
          case 'speed': this.speedMult=Math.min(this.speedMult+1,4);  break;
        }
        powerups.splice(i,1); sfx('powerup'); updateHUD();
      }
    }

    // Daño por explosión
    if (!this.invincible) {
      for (const ex of explosions) {
        if (ex.cells.some(c=>c.col===this.col&&c.row===this.row)) { this._die(); break; }
      }
    }

    // Notificar posición si online
    if (typeof onlinePositionBroadcast === 'function') onlinePositionBroadcast(this);
  }

  // _readInput lee tanto teclado como táctil
  _readInput() {
    let dc=0, dr=0, dir=this.dir;

    // ── Táctil ──
    const touch = virtualHeld[this.id];
    if (touch) {
      if      (touch.has('up'))    { dr=-1; dir='up';    }
      else if (touch.has('down'))  { dr= 1; dir='down';  }
      else if (touch.has('left'))  { dc=-1; dir='left';  }
      else if (touch.has('right')) { dc= 1; dir='right'; }
    }

    // ── Teclado (sobrescribe táctil si está presionado) ──
    if (this.keys) {
      if      (held.has(this.keys.up))    { dr=-1; dir='up';    }
      else if (held.has(this.keys.down))  { dr= 1; dir='down';  }
      else if (held.has(this.keys.left))  { dc=-1; dir='left';  }
      else if (held.has(this.keys.right)) { dc= 1; dir='right'; }
    }

    if (dc||dr) {
      const nc=this.col+dc, nr=this.row+dr;
      if (this.isFree(nc,nr)) { this.tCol=nc; this.tRow=nr; }
      this.dir=dir;
    }
  }

  _die() {
    if (this.dying) return;
    this.lives--; this.dying=true; this.dyingT=1.2; this.animT=0;
    sfx('death'); updateHUD();
    // NO llamamos checkWin aquí — se llama cuando termina la animación
    // (si llamamos ahora, dying=true excluye al jugador del conteo)
  }

  // ─── Dibujo (spritesheet virtual) ───────────────────────────
  draw() {
    if (!this.alive) return;
    if (this.invincible && Math.floor(Date.now()/80)%2===0) return;

    const cx=this.x, cy=this.y, f=this.animFrame;
    ctx.save();

    if (this.dying) {
      const prog=(1.2-this.dyingT)/1.2;
      ctx.translate(cx,cy); ctx.rotate(prog*Math.PI*6); ctx.scale(1-prog*.9,1-prog*.9); ctx.translate(-cx,-cy);
    }

    // Sombra
    ctx.fillStyle='rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(cx,cy+18,14,4,0,0,Math.PI*2); ctx.fill();

    const legFrames=[[0,6],[4,2],[6,0],[2,4]];
    const [lOff,rOff]=legFrames[f%4];
    const bob=this.animState==='idle'?Math.sin(Date.now()/350)*2:0;
    const lean=this.animState==='walkleft'?-2:this.animState==='walkright'?2:0;

    // Piernas
    ctx.fillStyle=this.bodyColor;
    ctx.fillRect(cx-11+lean,cy+9+bob,8,12+lOff);
    ctx.fillRect(cx+3+lean,cy+9+bob,8,12+rOff);

    // Cuerpo
    ctx.fillStyle=this.bodyColor;
    ctx.beginPath(); ctx.roundRect(cx-13+lean,cy-12+bob,26,24,5); ctx.fill();

    // Cinturón
    ctx.fillStyle=this.accentColor;
    ctx.fillRect(cx-13+lean,cy-2+bob,26,5);

    // Insignia
    ctx.fillStyle='rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.arc(cx+lean,cy-4+bob,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 7px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('P'+this.id,cx+lean,cy-4+bob);

    // Cabeza
    ctx.fillStyle='#f5c48a';
    ctx.beginPath(); ctx.arc(cx+lean,cy-20+bob,12,0,Math.PI*2); ctx.fill();

    // Ojos según dirección
    ctx.fillStyle='#222';
    if (this.dir==='down') {
      ctx.beginPath(); ctx.arc(cx-4+lean,cy-18+bob,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx+4+lean,cy-18+bob,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(cx-3+lean,cy-19+bob,1,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx+5+lean,cy-19+bob,1,0,Math.PI*2); ctx.fill();
    } else if (this.dir==='up') {
      ctx.beginPath(); ctx.arc(cx-4+lean,cy-22+bob,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx+4+lean,cy-22+bob,2.5,0,Math.PI*2); ctx.fill();
    } else if (this.dir==='right') {
      ctx.beginPath(); ctx.arc(cx+6+lean,cy-19+bob,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx+7+lean,cy-20+bob,1,0,Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(cx-6+lean,cy-19+bob,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx-7+lean,cy-20+bob,1,0,Math.PI*2); ctx.fill();
    }

    // Casco
    ctx.fillStyle=this.accentColor;
    ctx.beginPath(); ctx.ellipse(cx+lean,cy-30+bob,10,5,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.ellipse(cx-3+lean,cy-32+bob,4,2,-0.3,0,Math.PI*2); ctx.fill();

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────
//  INICIALIZACIÓN DE JUGADORES
//  numPlayers: cuántos instanciar (2-4)
//  onlinePlayerIndex: si online, índice asignado a este cliente (0-3)
// ─────────────────────────────────────────────────────────────
function initPlayers(numPlayers = 2) {
  players = [];
  for (let i = 0; i < numPlayers; i++) {
    const cfg = PLAYER_CONFIG[i];
    players.push(new Player(cfg.id, cfg.col, cfg.row, cfg.body, cfg.accent, cfg.keys));
  }
}

// ─────────────────────────────────────────────────────────────
//  WIN / END
// ─────────────────────────────────────────────────────────────
function checkWin(timeUp = false) {
  // Un jugador cuenta como "eliminado" si alive=false
  // Si dying=true pero lives>0, sigue contando (va a reaparecer)
  // Si dying=true y lives=0, ya tiene alive=false cuando llegamos aquí
  const alive = players.filter(p => p.alive);

  if (timeUp) {
    // Gana quien más vidas tenga
    const max = Math.max(...players.map(p=>p.lives));
    const winners = players.filter(p=>p.lives===max);
    endGame(winners.length===1 ? winners[0].id : 0);
    return;
  }
  if (alive.length <= 1) {
    endGame(alive.length===1 ? alive[0].id : 0);
  }
}

function endGame(winnerId) {
  if (GS==='gameover') return;
  GS='gameover'; stopMusic();
  if (winnerId>0) sfx('win');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover').classList.remove('hidden');
  document.getElementById('mobile-overlay').classList.add('hidden');
  const wt=document.getElementById('winner-text');
  const colors=['','w-p1','w-p2','w-p3','w-p4'];
  const names=['','🟦 JUGADOR 1','🟥 JUGADOR 2','🟩 JUGADOR 3','🟧 JUGADOR 4'];
  if (winnerId===0) { wt.className='winner-text w-draw'; wt.textContent='💥 ¡EMPATE! 💥'; }
  else              { wt.className=`winner-text ${colors[winnerId]}`; wt.textContent=`${names[winnerId]} GANA!`; }
}

// ─────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────
function updateHUD() {
  if (!players[0]) return;
  const hearts = n => '❤'.repeat(Math.max(0,n));
  const p = players;
  if (p[0]) {
    document.getElementById('p1-lives').textContent = hearts(p[0].lives);
    document.getElementById('p1-stats').textContent = `💣×${p[0].maxBombs} 🔥×${p[0].fireRange} ⚡×${p[0].speedMult}`;
  }
  if (p[1]) {
    document.getElementById('p2-lives').textContent = hearts(p[1].lives);
    document.getElementById('p2-stats').textContent = `💣×${p[1].maxBombs} 🔥×${p[1].fireRange} ⚡×${p[1].speedMult}`;
  }
}

function updateTimerHUD() {
  const m=Math.floor(gameTime/60), s=Math.floor(gameTime%60);
  const el=document.getElementById('game-timer');
  el.textContent=`${m}:${s.toString().padStart(2,'0')}`;
  el.style.color=gameTime<=30?(Math.floor(gameTime*2)%2===0?'#ff2222':'#ffcc00'):'#ffcc00';
}

// ─────────────────────────────────────────────────────────────
//  RENDERIZADO
// ─────────────────────────────────────────────────────────────
function drawFloor(x,y,c,r) {
  ctx.fillStyle=(c+r)%2===0?'#3a6e22':'#336020';
  ctx.fillRect(x,y,CELL,CELL);
  ctx.strokeStyle='rgba(0,0,0,.12)'; ctx.lineWidth=.5;
  ctx.strokeRect(x,y,CELL,CELL);
}

function drawWall(x,y) {
  ctx.fillStyle='#777'; ctx.fillRect(x,y,CELL,CELL);
  ctx.fillStyle='#999'; ctx.fillRect(x,y,CELL,5); ctx.fillRect(x,y,4,CELL);
  ctx.fillStyle='#444'; ctx.fillRect(x,y+CELL-4,CELL,4); ctx.fillRect(x+CELL-4,y,4,CELL);
  ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(x,y+16);    ctx.lineTo(x+CELL,y+16);
  ctx.moveTo(x,y+32);    ctx.lineTo(x+CELL,y+32);
  ctx.moveTo(x+24,y);    ctx.lineTo(x+24,y+16);
  ctx.moveTo(x+12,y+16); ctx.lineTo(x+12,y+32);
  ctx.moveTo(x+36,y+16); ctx.lineTo(x+36,y+32);
  ctx.moveTo(x+24,y+32); ctx.lineTo(x+24,y+CELL);
  ctx.stroke();
}

function drawBreak(x,y) {
  ctx.fillStyle='#b87340'; ctx.fillRect(x,y,CELL,CELL);
  ctx.fillStyle='#d08850'; ctx.fillRect(x,y,CELL,5); ctx.fillRect(x,y,4,CELL);
  ctx.fillStyle='#7a4a20'; ctx.fillRect(x,y+CELL-4,CELL,4); ctx.fillRect(x+CELL-4,y,4,CELL);
  ctx.strokeStyle='rgba(0,0,0,.2)'; ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(x+6,y+6); ctx.lineTo(x+CELL-6,y+CELL-6);
  ctx.moveTo(x+CELL-6,y+6); ctx.lineTo(x+6,y+CELL-6);
  ctx.strokeRect(x+6,y+6,CELL-12,CELL-12);
  ctx.stroke();
}

function drawMap() {
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const x=c*CELL, y=r*CELL;
    if      (map[r][c]===T.FLOOR) drawFloor(x,y,c,r);
    else if (map[r][c]===T.WALL)  drawWall(x,y);
    else                           drawBreak(x,y);
  }
}

function drawPowerups() {
  for (const pu of powerups) {
    pu.t+=0.016;
    const x=pu.col*CELL+CELL/2, y=pu.row*CELL+CELL/2;
    const bob=Math.sin(pu.t*3.5)*3, pulse=.92+Math.sin(pu.t*5)*.08;
    const colors={bomb:'#ff4400',fire:'#ff8800',speed:'#00ccff'};
    ctx.save();
    ctx.translate(x,y+bob); ctx.scale(pulse,pulse);
    ctx.shadowColor=colors[pu.type]; ctx.shadowBlur=14;
    ctx.fillStyle=colors[pu.type];
    ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=2; ctx.stroke();
    ctx.shadowBlur=0;
    ctx.font='14px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(pu.type==='bomb'?'💣':pu.type==='fire'?'🔥':'⚡',0,1);
    ctx.restore();
  }
}

function drawBombs() {
  for (const b of bombs) {
    const x=b.col*CELL+CELL/2, y=b.row*CELL+CELL/2;
    const urgency=Math.max(0,(3-b.timer)/3);
    const pulse=1+Math.sin(b.t*Math.PI*2*(1+urgency*4))*(0.05+urgency*.12);
    ctx.save(); ctx.translate(x,y); ctx.scale(pulse,pulse);
    ctx.fillStyle='rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(2,14,11,4,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=urgency>.75?`hsl(${Math.floor(Date.now()/80)%2*20},100%,40%)`:'#111';
    ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.ellipse(-4,-6,5,3,-Math.PI/4,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#8B4513'; ctx.lineWidth=2.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(5,-13); ctx.quadraticCurveTo(14,-20,10,-28); ctx.stroke();
    ctx.fillStyle=urgency>.5?'#ff4400':'#ffcc00';
    ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(9+(Math.random()-.5)*3,-28+(Math.random()-.5)*3,3.5,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0; ctx.restore();
  }
}

function drawExplosions() {
  for (const ex of explosions) {
    const alpha=ex.timer<0.2?ex.timer/0.2:1;
    for (const cell of ex.cells) {
      const x=cell.col*CELL, y=cell.row*CELL;
      const g=ctx.createRadialGradient(x+CELL/2,y+CELL/2,0,x+CELL/2,y+CELL/2,CELL*.7);
      if (cell.seg==='center') {
        g.addColorStop(0,`rgba(255,255,255,${alpha})`);
        g.addColorStop(.35,`rgba(255,220,0,${alpha})`);
        g.addColorStop(1,`rgba(255,80,0,${alpha*.8})`);
      } else if (cell.seg==='mid') {
        g.addColorStop(0,`rgba(255,200,0,${alpha})`);
        g.addColorStop(1,`rgba(255,80,0,${alpha*.6})`);
      } else {
        g.addColorStop(0,`rgba(255,140,0,${alpha})`);
        g.addColorStop(1,`rgba(255,40,0,${alpha*.4})`);
      }
      ctx.fillStyle=g; ctx.fillRect(x,y,CELL,CELL);
      if (ex.t<0.3&&Math.random()>.5) {
        ctx.fillStyle=`rgba(255,255,200,${alpha*.7})`;
        for (let i=0;i<2;i++) {
          ctx.beginPath();
          ctx.arc(x+8+Math.random()*(CELL-16),y+8+Math.random()*(CELL-16),2+Math.random()*3,0,Math.PI*2);
          ctx.fill();
        }
      }
    }
  }
}

function drawTitleScreen() {
  ctx.fillStyle='#0a0a12'; ctx.fillRect(0,0,CW,CH);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const x=c*CELL, y=r*CELL;
    ctx.fillStyle=(r===0||r===ROWS-1||c===0||c===COLS-1||(r%2===0&&c%2===0))?'#1a1a28':((c+r)%2===0?'#0f1a08':'#0d1706');
    ctx.fillRect(x+1,y+1,CELL-2,CELL-2);
  }
  const deco=[{x:120,y:180},{x:580,y:180},{x:100,y:440},{x:600,y:440}];
  for (const d of deco) {
    ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(d.x,d.y,20,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#8B4513'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(d.x+7,d.y-17); ctx.quadraticCurveTo(d.x+18,d.y-27,d.x+13,d.y-36); ctx.stroke();
    ctx.fillStyle='#ffcc00'; ctx.beginPath(); ctx.arc(d.x+13,d.y-36,5,0,Math.PI*2); ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────
//  BUCLE PRINCIPAL
// ─────────────────────────────────────────────────────────────
let lastT=0;

function loop(ts) {
  const dt=Math.min((ts-lastT)/1000,0.05); lastT=ts;

  if (GS==='playing') {
    gameTime-=dt;
    if (gameTime<=0) { gameTime=0; checkWin(true); }
    for (const p of players) p.update(dt);
    updateBombs(dt);
    updateExplosions(dt);
    updateTimerHUD();
    ctx.clearRect(0,0,CW,CH);
    drawMap(); drawPowerups(); drawBombs(); drawExplosions();
    for (const p of players) p.draw();
    pressed.clear();
  } else if (GS==='menu') {
    drawTitleScreen();
  }
  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE PARTIDA
// ─────────────────────────────────────────────────────────────
let startLives = 3;        // vidas iniciales por jugador
let configGameTime = 180;  // duración de la partida en segundos

function setDiff(d, btn) {
  blockDensity = d;
  document.querySelectorAll('.cfg-btn[onclick*="setDiff"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setPowerupChance(c, btn) {
  powerupDropChance = c;
  document.querySelectorAll('.cfg-btn[onclick*="setPowerupChance"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setGameTime(secs, btn) {
  configGameTime = secs;
  document.querySelectorAll('.cfg-btn[onclick*="setGameTime"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('cfg-time-val');
  if (el) {
    if (secs >= 600) el.textContent = '∞';
    else { const m=Math.floor(secs/60),s=secs%60; el.textContent=`${m}:${s.toString().padStart(2,'0')}`; }
  }
}

function setStartLives(n, btn) {
  startLives = n;
  document.querySelectorAll('.cfg-btn[onclick*="setStartLives"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('cfg-lives-val');
  if (el) el.textContent = n;
}

/** Llamado desde el botón ▶ JUGAR del menú de configuración */
function startConfiguredGame() {
  gameTime = configGameTime;
  startGame();
}

// ─────────────────────────────────────────────────────────────
//  ACCIONES DE MENÚ
// ─────────────────────────────────────────────────────────────
let platformMode = 'pc';

function selectPlatform(mode) {
  platformMode = mode;
  document.getElementById('btn-pc').classList.toggle('active',     mode==='pc');
  document.getElementById('btn-mobile').classList.toggle('active', mode==='mobile');
  document.getElementById('pc-controls').classList.toggle('hidden',     mode==='mobile');
  document.getElementById('mobile-controls').classList.toggle('hidden', mode==='pc');
}

function showModeMenu() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('mode-menu').classList.remove('hidden');
}

function showOnlineMenu() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('mode-menu').classList.add('hidden');
  document.getElementById('online-menu').classList.remove('hidden');
  document.getElementById('online-status').textContent = '';
}

function showJoinMenu() {
  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('join-menu').classList.remove('hidden');
  document.getElementById('join-status').textContent = '';
}

/** Arranca partida local con la configuración actual */
function startGame(numPlayers = 2) {
  initAudio();
  GS = 'playing';
  gameTime = configGameTime;
  bombs = []; explosions = []; powerups = [];
  generateMap();
  initPlayers(numPlayers);

  // Aplicar vidas iniciales configuradas
  players.forEach(p => { p.lives = startLives; });
  updateHUD();

  ['main-menu','mode-menu','pause-menu','gameover','online-menu',
   'join-menu','waiting-menu','guest-waiting'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  document.getElementById('hud').classList.remove('hidden');

  if (platformMode === 'mobile') {
    document.getElementById('mobile-overlay').classList.remove('hidden');
    applyMobileLayout();
  } else {
    document.getElementById('mobile-overlay').classList.add('hidden');
    // Resetear escala por si se vuelve de móvil a PC
    document.getElementById('wrapper').style.transform = '';
  }

  stopMusic(); tuneIdx = 0; startMusic();
}

function pauseGame() {
  if (GS !== 'playing') return;
  GS = 'paused';
  document.getElementById('pause-menu').classList.remove('hidden');
  stopMusic();
}

function resumeGame() {
  if (GS !== 'paused') return;
  GS = 'playing';
  document.getElementById('pause-menu').classList.add('hidden');
  startMusic();
}

function goToMenu() {
  GS = 'menu'; stopMusic();
  ['mode-menu','pause-menu','gameover','online-menu','join-menu',
   'waiting-menu','guest-waiting','hud','mobile-overlay'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  document.getElementById('main-menu').classList.remove('hidden');
  document.getElementById('wrapper').style.transform = '';
  document.body.classList.remove('portrait','landscape');
  if (typeof onlineCleanup === 'function') onlineCleanup();
}

/** Volumen desde menú de pausa (slider secundario) */
function setPauseVolume(v) {
  globalVol = v / 100;
  document.getElementById('pause-vol-val').textContent = v;
  // Sincronizar con slider del menú de config si existe
  const cfgSlider = document.getElementById('vol-slider');
  if (cfgSlider) cfgSlider.value = v;
  const cfgVal = document.getElementById('vol-val');
  if (cfgVal) cfgVal.textContent = v;
}

function setVolume(v) {
  globalVol = v / 100;
  document.getElementById('vol-val').textContent = v;
  // Sincronizar con slider de pausa
  const pauseSlider = document.getElementById('pause-vol-slider');
  if (pauseSlider) pauseSlider.value = v;
  const pauseVal = document.getElementById('pause-vol-val');
  if (pauseVal) pauseVal.textContent = v;
}

// ─────────────────────────────────────────────────────────────
//  LAYOUT MÓVIL ADAPTATIVO
// ─────────────────────────────────────────────────────────────


function getOrientation() {
  if (screen.orientation) {
    return screen.orientation.type.startsWith('portrait') ? 'portrait' : 'landscape';
  }
  return window.innerWidth < window.innerHeight ? 'portrait' : 'landscape';
}

function applyMobileLayout() {
  const orientation = getOrientation();
  document.body.classList.toggle('portrait',  orientation === 'portrait');
  document.body.classList.toggle('landscape', orientation === 'landscape');

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wrapper = document.getElementById('wrapper');
  const overlay = document.getElementById('mobile-overlay');

  // Tamaño lógico del wrapper (canvas 720×624 + HUD 52px = 720×676)
  const CANVAS_W = 720, CANVAS_H = 676;

  let scale, wrapperLeft, wrapperTop;

  if (orientation === 'portrait') {
    // ── PAD zone: 36% de la altura de la pantalla (mínimo 180px, máximo 260px)
    const padH = Math.min(Math.max(vh * 0.36, 180), 260);
    const available = vh - padH;          // espacio para el canvas

    scale      = Math.min(vw / CANVAS_W, available / CANVAS_H);
    wrapperLeft = (vw  - CANVAS_W * scale) / 2;
    wrapperTop  = 0;

    // Comunicar la altura de la zona de pads al CSS
    document.documentElement.style.setProperty('--pad-zone-h', padH + 'px');
    // En portrait los dos pads están en la misma fila, centrada
    overlay.style.cssText = '';   // limpiar estilos inline del modo anterior

  } else {
    // ── PAD zone: 36% del ancho de la pantalla (mínimo 180px, máximo 260px)
    const padW = Math.min(Math.max(vw * 0.36, 180), 260);
    const available = vw - padW;          // espacio para el canvas

    scale       = Math.min(available / CANVAS_W, vh / CANVAS_H);
    wrapperLeft = 0;
    wrapperTop  = (vh - CANVAS_H * scale) / 2;

    document.documentElement.style.setProperty('--pad-zone-w', padW + 'px');
    overlay.style.cssText = '';
  }

  // Clamp escala — nunca mayor que 1 (no escalar hacia arriba en pantallas grandes)
  scale = Math.min(scale, 1);

  wrapper.style.transform       = `scale(${scale})`;
  wrapper.style.transformOrigin = 'top left';
  wrapper.style.position        = 'absolute';
  wrapper.style.left            = wrapperLeft + 'px';
  wrapper.style.top             = wrapperTop  + 'px';
}

// Escuchar cambios de orientación y resize
function onOrientationChange() {
  if (platformMode === 'mobile') applyMobileLayout();
}

window.addEventListener('resize',              onOrientationChange);
window.addEventListener('orientationchange',   onOrientationChange);
if (screen.orientation) {
  screen.orientation.addEventListener('change', onOrientationChange);
}

// ─────────────────────────────────────────────────────────────
//  ARRANQUE
// ─────────────────────────────────────────────────────────────
initTouchControls();
drawTitleScreen();
requestAnimationFrame(loop);
