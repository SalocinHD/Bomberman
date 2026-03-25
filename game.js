//Para ignacio: te e puesto muchisimos comentarios pa q no te quejes
// ── Constantes del grid ──
const CELL = 48;
const COLS = 15;
const ROWS = 13;
const CW   = COLS * CELL;   // 720 px
const CH   = ROWS * CELL;   // 624 px

//Canvas
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

//IDs de tipo de celda
const T = { FLOOR: 0, WALL: 1, BREAK: 2 };

let GS               = 'menu';   // menu | playing | paused | gameover
let globalVol        = 0.7;
let blockDensity     = 0.7;
let powerupDropChance = 0.30;
let gameTime         = 180;

let map        = [];
let powerups   = [];   // { col, row, type, t }
let bombs      = [];   // objetos Bomb
let explosions = [];   // objetos Explosion
let players    = [];

let AC = null;

function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
}

function setVolume(v) {
  globalVol = v / 100;
  document.getElementById('vol-val').textContent = v;
}

/**Reproduce un efecto de sonido procedural.
 * @param {'explosion'|'place'|'death'|'powerup'|'win'} type
 */
function sfx(type) {
  if (!AC) return;
  const now = AC.currentTime;
  const mg  = AC.createGain();
  mg.gain.value = globalVol * 0.35;
  mg.connect(AC.destination);

  //Explosión: ruido blanco con envolvente de decaimiento
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

  //Resto de efectos con oscilador
  const o = AC.createOscillator();
  o.connect(mg);

  switch (type) {
    case 'place':
      o.type = 'square';
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(90, now + 0.12);
      mg.gain.setValueAtTime(globalVol * 0.18, now);
      mg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      o.start(now); o.stop(now + 0.12);
      break;

    case 'death':
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(500, now);
      o.frequency.exponentialRampToValueAtTime(50, now + 0.9);
      mg.gain.setValueAtTime(globalVol * 0.3, now);
      mg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      o.start(now); o.stop(now + 0.9);
      break;

    case 'powerup':
      o.type = 'square';
      [523, 659, 784, 1047].forEach((f, i) => o.frequency.setValueAtTime(f, now + i * 0.08));
      mg.gain.setValueAtTime(globalVol * 0.15, now);
      mg.gain.setValueAtTime(0.001, now + 0.35);
      o.start(now); o.stop(now + 0.38);
      break;

    case 'win':
      o.type = 'square';
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => o.frequency.setValueAtTime(f, now + i * 0.1));
      mg.gain.setValueAtTime(globalVol * 0.2, now);
      mg.gain.setValueAtTime(0.001, now + 0.8);
      o.start(now); o.stop(now + 0.82);
      break;
  }
}

// Música en bucle
const TUNE = [
 
  [659,150],[659,150],[659,150],[659,75],[588,75],[659,150],[784,150],
  [659,150],[659,150],[659,150],[659,75],[588,75],[659,150],[880,150],
  [784,150],[784,150],[784,75],[659,75],[784,150],[880,150],[988,300],

  
  [880,150],[880,150],[880,150],[880,75],[784,75],[880,150],[988,150],
  [1047,150],[1047,150],[1047,150],[1047,75],[988,75],[1047,150],[1175,150],
  [1047,150],[988,150],[880,150],[784,150],[659,300],[659,150],

];

let musicPlaying = false;
let tuneIdx      = 0;
let musicTO      = null;

function startMusic() {
  if (!AC || musicPlaying) return;
  musicPlaying = true;
  tuneIdx      = 0;
  playTuneNote();
}

function playTuneNote() {
  if (!musicPlaying || !AC) return;
  const [freq, dur] = TUNE[tuneIdx % TUNE.length];
  tuneIdx++;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type           = 'square';
  o.frequency.value = freq;
  const now = AC.currentTime;
  g.gain.setValueAtTime(0.07 * globalVol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur / 1000 - 0.02);
  o.connect(g); g.connect(AC.destination);
  o.start(now); o.stop(now + dur / 1000);
  musicTO = setTimeout(playTuneNote, dur * 1);
}

function stopMusic() {
  musicPlaying = false;
  if (musicTO) clearTimeout(musicTO);
}

// GENERACIÓN DEL MAPA
function generateMap() {
  map = []; powerups = [];

  // Celdas seguras en las 4 esquinas de spawn (3 por jugador)
  const safe = new Set([
    '1,1','2,1','1,2',
    `${COLS-2},1`,`${COLS-3},1`,`${COLS-2},2`,
    `1,${ROWS-2}`,`2,${ROWS-2}`,`1,${ROWS-3}`,
    `${COLS-2},${ROWS-2}`,`${COLS-3},${ROWS-2}`,`${COLS-2},${ROWS-3}`,
  ]);

  for (let r = 0; r < ROWS; r++) {
    map[r] = [];
    for (let c = 0; c < COLS; c++) {
      // Bordes exteriores y pilares internos → paredes sólidas
      if (r === 0 || r === ROWS-1 || c === 0 || c === COLS-1) { map[r][c] = T.WALL; continue; }
      if (r % 2 === 0 && c % 2 === 0)                         { map[r][c] = T.WALL; continue; }
      // Zonas de spawn → suelo libre
      if (safe.has(`${c},${r}`))                               { map[r][c] = T.FLOOR; continue; }
      // Resto → bloque destructible según densidad configurada
      map[r][c] = Math.random() < blockDensity ? T.BREAK : T.FLOOR;
    }
  }
}


// INPUT

const held    = new Set();
const pressed = new Set();   // vaciado cada frame

window.addEventListener('keydown', e => {
  if (!held.has(e.code)) pressed.add(e.code);
  held.add(e.code);

  // Evitar scroll de página con las flechas/espacio
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }

  // ESC: pausa / reanudar
  if (e.code === 'Escape') {
    if (GS === 'playing') pauseGame();
    else if (GS === 'paused') resumeGame();
  }

  // Bomba en keydown para respuesta inmediata
  if (GS === 'playing') {
    for (const p of players) {
      if (e.code === p.keys.bomb) placeBomb(p);
    }
  }
});

window.addEventListener('keyup', e => {
  held.delete(e.code);
  pressed.delete(e.code);
});

//  EXPLOSIONES
function explodeBomb(bomb) {
  // Eliminar la bomba del array
  const bi = bombs.indexOf(bomb);
  if (bi !== -1) bombs.splice(bi, 1);

  const cells = [{ col: bomb.col, row: bomb.row, seg: 'center' }];
  const dirs  = [{ dc:0, dr:-1 }, { dc:0, dr:1 }, { dc:-1, dr:0 }, { dc:1, dr:0 }];

  for (const { dc, dr } of dirs) {
    for (let i = 1; i <= bomb.range; i++) {
      const nc = bomb.col + dc * i;
      const nr = bomb.row + dr * i;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
      if (map[nr][nc] === T.WALL) break;

      const isEnd = i === bomb.range;
      cells.push({ col: nc, row: nr, seg: isEnd ? 'end' : 'mid' });

      // El fuego se detiene en el primer bloque destructible y lo rompe
      if (map[nr][nc] === T.BREAK) {
        map[nr][nc] = T.FLOOR;
        // Probabilidad de soltar un power-up
        if (Math.random() < powerupDropChance) {
          const types = ['bomb', 'fire', 'speed'];
          powerups.push({
            col:  nc, row: nr,
            type: types[Math.floor(Math.random() * 3)],
            t:    0
          });
        }
        break;
      }
    }
  }

  explosions.push({ cells, timer: 0.65, t: 0 });
  sfx('explosion');
}

function updateBombs(dt) {
  // Reacción en cadena: explotar bombas dentro de otra explosión
  let again = true;
  while (again) {
    again = false;
    for (const bomb of [...bombs]) {
      const inFire = explosions.some(ex =>
        ex.cells.some(c => c.col === bomb.col && c.row === bomb.row)
      );
      if (inFire || bomb.timer <= 0) {
        explodeBomb(bomb);
        again = true;
        break;
      }
    }
  }

  for (const b of bombs) {
    b.timer -= dt;
    b.t     += dt;
    // Eliminar paso libre una vez el jugador abandona la celda de la bomba
    for (const p of players) {
      if (b.passSet.has(p.id) && (p.col !== b.col || p.row !== b.row)) {
        b.passSet.delete(p.id);
      }
    }
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].timer -= dt;
    explosions[i].t     += dt;
    if (explosions[i].timer <= 0) explosions.splice(i, 1);
  }
}

// ═══════════════════════════════════════════════════════════════
//  COLOCACIÓN DE BOMBAS
// ═══════════════════════════════════════════════════════════════
function placeBomb(player) {
  if (!player.alive || player.dying) return;
  // No superar el límite de bombas del jugador
  if (bombs.filter(b => b.owner === player.id).length >= player.maxBombs) return;
  // No colocar dos bombas en la misma celda
  if (bombs.some(b => b.col === player.col && b.row === player.row)) return;

  const ps = new Set();
  ps.add(player.id);   // paso libre inicial para el jugador que la pone

  bombs.push({
    col:     player.col,
    row:     player.row,
    timer:   3,
    range:   player.fireRange,
    owner:   player.id,
    passSet: ps,
    t:       0
  });

  sfx('place');
}

class Player {
  constructor(id, col, row, bodyColor, accentColor, keys) {
    this.id          = id;
    this.col         = col;
    this.row         = row;
    this.tCol        = col;         // celda destino
    this.tRow        = row;
    this.x           = col * CELL + CELL / 2;   // posición píxel actual
    this.y           = row * CELL + CELL / 2;
    this.bodyColor   = bodyColor;
    this.accentColor = accentColor;
    this.keys        = keys;

    // Stats
    this.lives     = 3;
    this.maxBombs  = 1;
    this.fireRange = 1;
    this.speedMult = 1;

    // Estados de vida
    this.alive      = true;
    this.dying      = false;
    this.dyingT     = 0;
    this.invincible = false;
    this.invincT    = 0;

    // Sistema de animación (spritesheet virtual)
    this.animState = 'idle';       // fila del spritesheet
    this.animFrame = 0;            // columna del spritesheet (0-3)
    this.animT     = 0;
    this.dir       = 'down';
    this.moving    = false;
  }

  /** Velocidad en píxeles/segundo según nivel de velocidad */
  get speed() { return (3.2 + this.speedMult * 0.8) * CELL; }

  /** Comprueba si la celda (c, r) es transitable */
  isFree(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (map[r][c] !== T.FLOOR) return false;
    for (const b of bombs) {
      if (b.col === c && b.row === r && !b.passSet.has(this.id)) return false;
    }
    return true;
  }

  update(dt) {
    if (!this.alive) return;

    // Invencibilidad tras reaparición
    if (this.invincible) {
      this.invincT -= dt;
      if (this.invincT <= 0) this.invincible = false;
    }

    // ── Animación de muerte (fila "dying" del spritesheet) ──
    if (this.dying) {
      this.dyingT    -= dt;
      this.animT     += dt;
      this.animState  = 'dying';
      this.animFrame  = Math.floor(this.animT * 8) % 8;

      if (this.dyingT <= 0) {
        this.dying = false;
        if (this.lives <= 0) { this.alive = false; return; }
        // Reaparición en esquina inicial
        const [sc, sr] = this.id === 1 ? [1, 1] : [COLS-2, ROWS-2];
        this.col = this.tCol = sc;
        this.row = this.tRow = sr;
        this.x   = sc * CELL + CELL / 2;
        this.y   = sr * CELL + CELL / 2;
        this.invincible = true;
        this.invincT    = 2.5;
      }
      return;
    }

    // ── Movimiento suave hacia la celda destino ──
    const tx   = this.tCol * CELL + CELL / 2;
    const ty   = this.tRow * CELL + CELL / 2;
    const dx   = tx - this.x;
    const dy   = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt;

    if (dist <= step || dist < 0.5) {
      this.x    = tx; this.y    = ty;
      this.col  = this.tCol; this.row  = this.tRow;
      this.moving = false;
      this._readInput();
    } else {
      this.x += dx / dist * step;
      this.y += dy / dist * step;
      this.moving = true;
    }

    // ── Avance de frame de animación (simula columna en spritesheet) ──
    this.animT += dt;
    const fps = this.moving ? 9 : 1.5;
    if (this.animT > 1 / fps) {
      this.animT   = 0;
      this.animFrame = (this.animFrame + 1) % 4;
    }

    // Selección de fila del spritesheet según dirección y movimiento
    this.animState = this.moving ? 'walk' + this.dir : 'idle';

    // ── Recoger power-ups ──
    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      if (pu.col === this.col && pu.row === this.row) {
        switch (pu.type) {
          case 'bomb':  this.maxBombs  = Math.min(this.maxBombs  + 1, 5); break;
          case 'fire':  this.fireRange = Math.min(this.fireRange + 1, 6); break;
          case 'speed': this.speedMult = Math.min(this.speedMult + 1, 4); break;
        }
        powerups.splice(i, 1);
        sfx('powerup');
        updateHUD();
      }
    }

    // ── Daño por explosión ──
    if (!this.invincible) {
      for (const ex of explosions) {
        if (ex.cells.some(c => c.col === this.col && c.row === this.row)) {
          this._die();
          break;
        }
      }
    }
  }

  /** Lee el input del teclado y mueve al jugador a la celda adyacente libre */
  _readInput() {
    let dc = 0, dr = 0, dir = this.dir;

    if      (held.has(this.keys.up))    { dr = -1; dir = 'up';    }
    else if (held.has(this.keys.down))  { dr =  1; dir = 'down';  }
    else if (held.has(this.keys.left))  { dc = -1; dir = 'left';  }
    else if (held.has(this.keys.right)) { dc =  1; dir = 'right'; }

    if (dc || dr) {
      const nc = this.col + dc, nr = this.row + dr;
      if (this.isFree(nc, nr)) { this.tCol = nc; this.tRow = nr; }
      this.dir = dir;   // girar aunque esté bloqueado
    }
  }

  /** Descuenta una vida y activa animación de muerte */
  _die() {
    if (this.dying) return;
    this.lives--;
    this.dying  = true;
    this.dyingT = 1.2;
    this.animT  = 0;
    sfx('death');
    updateHUD();
   
    if (this.lives == 0) checkWin(true);
      else checkWin();
  }

  draw() {
    if (!this.alive) return;
    // Parpadeo durante invencibilidad
    if (this.invincible && Math.floor(Date.now() / 80) % 2 === 0) return;

    const cx = this.x, cy = this.y;
    const f  = this.animFrame;
    ctx.save();

    // ── Transformación de muerte (giro + encogimiento) ──
    if (this.dying) {
      const prog = (1.2 - this.dyingT) / 1.2;
      ctx.translate(cx, cy);
      ctx.rotate(prog * Math.PI * 6);
      ctx.scale(1 - prog * .9, 1 - prog * .9);
      ctx.translate(-cx, -cy);
    }

    // Sombra en el suelo
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Datos de frame de piernas (simula columnas del spritesheet) ──
    // Cada frame desplaza verticalmente las piernas de forma diferente
    const legFrames = [[0,6],[4,2],[6,0],[2,4]];
    const [lOff, rOff] = legFrames[f % 4];

    // Bob vertical para idle (fila "idle" del spritesheet)
    const bob  = this.animState === 'idle' ? Math.sin(Date.now() / 350) * 2 : 0;
    // Inclinación lateral al caminar izq/der (fila "walkLeft/walkRight")
    const lean = this.animState === 'walkleft' ? -2 : this.animState === 'walkright' ? 2 : 0;

    // Piernas (varían por frame — columna del spritesheet)
    ctx.fillStyle = this.bodyColor;
    ctx.fillRect(cx - 11 + lean, cy +  9 + bob, 8, 12 + lOff);
    ctx.fillRect(cx +  3 + lean, cy +  9 + bob, 8, 12 + rOff);

    // Cuerpo
    ctx.fillStyle = this.bodyColor;
    ctx.beginPath();
    ctx.roundRect(cx - 13 + lean, cy - 12 + bob, 26, 24, 5);
    ctx.fill();

    // Franja de acento (cinturón)
    ctx.fillStyle = this.accentColor;
    ctx.fillRect(cx - 13 + lean, cy - 2 + bob, 26, 5);

    // Insignia con número de jugador
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.arc(cx + lean, cy - 4 + bob, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P' + this.id, cx + lean, cy - 4 + bob);

    // Cabeza
    ctx.fillStyle = '#f5c48a';
    ctx.beginPath();
    ctx.arc(cx + lean, cy - 20 + bob, 12, 0, Math.PI * 2);
    ctx.fill();

    // Ojos — varían según dirección (fila del spritesheet)
    ctx.fillStyle = '#222';
    if (this.dir === 'down') {
      ctx.beginPath(); ctx.arc(cx - 4 + lean, cy - 18 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 4 + lean, cy - 18 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx - 3 + lean, cy - 19 + bob, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5 + lean, cy - 19 + bob, 1, 0, Math.PI * 2); ctx.fill();
    } else if (this.dir === 'up') {
      ctx.beginPath(); ctx.arc(cx - 4 + lean, cy - 22 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 4 + lean, cy - 22 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (this.dir === 'right') {
      ctx.beginPath(); ctx.arc(cx + 6 + lean, cy - 19 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx + 7 + lean, cy - 20 + bob, 1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(cx - 6 + lean, cy - 19 + bob, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx - 7 + lean, cy - 20 + bob, 1, 0, Math.PI * 2); ctx.fill();
    }

    // Casco
    ctx.fillStyle = this.accentColor;
    ctx.beginPath();
    ctx.ellipse(cx + lean, cy - 30 + bob, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Brillo del casco
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.ellipse(cx - 3 + lean, cy - 32 + bob, 4, 2, -0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN DE JUGADORES
// ═══════════════════════════════════════════════════════════════
function initPlayers() {
  players = [
    new Player(1, 1, 1, '#3399ff', '#1155cc', {
      up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', bomb: 'Space'
    }),
    new Player(2, COLS-2, ROWS-2, '#ff4444', '#aa1111', {
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: 'Enter'
    }),
  ];
}

// ═══════════════════════════════════════════════════════════════
//  CONDICIÓN DE VICTORIA
// ═══════════════════════════════════════════════════════════════
function checkWin(timeUp = false) {
  const p1 = players[0], p2 = players[1];

  if (timeUp) {
    if      (p1.lives > p2.lives) endGame(1);
    else if (p2.lives > p1.lives) endGame(2);
    else                          endGame(0);
    return;
  }

  if (!p1.alive && !p2.alive) endGame(0);
  else if (!p1.alive)         endGame(2);
  else if (!p2.alive)         endGame(1);
}

function endGame(w) {
  if (GS === 'gameover') return;
  GS = 'gameover';
  stopMusic();
  if (w > 0) sfx('win');

  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameover').classList.remove('hidden');

  const wt = document.getElementById('winner-text');
  if      (w === 0) { wt.className = 'winner-text w-draw'; wt.textContent = '💥 ¡EMPATE! 💥'; }
  else if (w === 1) { wt.className = 'winner-text w-p1';   wt.textContent = '🟦 ¡JUGADOR 1 GANA!'; }
  else              { wt.className = 'winner-text w-p2';   wt.textContent = '¡JUGADOR 2 GANA! 🟥'; }
}

// ═══════════════════════════════════════════════════════════════
//  ACTUALIZACIÓN DEL HUD
// ═══════════════════════════════════════════════════════════════
function updateHUD() {
  if (!players[0]) return;
  const p1 = players[0], p2 = players[1];
  const hearts = n => '❤'.repeat(Math.max(0, n));

  document.getElementById('p1-lives').textContent = hearts(p1.lives);
  document.getElementById('p1-stats').textContent = `💣×${p1.maxBombs}  🔥×${p1.fireRange}  ⚡×${p1.speedMult}`;
  document.getElementById('p2-lives').textContent = hearts(p2.lives);
  document.getElementById('p2-stats').textContent = `💣×${p2.maxBombs}  🔥×${p2.fireRange}  ⚡×${p2.speedMult}`;
}

function updateTimerHUD() {
  const m  = Math.floor(gameTime / 60);
  const s  = Math.floor(gameTime % 60);
  const el = document.getElementById('game-timer');
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  el.style.color = gameTime <= 30
    ? (Math.floor(gameTime * 2) % 2 === 0 ? '#ff2222' : '#ffcc00')
    : '#ffcc00';
}

// ═══════════════════════════════════════════════════════════════
//  RENDERIZADO DEL MAPA
// ═══════════════════════════════════════════════════════════════

function drawFloor(x, y, c, r) {
  ctx.fillStyle = (c + r) % 2 === 0 ? '#3a6e22' : '#336020';
  ctx.fillRect(x, y, CELL, CELL);
  ctx.strokeStyle = 'rgba(0,0,0,.12)';
  ctx.lineWidth   = .5;
  ctx.strokeRect(x, y, CELL, CELL);
}

function drawWall(x, y) {
  ctx.fillStyle = '#777'; ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = '#999';
  ctx.fillRect(x, y, CELL, 5);
  ctx.fillRect(x, y, 4, CELL);
  ctx.fillStyle = '#444';
  ctx.fillRect(x, y + CELL - 4, CELL, 4);
  ctx.fillRect(x + CELL - 4, y, 4, CELL);
  // Líneas de sillería
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y+16);  ctx.lineTo(x+CELL, y+16);
  ctx.moveTo(x, y+32);  ctx.lineTo(x+CELL, y+32);
  ctx.moveTo(x+24, y);  ctx.lineTo(x+24, y+16);
  ctx.moveTo(x+12, y+16); ctx.lineTo(x+12, y+32);
  ctx.moveTo(x+36, y+16); ctx.lineTo(x+36, y+32);
  ctx.moveTo(x+24, y+32); ctx.lineTo(x+24, y+CELL);
  ctx.stroke();
}

function drawBreak(x, y) {
  ctx.fillStyle = '#b87340'; ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = '#d08850';
  ctx.fillRect(x, y, CELL, 5);
  ctx.fillRect(x, y, 4, CELL);
  ctx.fillStyle = '#7a4a20';
  ctx.fillRect(x, y + CELL - 4, CELL, 4);
  ctx.fillRect(x + CELL - 4, y, 4, CELL);
  // Cruz decorativa
  ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x+6, y+6);      ctx.lineTo(x+CELL-6, y+CELL-6);
  ctx.moveTo(x+CELL-6, y+6); ctx.lineTo(x+6, y+CELL-6);
  ctx.strokeRect(x+6, y+6, CELL-12, CELL-12);
  ctx.stroke();
}

function drawMap() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL, y = r * CELL;
      if      (map[r][c] === T.FLOOR) drawFloor(x, y, c, r);
      else if (map[r][c] === T.WALL)  drawWall(x, y);
      else                             drawBreak(x, y);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDERIZADO DE POWER-UPS
// ═══════════════════════════════════════════════════════════════
function drawPowerups() {
  for (const pu of powerups) {
    pu.t += 0.016;
    const x     = pu.col * CELL + CELL / 2;
    const y     = pu.row * CELL + CELL / 2;
    const bob   = Math.sin(pu.t * 3.5) * 3;
    const pulse = .92 + Math.sin(pu.t * 5) * .08;
    const colors = { bomb: '#ff4400', fire: '#ff8800', speed: '#00ccff' };

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = colors[pu.type]; ctx.shadowBlur = 14;
    ctx.fillStyle   = colors[pu.type];
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pu.type === 'bomb' ? '💣' : pu.type === 'fire' ? '🔥' : '⚡', 0, 1);
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDERIZADO DE BOMBAS
// ═══════════════════════════════════════════════════════════════
function drawBombs() {
  for (const b of bombs) {
    const x       = b.col * CELL + CELL / 2;
    const y       = b.row * CELL + CELL / 2;
    const urgency = Math.max(0, (3 - b.timer) / 3);
    const pulse   = 1 + Math.sin(b.t * Math.PI * 2 * (1 + urgency * 4)) * (0.05 + urgency * .12);

    ctx.save();
    ctx.translate(x, y); ctx.scale(pulse, pulse);

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(2, 14, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

    // Cuerpo (parpadea en rojo cuando está a punto de explotar)
    ctx.fillStyle = urgency > .75
      ? `hsl(${Math.floor(Date.now() / 80) % 2 * 20},100%,40%)`
      : '#111';
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();

    // Brillo
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.ellipse(-4, -6, 5, 3, -Math.PI/4, 0, Math.PI * 2); ctx.fill();

    // Mecha
    ctx.strokeStyle = '#8B4513'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(5, -13); ctx.quadraticCurveTo(14, -20, 10, -28); ctx.stroke();

    // Chispa
    ctx.fillStyle  = urgency > .5 ? '#ff4400' : '#ffcc00';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(9 + (Math.random() - .5) * 3, -28 + (Math.random() - .5) * 3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDERIZADO DE EXPLOSIONES
// ═══════════════════════════════════════════════════════════════
function drawExplosions() {
  for (const ex of explosions) {
    const alpha = ex.timer < 0.2 ? ex.timer / 0.2 : 1;

    for (const cell of ex.cells) {
      const x = cell.col * CELL, y = cell.row * CELL;
      const g = ctx.createRadialGradient(x + CELL/2, y + CELL/2, 0, x + CELL/2, y + CELL/2, CELL * .7);

      if (cell.seg === 'center') {
        g.addColorStop(0,   `rgba(255,255,255,${alpha})`);
        g.addColorStop(.35, `rgba(255,220,0,${alpha})`);
        g.addColorStop(1,   `rgba(255,80,0,${alpha*.8})`);
      } else if (cell.seg === 'mid') {
        g.addColorStop(0, `rgba(255,200,0,${alpha})`);
        g.addColorStop(1, `rgba(255,80,0,${alpha*.6})`);
      } else {
        g.addColorStop(0, `rgba(255,140,0,${alpha})`);
        g.addColorStop(1, `rgba(255,40,0,${alpha*.4})`);
      }

      ctx.fillStyle = g;
      ctx.fillRect(x, y, CELL, CELL);

      // Partículas de chispa en la fase inicial
      if (ex.t < 0.3 && Math.random() > .5) {
        ctx.fillStyle = `rgba(255,255,200,${alpha * .7})`;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(
            x + 8 + Math.random() * (CELL - 16),
            y + 8 + Math.random() * (CELL - 16),
            2 + Math.random() * 3, 0, Math.PI * 2
          );
          ctx.fill();
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  PANTALLA DE TÍTULO (canvas decorativo)
// ═══════════════════════════════════════════════════════════════
function drawTitleScreen() {
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, CW, CH);

  // Vista previa del grid de juego
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL, y = r * CELL;
      if (r===0||r===ROWS-1||c===0||c===COLS-1||(r%2===0&&c%2===0)) {
        ctx.fillStyle = '#1a1a28';
      } else {
        ctx.fillStyle = (c + r) % 2 === 0 ? '#0f1a08' : '#0d1706';
      }
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
  }

  // Bombas decorativas en las esquinas
  const deco = [{ x:120,y:180 },{ x:580,y:180 },{ x:100,y:440 },{ x:600,y:440 }];
  for (const d of deco) {
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(d.x, d.y, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8B4513'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(d.x + 7, d.y - 17);
    ctx.quadraticCurveTo(d.x + 18, d.y - 27, d.x + 13, d.y - 36);
    ctx.stroke();
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath(); ctx.arc(d.x + 13, d.y - 36, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// ═══════════════════════════════════════════════════════════════
//  BUCLE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
let lastT = 0;

function loop(ts) {
  const dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;

  if (GS === 'playing') {
    gameTime -= dt;
    if (gameTime <= 0) { gameTime = 0; checkWin(true); }

    for (const p of players) p.update(dt);
    updateBombs(dt);
    updateExplosions(dt);
    updateTimerHUD();

    ctx.clearRect(0, 0, CW, CH);
    drawMap();
    drawPowerups();
    drawBombs();
    drawExplosions();
    for (const p of players) p.draw();

    pressed.clear();
  } else if (GS === 'menu') {
    drawTitleScreen();
  }

  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════════
//  ACCIONES DE MENÚ  (llamadas desde el HTML vía onclick)
// ═══════════════════════════════════════════════════════════════

/** Inicia o reinicia una partida */
function startGame() {
  initAudio();
  GS = 'playing'; gameTime = 180;
  bombs = []; explosions = []; powerups = [];
  generateMap(); initPlayers(); updateHUD();

  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  stopMusic(); tuneIdx = 0; startMusic();
}

/** Pausa la partida */
function pauseGame() {
  if (GS !== 'playing') return;
  GS = 'paused';
  document.getElementById('pause-menu').classList.remove('hidden');
  stopMusic();
}

/** Reanuda la partida desde pausa */
function resumeGame() {
  if (GS !== 'paused') return;
  GS = 'playing';
  document.getElementById('pause-menu').classList.add('hidden');
  startMusic();
}

/** Vuelve al menú principal */
function goToMenu() {
  GS = 'menu'; stopMusic();
  document.getElementById('main-menu').classList.remove('hidden');
  document.getElementById('mode-menu').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('online-menu').classList.add('hidden');
  document.getElementById('join-menu').classList.add('hidden');
  document.getElementById('waiting-menu').classList.add('hidden');
}

/** Cambia la densidad de bloques destructibles */
function setDiff(d, btn) {
  blockDensity = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/** Cambia la probabilidad de soltar power-ups */
function setPowerupChance(c, btn) {
  powerupDropChance = c;
  document.querySelectorAll('.powerup-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── Arranque ──
drawTitleScreen();
requestAnimationFrame(loop);
