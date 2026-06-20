'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const WORLD_W = 7000;          // largura do mundo (px)
const SPAWN_X = WORLD_W / 2;
const DAY_LEN = 70;            // s de dia
const CYCLE = 105;            // ciclo dia+noite

function terrainY(x) {        // superfície da água (calma, sem movimento)
  return H * 0.85;
}
const waterLevel = () => H * 0.85;

const DECK_INSET = 22;        // ajuste do deck sobre a sprite
const floorY = () => waterLevel() - PLAT_VIS + DECK_INSET;
const onPlatform = (x) => Math.abs(x - SPAWN_X) <= PLAT_W;
const groundY = (x) => onPlatform(x) ? floorY() : waterLevel();   // deck ou água

const TYPES = {
  muralha: { nome: 'Muralha', custo: 4,  w: 26, h: 58, tempo: 4, hp: 80 },
  tenda:   { nome: 'Tenda',   custo: 6,  w: 48, h: 44, tempo: 5, hp: 40 },
  fazenda: { nome: 'Fazenda', custo: 8,  w: 80, h: 40, tempo: 6, hp: 40 },
  torre:   { nome: 'Torre',   custo: 12, w: 34, h: 86, tempo: 8, hp: 60 },
};
const ORDER = ['muralha', 'tenda', 'fazenda', 'torre'];

// níveis por tipo; índice 0 = base, custoUp = preço pra subir
const LEVELS = {
  muralha: [
    { hp: 80 },
    { custoUp: 6,  hp: 180, h: 76 },
  ],
  tenda:   [{ hp: 40 }],
  fazenda: [{ hp: 40 }],
  torre:   [
    { hp: 60,  range: 300, fireRate: 1.4 },
    { custoUp: 10, hp: 120, h: 104, range: 410, fireRate: 0.9 },
  ],
};
const REFUND = 0.7;           // reembolso ao demolir

function maxLevel(key) { return LEVELS[key].length; }
function structH(s) { return s.dispH || s.t.h; }

function applyLevel(s) {
  const d = LEVELS[s.key][s.level - 1];
  s.hpMax = d.hp;
  s.dispH = d.h || TYPES[s.key].h;
  s.range = d.range || 0;
  s.fireRate = d.fireRate || 0;
}

function upgradeCost(s) {
  if (s.level >= maxLevel(s.key)) return null;
  return LEVELS[s.key][s.level].custoUp;
}

const state = {
  coins: 25,
  day: 1,
  time: 0,
  paused: false,
  timeFrozen: false,
  player: { x: SPAWN_X + 60, y: 0, vx: 0, vy: 0, dir: 1 },
  structures: [],
  villagers: [],
  enemies: [],
  arrows: [],
  pickups: [],
  particles: [],
  build: { active: false, sel: 0 },
  msg: { text: '', t: 0 },
  helpOn: false,
};

// sprite do píer ~48% transparente no topo;
const PLAT_TOP_FRAC = 0.479, PLAT_BOT_FRAC = 0.999;
const PLAT_VIS = 120;         // altura visível do píer
const PLAT_H = PLAT_VIS / (PLAT_BOT_FRAC - PLAT_TOP_FRAC);
const PLAT_W = PLAT_H * (1561 / 1389);
const platforms = [
  { x: SPAWN_X - PLAT_W / 2, img: 'plat1' },
  { x: SPAWN_X + PLAT_W / 2, img: 'plat2' },
];

const house = { x: SPAWN_X };

state.player.y = floorY();

const aldeaoImg = new Image();
aldeaoImg.src = 'aldeao.png';
const playerImg = new Image();
playerImg.src = 'player.png';
const plat1Img = new Image();
plat1Img.src = 'plataforma1.png';
const plat2Img = new Image();
plat2Img.src = 'plataforma2.png';
const houseImg = new Image();
houseImg.src = 'casa-de-barco.png';
const boatImg = new Image();
boatImg.src = 'barco.png';
const wakeImgs = [1, 2, 3, 4].map(n => { const i = new Image(); i.src = `barco-anim/${n}.png`; return i; });
const enemyImgs = [1, 2, 3, 4, 5, 6, 7].map(n => { const i = new Image(); i.src = `enemy-anim/IMG_2437_${n}.png`; return i; });
const torchImg = new Image();
torchImg.src = 'firetorch/torch.png';
const fireImg = new Image();
fireImg.src = 'firetorch/fire.png';
let camX = 0;
let animT = 0;
let boatIdle = 0;     // 0 = movendo, 1 = parado (suavizado)
let spawnTimer = 3;
let hotbarRects = [];
let manageRects = [];
let uiRects = [];
let hoveredStruct = null;

state.villagers.push(newVillager(SPAWN_X - 40, null));
state.villagers.push(newVillager(SPAWN_X + 30, null));

for (let i = 0; i < 12; i++) {
  const side = i % 2 ? 1 : -1;
  const x = SPAWN_X + side * (260 + hash(i + 3) * 2300);
  state.pickups.push({ x, y: 0, vy: 0, grounded: true });
}

const TREES = [];
for (let i = 0; i < 26; i++) {
  const x = 150 + hash(i * 3 + 1) * (WORLD_W - 300);
  if (Math.abs(x - SPAWN_X) < 220) continue;
  TREES.push({ x, s: 0.7 + hash(i * 7 + 2) * 0.6, v: hash(i * 13 + 3) });
}

function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(a, b, t) {
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

function nightFactor() {
  const t = state.time;
  if (t < DAY_LEN - 4) return 0;
  if (t < DAY_LEN + 2) return (t - (DAY_LEN - 4)) / 6;
  if (t < CYCLE - 6) return 1;
  return (CYCLE - t) / 6;
}
function showMsg(text) { state.msg.text = text; state.msg.t = 2.4; }

function toggleDayNight() {
  state.time = nightFactor() > 0.5 ? 10 : DAY_LEN + 8;
}

function newVillager(x, home) {
  return { x, dir: 1, st: 'idle', tgt: null, goal: x, wt: 0, home, swing: 0, walk: 0 };
}

const keys = {};
const mouse = { x: 0, y: 0 };

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  const k = e.key.toLowerCase();
  if (k === 'b') showMsg('desabilitado pra fudidos nao jogarem, vai terminar os desenhos');
  if (k === 'escape') state.build.active = false;
  if (k === 'h') state.helpOn = !state.helpOn;
  if (k === 'p') state.paused = !state.paused;

  if (k === 'u' && !state.build.active && hoveredStruct) tryUpgrade(hoveredStruct);
  if (k === 'x' && !state.build.active && hoveredStruct) demolish(hoveredStruct);
  // const d = ORDER.findIndex((_, i) => k === String(i + 1));
  // if (d >= 0) { state.build.sel = d; if (!state.build.active) state.build.active = true; }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  for (const r of uiRects) {
    if (mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) {
      r.action();
      return;
    }
  }
  if (state.build.active) {

    for (let i = 0; i < hotbarRects.length; i++) {
      const r = hotbarRects[i];
      if (mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) {
        state.build.sel = i;
        return;
      }
    }
    tryPlace();
  } else {

    for (const r of manageRects) {
      if (mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) {
        r.action();
        return;
      }
    }
  }
});
canvas.addEventListener('contextmenu', e => { e.preventDefault(); state.build.active = false; });
canvas.addEventListener('wheel', e => {
  if (!state.build.active) return;
  state.build.sel = (state.build.sel + (e.deltaY > 0 ? 1 : ORDER.length - 1)) % ORDER.length;
});

function validatePlacement(wx, key) {
  const t = TYPES[key];
  if (state.coins < t.custo) return { ok: false, reason: 'Moedas insuficientes' };
  if (wx - t.w / 2 < 40 || wx + t.w / 2 > WORLD_W - 40) return { ok: false, reason: 'Fora do mundo' };
  const yl = terrainY(wx - t.w / 2), yr = terrainY(wx + t.w / 2), ym = terrainY(wx);
  if (Math.max(yl, yr, ym) - Math.min(yl, yr, ym) > 16) return { ok: false, reason: 'Terreno muito íngreme' };
  for (const s of state.structures) {
    if (Math.abs(s.x - wx) < (s.t.w + t.w) / 2 + 8) return { ok: false, reason: 'Muito perto de outra estrutura' };
  }
  if (Math.abs(wx - SPAWN_X) < 60) return { ok: false, reason: 'Muito perto da fogueira' };
  return { ok: true };
}

function tryPlace() {
  const key = ORDER[state.build.sel];
  const wx = mouse.x + camX;
  const v = validatePlacement(wx, key);
  if (!v.ok) { showMsg(v.reason); return; }
  const t = TYPES[key];
  state.coins -= t.custo;
  const s = {
    key, t, x: wx, level: 1, invested: t.custo,
    hp: t.hp, hpMax: t.hp, dispH: t.h, range: 0, fireRate: 0,
    progress: 0, built: false, workers: 0, ct: 0, cd: 0, dead: false,
  };
  applyLevel(s);
  state.structures.push(s);
  for (let i = 0; i < 10; i++) spawnParticle(wx, terrainY(wx) - 6, '#c9b08a');
  showMsg(`${t.nome} encomendada — aldeões a caminho!`);
}

function completeStructure(s) {
  s.built = true;
  for (let i = 0; i < 14; i++) spawnParticle(s.x, terrainY(s.x) - s.t.h / 2, '#ffe9a8');
  if (s.key === 'tenda') {
    state.villagers.push(newVillager(s.x, s));
    showMsg('Um aldeão se juntou ao reino!');
  } else {
    showMsg(`${s.t.nome} concluída!`);
  }
}

function destroyStructure(s) {
  s.dead = true;
  for (let i = 0; i < 16; i++) spawnParticle(s.x, terrainY(s.x) - structH(s) / 2, '#8d8896');
  showMsg(`${s.t.nome} foi destruída!`);
}

function tryUpgrade(s) {
  if (!s || s.dead) return;
  if (!s.built) { showMsg('Espere a obra terminar'); return; }
  const cost = upgradeCost(s);
  if (cost == null) { showMsg('Já está no nível máximo'); return; }
  if (state.coins < cost) { showMsg('Moedas insuficientes'); return; }
  state.coins -= cost;
  s.invested += cost;
  s.level++;
  applyLevel(s);
  s.hp = s.hpMax;
  showMsg(`${s.t.nome} melhorada → nível ${s.level}!`);
  for (let i = 0; i < 18; i++) spawnParticle(s.x, terrainY(s.x) - structH(s) / 2, '#ffe9a8');
}

function demolish(s) {
  if (!s || s.dead) return;
  const refund = Math.round(s.invested * REFUND);
  state.coins += refund;
  s.dead = true;
  showMsg(`${s.t.nome} demolida — reembolso de ${refund} moeda${refund !== 1 ? 's' : ''} (70%)`);
  for (let i = 0; i < 14; i++) spawnParticle(s.x, terrainY(s.x) - structH(s) / 2, '#ffd23e');
}

function update(dt) {
  animT += dt;
  const idleTarget = Math.abs(state.player.vx) > 12 ? 0 : 1;
  boatIdle = lerp(boatIdle, idleTarget, 1 - Math.pow(0.001, dt));
  if (!state.timeFrozen) {
    state.time += dt;
    if (state.time >= CYCLE) {
      state.time -= CYCLE;
      state.day++;
      showMsg(`Dia ${state.day}`);
    }
  }
  if (state.msg.t > 0) state.msg.t -= dt;

  updatePlayer(dt);
  updateStructures(dt);
  updateVillagers(dt);
  updateEnemies(dt);
  updateArrows(dt);
  updatePickups(dt);
  updateParticles(dt);

  state.structures = state.structures.filter(s => !s.dead);
  state.enemies = state.enemies.filter(e => !e.dead);
  state.arrows = state.arrows.filter(a => !a.dead);
  state.pickups = state.pickups.filter(p => !p.dead);
  state.particles = state.particles.filter(p => p.life > 0);

  camX = clamp(state.player.x - W / 2, 0, Math.max(0, WORLD_W - W));
}

function updatePlayer(dt) {
  const p = state.player;
  const fast = keys['shift'];
  const speed = fast ? 290 : 175;
  let mv = 0;
  if (keys['a'] || keys['arrowleft']) mv -= 1;
  if (keys['d'] || keys['arrowright']) mv += 1;
  p.vx = lerp(p.vx, mv * speed, 1 - Math.pow(0.0015, dt));
  p.x = clamp(p.x + p.vx * dt, 30, WORLD_W - 30);
  if (mv !== 0) p.dir = mv;

  p.vy += 1400 * dt;           // gravidade: pousa no deck ou na água
  p.y += p.vy * dt;
  const gy = groundY(p.x);
  if (p.y >= gy) { p.y = gy; p.vy = 0; }
}

function updateStructures(dt) {
  const nf = nightFactor();
  for (const s of state.structures) {
    if (!s.built) continue;

    if (s.key === 'fazenda' && nf < 0.5) {
      s.ct += dt;
      if (s.ct > 11 && state.pickups.length < 40) {
        s.ct = 0;
        state.pickups.push({
          x: s.x + (Math.random() * 60 - 30),
          y: terrainY(s.x) - 30, vy: -90, grounded: false,
        });
      }
    }

    if (s.key === 'torre') {
      s.cd -= dt;
      if (s.cd <= 0) {
        let best = null, bd = s.range || 300;
        for (const e of state.enemies) {
          if (e.dead) continue;
          const d = Math.abs(e.x - s.x);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          s.cd = s.fireRate || 1.4;
          state.arrows.push({ x: s.x, y: terrainY(s.x) - structH(s) + 16, tgt: best, vx: 0, vy: 0, life: 3, dead: false });
        }
      }
    }
  }
}

function moveToward(o, x, speed, dt) {
  const d = x - o.x;
  if (Math.abs(d) < 3) return true;
  o.dir = d > 0 ? 1 : -1;
  o.x += o.dir * speed * dt;
  o.walk = (o.walk || 0) + dt * 9;
  return false;
}

function releaseTarget(v) {
  if (v.tgt) { v.tgt.workers = Math.max(0, v.tgt.workers - 1); v.tgt = null; }
}

function updateVillagers(dt) {
  const night = nightFactor() > 0.6;
  for (const v of state.villagers) {
    v.st = 'idle';
    if (night) {

      releaseTarget(v);
      const hx = (v.home && !v.home.dead) ? v.home.x : SPAWN_X;
      moveToward(v, hx + 10, 70, dt);
      continue;
    }
    if (v.tgt && (v.tgt.dead || v.tgt.built)) releaseTarget(v);
    if (!v.tgt) {

      let best = null, bd = 1e9;
      for (const s of state.structures) {
        if (s.built || s.dead || s.workers >= 2) continue;
        const d = Math.abs(s.x - v.x);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { best.workers++; v.tgt = best; }
    }
    if (v.tgt) {
      if (Math.abs(v.x - v.tgt.x) > v.tgt.t.w / 2 + 6) {
        moveToward(v, v.tgt.x, 78, dt);
      } else {
        v.st = 'build';
        v.swing += dt * 9;
        v.tgt.progress += dt;
        if (Math.random() < dt * 4) spawnParticle(v.tgt.x + (Math.random() - 0.5) * v.tgt.t.w, terrainY(v.tgt.x) - 10, '#d8c9a0');
        if (v.tgt.progress >= v.tgt.t.tempo) completeStructure(v.tgt);
      }
    } else {

      v.wt -= dt;
      if (v.wt <= 0) {
        v.wt = 2 + Math.random() * 3;
        const cx = (v.home && !v.home.dead) ? v.home.x : SPAWN_X;
        v.goal = cx + (Math.random() * 240 - 120);
      }
      if (Math.abs(v.x - v.goal) > 6) moveToward(v, v.goal, 42, dt);
    }
  }
}

function updateEnemies(dt) {
  const nf = nightFactor();
  if (nf > 0.9) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && state.enemies.length < 4 + state.day * 2) {
      spawnTimer = Math.max(2.5, 7 - state.day * 0.5);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = clamp(SPAWN_X + side * (1500 + Math.random() * 900), 60, WORLD_W - 60);
      state.enemies.push({ x, hp: 2, sp: 26 + Math.random() * 18, atkCd: 0, flee: false, bob: Math.random() * 6, dead: false });
    }
  } else if (nf <= 0.05) {
    for (const e of state.enemies) e.flee = true;
  }

  const p = state.player;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (e.flee) {
      const dir = e.x < SPAWN_X ? -1 : 1;
      e.dir = dir;
      e.x += dir * e.sp * 2.2 * dt;
      if (Math.abs(e.x - SPAWN_X) > 2700 || e.x < 40 || e.x > WORLD_W - 40) e.dead = true;
      continue;
    }

    let blocker = null;
    for (const s of state.structures) {
      if (s.dead) continue;
      if (Math.abs(s.x - e.x) < s.t.w / 2 + 12) { blocker = s; break; }
    }
    if (blocker) {
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = 1.2;
        blocker.hp -= 6;
        spawnParticle(blocker.x + (Math.random() - 0.5) * blocker.t.w, terrainY(blocker.x) - structH(blocker) * 0.4, '#aa9999');
        if (blocker.hp <= 0) destroyStructure(blocker);
      }
      continue;
    }

    if (Math.abs(e.x - p.x) < 16) {
      const roubo = Math.min(3, state.coins);
      state.coins -= roubo;
      e.flee = true;
      if (roubo > 0) {
        showMsg(`Um monstro roubou ${roubo} moeda${roubo > 1 ? 's' : ''}!`);
        for (let i = 0; i < roubo * 3; i++) spawnParticle(p.x, terrainY(p.x) - 30, '#ffd23e');
      }
      continue;
    }
    const dir = e.x < SPAWN_X ? 1 : -1;
    e.dir = dir;
    e.x += dir * e.sp * dt;
  }
}

function updateArrows(dt) {
  for (const a of state.arrows) {
    a.life -= dt;
    if (a.life <= 0) { a.dead = true; continue; }
    if (a.tgt && !a.tgt.dead) {
      const tx = a.tgt.x, ty = terrainY(a.tgt.x) - 10;
      const dx = tx - a.x, dy = ty - a.y;
      const d = Math.hypot(dx, dy) || 1;
      a.vx = (dx / d) * 330; a.vy = (dy / d) * 330;
      if (d < 12) {
        a.dead = true;
        a.tgt.hp--;
        spawnParticle(a.tgt.x, ty, '#cfd4ff');
        if (a.tgt.hp <= 0) {
          a.tgt.dead = true;
          state.pickups.push({ x: a.tgt.x, y: ty, vy: -120, grounded: false });
          for (let i = 0; i < 10; i++) spawnParticle(a.tgt.x, ty, '#6b4a8f');
        }
        continue;
      }
    }
    a.x += a.vx * dt; a.y += a.vy * dt;
  }
}

function updatePickups(dt) {
  const p = state.player;
  for (const c of state.pickups) {
    if (!c.grounded) {
      c.vy += 420 * dt;
      c.y += c.vy * dt;
      const gy = groundY(c.x) - 6;
      if (c.y >= gy) {
        c.y = gy;
        if (Math.abs(c.vy) > 50) c.vy = -c.vy * 0.45;
        else c.grounded = true;
      }
    }
    const cy = c.grounded ? groundY(c.x) - 6 : c.y;
    if (Math.abs(c.x - p.x) < 28 && Math.abs(cy - p.y) < 44) {
      c.dead = true;
      state.coins++;
      for (let i = 0; i < 4; i++) spawnParticle(c.x, cy - 6, '#ffd23e');
    }
  }
}

function spawnParticle(x, y, color) {
  state.particles.push({
    x, y,
    vx: (Math.random() - 0.5) * 90,
    vy: -40 - Math.random() * 80,
    life: 0.5 + Math.random() * 0.5,
    color, size: 1.5 + Math.random() * 2,
  });
}
function updateParticles(dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.vy += 260 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function draw() {
  const nf = nightFactor();
  drawSky(nf);
  drawRidge(0.15, H * 0.52, 70, 0.0016, 30, 0.005, lerpC([96, 116, 150], [16, 20, 50], nf));
  drawRidge(0.35, H * 0.62, 50, 0.0023, 22, 0.007, lerpC([70, 92, 122], [12, 15, 42], nf));
  drawGround(nf);
  drawCampfireBase();
  for (const s of state.structures) drawStructure(s);
  for (const c of state.pickups) drawCoin(c);
  for (const v of state.villagers) drawVillager(v);
  for (const e of state.enemies) drawEnemy(e);
  drawPlayer();
  drawBoat();   // barco na frente do player
  drawBoatWake();   // rastro por cima do barco
  for (const a of state.arrows) drawArrow(a);
  drawPlatforms();             // por cima de tudo
  drawTorches();
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life * 2, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  if (nf > 0.01) {
    ctx.fillStyle = `rgba(8,10,38,${nf * 0.42})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawGlows(nf);

  if (state.build.active) drawGhost();
  else if (!state.helpOn && !state.paused) drawManage();
  else { manageRects = []; hoveredStruct = null; }
  drawHUD(nf);
  if (state.helpOn) drawHelp();
  if (state.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSADO', W / 2, H / 2);
  }
}

function drawSky(nf) {

  const top = nf < 0.5 ? '#4a7a9a' : '#0a1a2a';
  const bot = nf < 0.5 ? '#2a5a7a' : '#050a15';
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (nf > 0.05) {
    for (let i = 0; i < 90; i++) {
      let sx = (hash(i) * 2.7 * W - camX * 0.05) % W;
      if (sx < 0) sx += W;
      const sy = hash(i + 500) * H * 0.5;
      const r = hash(i + 900) * 1.6 + 0.5;
      ctx.globalAlpha = nf * (0.35 + 0.65 * Math.abs(Math.sin(animT * 1.5 + i)));
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx, sy, r, r);
    }
    ctx.globalAlpha = 1;
  }

  if (state.time < DAY_LEN) {
    const p = state.time / DAY_LEN;
    const sx = W * (0.08 + 0.84 * p);
    const sy = H * 0.62 - Math.sin(p * Math.PI) * H * 0.45;
    ctx.fillStyle = '#ffdf7e';
    ctx.beginPath(); ctx.arc(sx, sy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,223,126,0.25)';
    ctx.beginPath(); ctx.arc(sx, sy, 44, 0, Math.PI * 2); ctx.fill();
  } else {
    const p = (state.time - DAY_LEN) / (CYCLE - DAY_LEN);
    const mx = W * (0.08 + 0.84 * p);
    const my = H * 0.55 - Math.sin(p * Math.PI) * H * 0.4;
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath(); ctx.arc(mx, my, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = drawSkyMoonShadow(nf);
    ctx.beginPath(); ctx.arc(mx - 8, my - 4, 17, 0, Math.PI * 2); ctx.fill();
  }
}
function drawSkyMoonShadow(nf) { return lerpC([6, 8, 32], [6, 8, 32], nf); }

function drawRidge(par, base, amp1, f1, amp2, f2, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + 12; sx += 12) {
    const wx = sx + camX * par;
    ctx.lineTo(sx, base + Math.sin(wx * f1) * amp1 + Math.sin(wx * f2 + 3) * amp2);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawGround(nf) {

  const g = ctx.createLinearGradient(0, H * 0.85, 0, H);
  g.addColorStop(0, 'rgba(168, 152, 186, 0.78)');   // lilás na superfície
  g.addColorStop(1, 'rgba(196, 168, 178, 0.82)');   // rosado no fundo
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + 6; sx += 6) ctx.lineTo(sx, terrainY(sx + camX));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(214, 196, 214, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let sx = 0; sx <= W + 6; sx += 6) {
    const y = terrainY(sx + camX);
    if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
  }
  ctx.stroke();
}

function drawTrees(nf) {
  const leaf = lerpC([40, 72, 44], [14, 22, 34], nf * 0.85);
  const trunk = lerpC([74, 54, 40], [20, 16, 26], nf * 0.85);
  for (const t of TREES) {
    const sx = t.x - camX;
    if (sx < -80 || sx > W + 80) continue;
    const y = terrainY(t.x);
    const sway = Math.sin(animT * 0.8 + t.v * 9) * 2;
    ctx.save();
    ctx.translate(sx, y);
    ctx.scale(t.s, t.s);
    ctx.fillStyle = trunk;
    ctx.fillRect(-3, -34, 6, 34);
    ctx.fillStyle = leaf;
    ctx.beginPath(); ctx.arc(sway, -48, 20, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-12 + sway, -38, 14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(12 + sway, -38, 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawPlatforms() {     // deck na linha d'água, casco afunda
  const wl = waterLevel();
  for (const p of platforms) {
    const sx = p.x - camX;
    const img = p.img === 'plat1' ? plat1Img : plat2Img;
    const w = PLAT_W + 1;      // +1 fecha a fresta entre as duas
    if (sx < -w || sx > W + w) continue;
    ctx.save();
    ctx.translate(sx, wl);
    const topOff = PLAT_TOP_FRAC * PLAT_H;
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -w / 2, -PLAT_VIS - topOff, w, PLAT_H);
    } else {
      ctx.fillStyle = '#6a8a9a';
      ctx.fillRect(-w / 2, -PLAT_VIS, w, PLAT_VIS);
    }
    ctx.restore();
  }
}

function drawTorches() {
  const nf = nightFactor();
  const th = 80;
  const torchDrop = 5;       
  const fireDrop = 20;       
  const baseY = floorY() + torchDrop;
  for (const tx of [SPAWN_X - PLAT_W * 0.85, SPAWN_X + PLAT_W * 0.85]) {
    const sx = tx - camX;
    if (sx < -60 || sx > W + 60) continue;
    const tw = torchImg.naturalWidth ? th * (torchImg.naturalWidth / torchImg.naturalHeight) : th * 0.3;
    if (torchImg.complete && torchImg.naturalWidth) ctx.drawImage(torchImg, sx - tw / 2, baseY - th, tw, th);
    if (nf > 0.4) {            // acende à noite
      const a = clamp((nf - 0.4) / 0.4, 0, 1);
      const topY = baseY - th + 6 + fireDrop;
      const fh = 30 + Math.sin(animT * 3 + tx) * 3;
      const tilt = Math.sin(animT * 2 + tx) * 0.1;   // pende a partir do pé
      const fw = fireImg.naturalWidth ? fh * (fireImg.naturalWidth / fireImg.naturalHeight) : fh;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(sx, topY, 4, sx, topY, 120);
      g.addColorStop(0, `rgba(255,150,50,${a * 0.35})`);
      g.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 120, topY - 120, 240, 240);
      ctx.restore();
      ctx.globalAlpha = a;
      if (fireImg.complete && fireImg.naturalWidth) {
        ctx.save();
        ctx.translate(sx, topY);   // pé do fogo (fixo)
        ctx.rotate(tilt);
        ctx.drawImage(fireImg, -fw / 2, -fh, fw, fh);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
}

function drawCampfireBase() {
  const sx = house.x - camX;
  const h = 130;
  const w = houseImg.naturalWidth ? h * (houseImg.naturalWidth / houseImg.naturalHeight) : h;
  if (sx < -w || sx > W + w) return;
  ctx.save();
  ctx.translate(sx, floorY());
  if (houseImg.complete && houseImg.naturalWidth > 0) {
    ctx.drawImage(houseImg, -w / 2, -h, w, h);
  } else {
    ctx.fillStyle = '#8b5a3c';
    ctx.fillRect(-w / 2, -h, w, h);
  }
  ctx.restore();
}

function drawStructure(s) {
  const sx = s.x - camX;
  if (sx < -120 || sx > W + 120) return;
  const y = terrainY(s.x);
  ctx.save();
  ctx.translate(sx, y);
  if (s.built) {
    drawStructureShape(s.key, s.level);
  } else {
    ctx.globalAlpha = 0.28;
    drawStructureShape(s.key, s.level);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#7a5a33';
    ctx.lineWidth = 3;
    const w = s.t.w, h = structH(s);
    ctx.beginPath();
    ctx.moveTo(-w / 2 - 4, 0); ctx.lineTo(-w / 2 - 4, -h);
    ctx.moveTo(w / 2 + 4, 0); ctx.lineTo(w / 2 + 4, -h);
    ctx.moveTo(-w / 2 - 4, -h); ctx.lineTo(w / 2 + 4, -h);
    ctx.moveTo(-w / 2 - 4, -h / 2); ctx.lineTo(w / 2 + 4, -h / 2);
    ctx.moveTo(-w / 2 - 4, 0); ctx.lineTo(w / 2 + 4, -h / 2);
    ctx.stroke();

    const pw = Math.max(w, 36);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-pw / 2, -h - 14, pw, 6);
    ctx.fillStyle = '#7ec74f';
    ctx.fillRect(-pw / 2, -h - 14, pw * clamp(s.progress / s.t.tempo, 0, 1), 6);
  }

  if (s.built && s.hp < s.hpMax) {
    const pw = Math.max(s.t.w, 36);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-pw / 2, -structH(s) - 12, pw, 5);
    ctx.fillStyle = '#e05548';
    ctx.fillRect(-pw / 2, -structH(s) - 12, pw * clamp(s.hp / s.hpMax, 0, 1), 5);
  }
  ctx.restore();
}

function drawStructureShape(key, level) {
  level = level || 1;
  if (key === 'muralha') {
    const big = level >= 2;
    const bh = big ? 68 : 50;
    ctx.fillStyle = big ? '#9aa0ad' : '#8d8896';
    ctx.fillRect(-13, -bh, 26, bh);

    ctx.fillRect(-13, -bh - 8, 7, 9);
    ctx.fillRect(-3.5, -bh - 8, 7, 9);
    ctx.fillRect(6, -bh - 8, 7, 9);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.5;
    for (let yy = -(bh - 10); yy < 0; yy += 10) {
      ctx.beginPath(); ctx.moveTo(-13, yy); ctx.lineTo(13, yy); ctx.stroke();
    }
    if (big) {

      ctx.strokeStyle = '#5a5f6b';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-13, -bh * 0.66); ctx.lineTo(13, -bh * 0.66); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-13, -bh * 0.33); ctx.lineTo(13, -bh * 0.33); ctx.stroke();
      ctx.strokeStyle = '#5a4032'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -bh - 8); ctx.lineTo(0, -bh - 20); ctx.stroke();
      ctx.fillStyle = '#c4453f';
      ctx.beginPath();
      ctx.moveTo(0, -bh - 20); ctx.lineTo(12, -bh - 17); ctx.lineTo(0, -bh - 14);
      ctx.closePath(); ctx.fill();
    }
  } else if (key === 'tenda') {
    ctx.fillStyle = '#a05335';
    ctx.beginPath();
    ctx.moveTo(-24, 0); ctx.lineTo(0, -44); ctx.lineTo(24, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6e3520';
    ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(0, -18); ctx.lineTo(8, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a4032';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(0, -52); ctx.stroke();
    ctx.fillStyle = '#d8b04a';
    ctx.beginPath();
    ctx.moveTo(0, -52); ctx.lineTo(10, -49); ctx.lineTo(0, -46);
    ctx.closePath(); ctx.fill();
  } else if (key === 'fazenda') {
    ctx.fillStyle = '#5d4630';
    ctx.fillRect(-40, -4, 80, 4);
    ctx.strokeStyle = '#d9a93e';
    ctx.lineWidth = 2;
    for (let x = -34; x <= 10; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, -2);
      ctx.lineTo(x + Math.sin(animT * 2 + x) * 1.5, -15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + Math.sin(animT * 2 + x) * 1.5, -16, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#e6bc55';
      ctx.fill();
    }

    ctx.fillStyle = '#6b4a32';
    ctx.fillRect(18, -24, 22, 24);
    ctx.fillStyle = '#4a3526';
    ctx.beginPath();
    ctx.moveTo(15, -24); ctx.lineTo(29, -38); ctx.lineTo(43, -24);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(25, -12, 8, 12);
  } else if (key === 'torre') {
    const big = level >= 2;
    ctx.save();
    if (big) ctx.scale(1.12, 1.2);
    ctx.fillStyle = big ? '#9aa0ad' : '#8d8896';
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(-10, -66); ctx.lineTo(10, -66); ctx.lineTo(13, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(-17, -76, 34, 10);
    ctx.fillRect(-17, -84, 8, 8);
    ctx.fillRect(-4, -84, 8, 8);
    ctx.fillRect(9, -84, 8, 8);
    ctx.fillStyle = '#2a2438';
    ctx.fillRect(-3, -46, 6, 12);

    ctx.strokeStyle = '#241f2e';
    ctx.fillStyle = '#241f2e';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -76); ctx.lineTo(0, -86); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -89, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -84, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.restore();
    if (big) {

      ctx.strokeStyle = '#5a4032'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -103); ctx.lineTo(0, -116); ctx.stroke();
      ctx.fillStyle = '#c4453f';
      ctx.beginPath();
      ctx.moveTo(0, -116); ctx.lineTo(12, -113); ctx.lineTo(0, -110);
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawCoin(c) {
  const sx = c.x - camX;
  if (sx < -20 || sx > W + 20) return;
  const y = c.grounded ? groundY(c.x) - 6 : c.y;
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(sx, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8901e';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, y, 3.5, 0, Math.PI * 2); ctx.stroke();
}

function drawVillager(v) {
  const sx = v.x - camX;
  if (sx < -30 || sx > W + 30) return;
  const y = groundY(v.x);
  const building = v.st === 'build';
  const moving = !building;

  const hop = 0;
  const tilt = building ? Math.sin(v.swing) * 0.12
    : moving ? Math.sin(v.walk || 0) * 0.06 : 0;

  const h = 54;
  const ratio = aldeaoImg.naturalWidth ? aldeaoImg.naturalWidth / aldeaoImg.naturalHeight : 0.6;
  const w = h * ratio;

  ctx.save();
  ctx.translate(sx, y - hop);
  ctx.rotate(tilt);
  ctx.scale(v.dir, 1);
  if (aldeaoImg.complete && aldeaoImg.naturalWidth) {
    ctx.drawImage(aldeaoImg, -w / 2, -h, w, h);
  } else {
    ctx.fillStyle = '#7a3b32';
    ctx.fillRect(-w / 2, -h, w, h);
  }
  ctx.restore();
}

function drawEnemy(e) {
  const sx = e.x - camX;
  if (sx < -60 || sx > W + 60) return;
  const y = terrainY(e.x);
  const bob = Math.sin(animT * 6 + e.bob) * 2;
  const img = enemyImgs[Math.floor(animT * 8 + e.bob) % enemyImgs.length];
  const dir = e.dir || (e.x < SPAWN_X ? 1 : -1);
  const h = 46, w = img.naturalWidth ? h * (img.naturalWidth / img.naturalHeight) : h * 1.7;
  const waterY = y + h * 0.05;   // linha d'água: ~metade do corpo submersa
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, waterY);     // só desenha acima da água
  ctx.clip();
  ctx.translate(sx, y + bob);
  ctx.scale(dir, 1);
  if (img.complete && img.naturalWidth) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#3a2750';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function boatBob() {
  return Math.sin(animT * 2) * 3 * boatIdle;
}

function drawBoatWake() {
  const p = state.player;
  if (onPlatform(p.x) || Math.abs(p.vx) < 12) return;
  const img = wakeImgs[Math.floor(animT * 8) % 4];
  if (!img.complete || !img.naturalWidth) return;
  const sx = p.x - camX;
  const w = 320, h = w * (img.naturalHeight / img.naturalWidth);
  ctx.save();
  ctx.translate(sx + p.dir * 100, p.y + boatBob() + 45);
  ctx.scale(p.dir, 1);
  ctx.globalAlpha = 0.7;
  ctx.drawImage(img, -w, -h / 2, w, h);
  ctx.restore();
}

function drawBoat() {
  const p = state.player;
  if (onPlatform(p.x)) return;
  const sx = p.x - camX;
  const h = 60;
  const w = boatImg.naturalWidth ? h * (boatImg.naturalWidth / boatImg.naturalHeight) : h * 3;
  if (sx < -w || sx > W + w) return;
  ctx.save();
  ctx.translate(sx, p.y + boatBob());
  ctx.scale(p.dir, 1);

  if (boatImg.complete && boatImg.naturalWidth > 0) {
    ctx.drawImage(boatImg, -w / 2, -h * 0.28, w, h);
  } else {
    ctx.fillStyle = '#7a3b32';
    ctx.fillRect(-w / 2, -h * 0.28, w, h);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = state.player;
  let sx = p.x - camX;
  let y = p.y;
  const noBoat = onPlatform(p.x);
  const moving = noBoat && Math.abs(p.vx) > 12;  
  const bob = moving ? Math.abs(Math.sin(animT * 10)) * 3 : 0;
  const tilt = moving ? Math.sin(animT * 10) * 0.06 : 0;

  const h = 66;
  const ratio = playerImg.naturalWidth ? playerImg.naturalWidth / playerImg.naturalHeight : 0.6;
  const w = h * ratio;

  if (!noBoat) {              // colado no barco: mesmo balanço + descido 40%
    const bw = boatImg.naturalWidth ? 60 * (boatImg.naturalWidth / boatImg.naturalHeight) : 180;
    sx -= p.dir * bw * 0.2;
    y = p.y + boatBob() + h * 0.4;
  }

  ctx.save();
  ctx.translate(sx, y - bob);
  ctx.rotate(tilt);
  ctx.scale(p.dir, 1);
  if (playerImg.complete && playerImg.naturalWidth) {
    ctx.drawImage(playerImg, -w / 2, -h, w, h);
  } else {
    ctx.fillStyle = '#7d2436';
    ctx.fillRect(-w / 2, -h, w, h);
  }
  ctx.restore();
}

function drawArrow(a) {
  const sx = a.x - camX;
  if (sx < -20 || sx > W + 20) return;
  const ang = Math.atan2(a.vy, a.vx);
  ctx.save();
  ctx.translate(sx, a.y);
  ctx.rotate(ang);
  ctx.strokeStyle = '#d8d2c0';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();
  ctx.restore();
}

function drawGlows(nf) {

  if (nf > 0.2) {
    for (const s of state.structures) {
      if (!s.built || s.key !== 'tenda') continue;
      const sx = s.x - camX;
      if (sx < -60 || sx > W + 60) continue;
      ctx.fillStyle = `rgba(255,190,90,${nf * 0.8})`;
      ctx.beginPath();
      ctx.moveTo(sx - 6, terrainY(s.x));
      ctx.lineTo(sx, terrainY(s.x) - 14);
      ctx.lineTo(sx + 6, terrainY(s.x));
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawGhost() {
  const key = ORDER[state.build.sel];
  const t = TYPES[key];
  const wx = mouse.x + camX;
  const v = validatePlacement(wx, key);
  const sx = wx - camX;
  const y = terrainY(wx);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();

  ctx.save();
  ctx.translate(sx, y);
  ctx.globalAlpha = 0.55;
  drawStructureShape(key, 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = v.ok ? 'rgba(110,230,110,0.22)' : 'rgba(235,80,70,0.30)';
  ctx.fillRect(-t.w / 2 - 4, -t.h - 4, t.w + 8, t.h + 8);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.font = 'bold 14px system-ui';
  ctx.fillStyle = v.ok ? '#9fe88f' : '#ff9a8f';
  ctx.fillText(v.ok ? `${t.nome} — ${t.custo} moedas (clique)` : v.reason, sx, y - t.h - 22);
}

function structUnderMouse() {
  if (state.build.active) return null;
  const wx = mouse.x + camX;
  for (const s of state.structures) {
    if (s.dead) continue;
    if (Math.abs(s.x - wx) > s.t.w / 2 + 12) continue;
    const gy = terrainY(s.x);
    if (mouse.y >= gy - structH(s) - 18 && mouse.y <= gy + 16) return s;
  }
  return null;
}

function drawManage() {
  manageRects = [];
  hoveredStruct = structUnderMouse();
  const s = hoveredStruct;
  if (!s) return;
  const sx = s.x - camX;
  const top = terrainY(s.x) - structH(s);

  ctx.strokeStyle = 'rgba(255,233,168,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(sx - s.t.w / 2 - 6, top - 14, s.t.w + 12, structH(s) + 20);

  const pw = 196, ph = 84;
  const px = clamp(sx - pw / 2, 8, W - pw - 8);
  const py = clamp(top - 16 - ph, 8, H - ph - 8);
  ctx.fillStyle = 'rgba(12,12,28,0.92)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#e7b93c'; ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, pw, ph);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui';
  ctx.fillText(`${s.t.nome} · Nível ${s.level}`, px + 10, py + 20);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px system-ui';
  ctx.fillText(`HP ${Math.max(0, Math.ceil(s.hp))}/${s.hpMax}${s.built ? '' : ' · em obra'}`, px + 10, py + 37);

  const bw = (pw - 30) / 2, bh = 26, by = py + ph - bh - 10;
  ctx.textAlign = 'center'; ctx.font = 'bold 12px system-ui';

  const up = upgradeCost(s);
  const canUp = s.built && up != null && state.coins >= up;
  const bxU = px + 10;
  ctx.fillStyle = up == null ? 'rgba(70,70,82,0.7)' : (canUp ? 'rgba(60,140,70,0.95)' : 'rgba(120,60,55,0.85)');
  ctx.fillRect(bxU, by, bw, bh);
  ctx.fillStyle = '#fff';
  ctx.fillText(up == null ? 'Nível máx' : `Melhorar ${up}●`, bxU + bw / 2, by + 17);
  if (s.built && up != null) manageRects.push({ x: bxU, y: by, w: bw, h: bh, action: () => tryUpgrade(s) });

  const refund = Math.round(s.invested * REFUND);
  const bxD = px + 20 + bw;
  ctx.fillStyle = 'rgba(150,70,60,0.92)';
  ctx.fillRect(bxD, by, bw, bh);
  ctx.fillStyle = '#fff';
  ctx.fillText(`Demolir +${refund}●`, bxD + bw / 2, by + 17);
  manageRects.push({ x: bxD, y: by, w: bw, h: bh, action: () => demolish(s) });

  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px system-ui';
  ctx.fillText('U melhorar · X demolir', px + pw / 2, py + ph + 14);
}

function drawHUD(nf) {
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(28, 30, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8901e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(28, 30, 6.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(state.coins, 48, 37);

  ctx.font = '15px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`Aldeões: ${state.villagers.length}`, 16, 62);
  ctx.fillText(`Dia ${state.day} ${nf > 0.5 ? '🌙' : '☀️'}`, 16, 84);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(state.build.active ? 'Esc — sair do modo construção' : 'B — construir · H — ajuda', W - 16, 30);

  uiRects = [];
  const btns = [
    { label: nf > 0.5 ? 'Dia' : 'Noite', action: toggleDayNight },
    { label: state.timeFrozen ? '▶ Tempo' : '⏸ Tempo', action: () => state.timeFrozen = !state.timeFrozen },
  ];
  const bw = 110, bh = 30, gap = 8;
  for (let i = 0; i < btns.length; i++) {
    const x = W - 16 - (btns.length - i) * (bw + gap) + gap, y = 46;
    uiRects.push({ x, y, w: bw, h: bh, action: btns[i].action });
    ctx.fillStyle = 'rgba(12,12,28,0.8)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(btns[i].label, x + bw / 2, y + 20);
  }
  ctx.textAlign = 'left';

  hotbarRects = [];
  if (state.build.active) {
    const sw = 124, sh = 66, gap = 8;
    const total = ORDER.length * sw + (ORDER.length - 1) * gap;
    let x0 = (W - total) / 2;
    const y0 = H - sh - 14;
    for (let i = 0; i < ORDER.length; i++) {
      const key = ORDER[i], t = TYPES[key];
      const x = x0 + i * (sw + gap);
      hotbarRects.push({ x, y: y0, w: sw, h: sh });
      ctx.fillStyle = 'rgba(12,12,28,0.85)';
      ctx.fillRect(x, y0, sw, sh);
      ctx.strokeStyle = i === state.build.sel ? '#e7b93c' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = i === state.build.sel ? 3 : 1.5;
      ctx.strokeRect(x, y0, sw, sh);

      ctx.save();
      ctx.translate(x + 30, y0 + sh - 12);
      const sc = Math.min(0.55, 42 / t.h);
      ctx.scale(sc, sc);
      drawStructureShape(key, 1);
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui';
      ctx.fillText(`${i + 1}. ${t.nome}`, x + 56, y0 + 24);
      ctx.fillStyle = state.coins >= t.custo ? '#ffd23e' : '#ff8a7f';
      ctx.font = '13px system-ui';
      ctx.fillText(`${t.custo} moedas`, x + 56, y0 + 44);
    }
  }

  if (state.msg.t > 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 17px system-ui';
    ctx.globalAlpha = clamp(state.msg.t, 0, 1);
    ctx.fillStyle = '#000';
    ctx.fillText(state.msg.text, W / 2 + 1, H - 105 + 1);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(state.msg.text, W / 2, H - 105);
    ctx.globalAlpha = 1;
  }
}

function drawHelp() {
  const lines = [
    'poggerscity — jogo estilo kingdom  ',
    '',
    'A/D ou ←/→ — cavalgar      Shift — galopar',
    'B — modo construção      1-4 ou roda do mouse — escolher',
    '      Esc — cancelar',
    '',
    'Fazendas geram moedas de dia · Tendas atraem aldeões',
    'Aldeões constroem as obras · Torres atiram nos monstros',
    'Muralhas bloqueiam o caminho · À noite ELES molestam...',
    '',
    'Mouse numa estrutura → Melhorar (U) ou Demolir (X, +70%)',
    'Muralha e Torre têm nível 2 (mais HP / alcance)',
    '',
    'H — fechar esta janela',
  ];
  const bw = 560, bh = lines.length * 24 + 30;
  const bx = (W - bw) / 2, by = (H - bh) / 2 - 30;
  ctx.fillStyle = 'rgba(8,8,22,0.88)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#e7b93c';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.textAlign = 'center';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? '#e7b93c' : 'rgba(255,255,255,0.9)';
    ctx.font = i === 0 ? 'bold 18px system-ui' : '15px system-ui';
    ctx.fillText(lines[i], W / 2, by + 34 + i * 24);
  }
}

let lastTs = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!state.paused) update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
