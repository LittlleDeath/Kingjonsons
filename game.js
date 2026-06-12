'use strict';

// ============================================================
// REINO — protótipo estilo Kingdom Two Crowns
// Construção livre: aperte B, escolha a estrutura (1-4) e
// clique em QUALQUER lugar do mundo para posicionar.
// ============================================================

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

// ---------- Mundo ----------
const WORLD_W = 7000;          // largura total do mundo em pixels
const SPAWN_X = WORLD_W / 2;   // centro do reino (fogueira)
const DAY_LEN = 70;            // segundos de dia
const CYCLE = 105;             // dia + noite

// O terreno é uma FUNÇÃO, não um array: qualquer x do mundo tem
// uma altura. É isso que permite construir em qualquer lugar.
function terrainY(x) {
  return H * 0.78
    + Math.sin(x * 0.0021) * 26
    + Math.sin(x * 0.00063 + 2.1) * 44
    + Math.sin(x * 0.0117) * 4;
}

// ---------- Tipos de estrutura ----------
const TYPES = {
  muralha: { nome: 'Muralha', custo: 4,  w: 26, h: 58, tempo: 4, hp: 80 },
  tenda:   { nome: 'Tenda',   custo: 6,  w: 48, h: 44, tempo: 5, hp: 40 },
  fazenda: { nome: 'Fazenda', custo: 8,  w: 80, h: 40, tempo: 6, hp: 40 },
  torre:   { nome: 'Torre',   custo: 12, w: 34, h: 86, tempo: 8, hp: 60 },
};
const ORDER = ['muralha', 'tenda', 'fazenda', 'torre'];

// ---------- Estado ----------
const state = {
  coins: 25,
  day: 1,
  time: 0,
  paused: false,
  player: { x: SPAWN_X + 60, vx: 0, dir: 1 },
  structures: [],
  villagers: [],
  enemies: [],
  arrows: [],
  pickups: [],
  particles: [],
  build: { active: false, sel: 0 },
  msg: { text: '', t: 0 },
  helpOn: true,
};
let camX = 0;
let animT = 0;
let spawnTimer = 3;
let hotbarRects = [];

// Aldeões iniciais (para construírem a primeira tenda)
state.villagers.push(newVillager(SPAWN_X - 40, null));
state.villagers.push(newVillager(SPAWN_X + 30, null));

// Moedas espalhadas pelo mapa (incentivo a explorar)
for (let i = 0; i < 12; i++) {
  const side = i % 2 ? 1 : -1;
  const x = SPAWN_X + side * (260 + hash(i + 3) * 2300);
  state.pickups.push({ x, y: 0, vy: 0, grounded: true });
}

// Árvores decorativas (posições determinísticas)
const TREES = [];
for (let i = 0; i < 26; i++) {
  const x = 150 + hash(i * 3 + 1) * (WORLD_W - 300);
  if (Math.abs(x - SPAWN_X) < 220) continue;
  TREES.push({ x, s: 0.7 + hash(i * 7 + 2) * 0.6, v: hash(i * 13 + 3) });
}

// ---------- Utilidades ----------
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(a, b, t) {
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
// 0 = dia pleno, 1 = noite plena (com transições suaves)
function nightFactor() {
  const t = state.time;
  if (t < DAY_LEN - 4) return 0;
  if (t < DAY_LEN + 2) return (t - (DAY_LEN - 4)) / 6;
  if (t < CYCLE - 6) return 1;
  return (CYCLE - t) / 6;
}
function showMsg(text) { state.msg.text = text; state.msg.t = 2.4; }
function newVillager(x, home) {
  return { x, dir: 1, st: 'idle', tgt: null, goal: x, wt: 0, home, swing: 0, walk: 0 };
}

// ---------- Entrada ----------
const keys = {};
const mouse = { x: 0, y: 0 };

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  const k = e.key.toLowerCase();
  if (k === 'b') { state.build.active = !state.build.active; state.helpOn = false; }
  if (k === 'escape') state.build.active = false;
  if (k === 'h') state.helpOn = !state.helpOn;
  if (k === 'p') state.paused = !state.paused;
  const d = ORDER.findIndex((_, i) => k === String(i + 1));
  if (d >= 0) { state.build.sel = d; if (!state.build.active) state.build.active = true; }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (state.build.active) {
    // clique na hotbar seleciona; clique no mundo posiciona
    for (let i = 0; i < hotbarRects.length; i++) {
      const r = hotbarRects[i];
      if (mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) {
        state.build.sel = i;
        return;
      }
    }
    tryPlace();
  }
});
canvas.addEventListener('contextmenu', e => { e.preventDefault(); state.build.active = false; });
canvas.addEventListener('wheel', e => {
  if (!state.build.active) return;
  state.build.sel = (state.build.sel + (e.deltaY > 0 ? 1 : ORDER.length - 1)) % ORDER.length;
});

// ---------- Construção livre (o coração do protótipo) ----------
// Converte a posição do mouse (tela) para o mundo, valida o local
// e cria um canteiro de obras que os aldeões vêm construir.
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
  state.structures.push({
    key, t, x: wx, hp: t.hp, progress: 0, built: false,
    workers: 0, ct: 0, cd: 0, dead: false,
  });
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
  for (let i = 0; i < 16; i++) spawnParticle(s.x, terrainY(s.x) - s.t.h / 2, '#8d8896');
  showMsg(`${s.t.nome} foi destruída!`);
}

// ---------- Atualização ----------
function update(dt) {
  animT += dt;
  state.time += dt;
  if (state.time >= CYCLE) {
    state.time -= CYCLE;
    state.day++;
    showMsg(`Dia ${state.day}`);
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
}

function updateStructures(dt) {
  const nf = nightFactor();
  for (const s of state.structures) {
    if (!s.built) continue;
    // fazendas produzem moedas de dia
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
    // torres atiram no monstro mais próximo
    if (s.key === 'torre') {
      s.cd -= dt;
      if (s.cd <= 0) {
        let best = null, bd = 300;
        for (const e of state.enemies) {
          if (e.dead) continue;
          const d = Math.abs(e.x - s.x);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          s.cd = 1.4;
          state.arrows.push({ x: s.x, y: terrainY(s.x) - s.t.h + 16, tgt: best, vx: 0, vy: 0, life: 3, dead: false });
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
      // à noite todo mundo volta pra casa (tenda ou fogueira)
      releaseTarget(v);
      const hx = (v.home && !v.home.dead) ? v.home.x : SPAWN_X;
      moveToward(v, hx + 10, 70, dt);
      continue;
    }
    if (v.tgt && (v.tgt.dead || v.tgt.built)) releaseTarget(v);
    if (!v.tgt) {
      // procura canteiro de obras com vaga (máx. 2 por obra)
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
      // perambula perto de casa
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
      e.x += dir * e.sp * 2.2 * dt;
      if (Math.abs(e.x - SPAWN_X) > 2700 || e.x < 40 || e.x > WORLD_W - 40) e.dead = true;
      continue;
    }
    // estrutura no caminho? ataca
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
        spawnParticle(blocker.x + (Math.random() - 0.5) * blocker.t.w, terrainY(blocker.x) - blocker.t.h * 0.4, '#aa9999');
        if (blocker.hp <= 0) destroyStructure(blocker);
      }
      continue;
    }
    // rouba moedas do rei
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
      const gy = terrainY(c.x) - 6;
      if (c.y >= gy) {
        c.y = gy;
        if (Math.abs(c.vy) > 50) c.vy = -c.vy * 0.45;
        else c.grounded = true;
      }
    }
    if (Math.abs(c.x - p.x) < 28) {
      c.dead = true;
      state.coins++;
      for (let i = 0; i < 4; i++) spawnParticle(c.x, terrainY(c.x) - 12, '#ffd23e');
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

// ---------- Desenho ----------
function draw() {
  const nf = nightFactor();
  drawSky(nf);
  drawRidge(0.15, H * 0.52, 70, 0.0016, 30, 0.005, lerpC([96, 116, 150], [16, 20, 50], nf));
  drawRidge(0.35, H * 0.62, 50, 0.0023, 22, 0.007, lerpC([70, 92, 122], [12, 15, 42], nf));
  drawGround(nf);
  drawTrees(nf);
  drawCampfireBase();
  for (const s of state.structures) drawStructure(s);
  for (const c of state.pickups) drawCoin(c);
  for (const v of state.villagers) drawVillager(v);
  for (const e of state.enemies) drawEnemy(e);
  drawPlayer();
  for (const a of state.arrows) drawArrow(a);
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life * 2, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // escurecimento noturno + luzes por cima
  if (nf > 0.01) {
    ctx.fillStyle = `rgba(8,10,38,${nf * 0.42})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawGlows(nf);

  if (state.build.active) drawGhost();
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
  const dusk = Math.sin(nf * Math.PI);
  const top = lerpC([110, 170, 225], [6, 8, 32], nf);
  let hr = [
    lerp(lerp(225, 25, nf), 235, dusk * 0.55),
    lerp(lerp(210, 30, nf), 120, dusk * 0.55),
    lerp(lerp(170, 70, nf), 60, dusk * 0.55),
  ];
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
  g.addColorStop(0, top);
  g.addColorStop(1, `rgb(${hr.map(Math.round).join(',')})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // estrelas
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

  // sol e lua
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
  const grass = lerpC([74, 124, 63], [20, 32, 42], nf * 0.85);
  const dirt = lerpC([62, 52, 42], [14, 14, 26], nf * 0.85);
  const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
  g.addColorStop(0, grass);
  g.addColorStop(1, dirt);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + 6; sx += 6) ctx.lineTo(sx, terrainY(sx + camX));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  // linha de grama no topo
  ctx.strokeStyle = lerpC([108, 168, 84], [28, 44, 52], nf * 0.85);
  ctx.lineWidth = 4;
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

function drawCampfireBase() {
  const sx = SPAWN_X - camX;
  if (sx < -60 || sx > W + 60) return;
  const y = terrainY(SPAWN_X);
  ctx.save();
  ctx.translate(sx, y);
  ctx.strokeStyle = '#4a3526';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(10, -7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -7); ctx.lineTo(11, -3); ctx.stroke();
  ctx.restore();
}

function drawStructure(s) {
  const sx = s.x - camX;
  if (sx < -120 || sx > W + 120) return;
  const y = terrainY(s.x);
  ctx.save();
  ctx.translate(sx, y);
  if (s.built) {
    drawStructureShape(s.key, 1);
  } else {
    ctx.globalAlpha = 0.28;
    drawStructureShape(s.key, 1);
    ctx.globalAlpha = 1;
    // andaimes
    ctx.strokeStyle = '#7a5a33';
    ctx.lineWidth = 3;
    const w = s.t.w, h = s.t.h;
    ctx.beginPath();
    ctx.moveTo(-w / 2 - 4, 0); ctx.lineTo(-w / 2 - 4, -h);
    ctx.moveTo(w / 2 + 4, 0); ctx.lineTo(w / 2 + 4, -h);
    ctx.moveTo(-w / 2 - 4, -h); ctx.lineTo(w / 2 + 4, -h);
    ctx.moveTo(-w / 2 - 4, -h / 2); ctx.lineTo(w / 2 + 4, -h / 2);
    ctx.moveTo(-w / 2 - 4, 0); ctx.lineTo(w / 2 + 4, -h / 2);
    ctx.stroke();
    // barra de progresso
    const pw = Math.max(w, 36);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-pw / 2, -h - 14, pw, 6);
    ctx.fillStyle = '#7ec74f';
    ctx.fillRect(-pw / 2, -h - 14, pw * clamp(s.progress / s.t.tempo, 0, 1), 6);
  }
  // barra de vida quando danificada
  if (s.built && s.hp < s.t.hp) {
    const pw = Math.max(s.t.w, 36);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-pw / 2, -s.t.h - 12, pw, 5);
    ctx.fillStyle = '#e05548';
    ctx.fillRect(-pw / 2, -s.t.h - 12, pw * clamp(s.hp / s.t.hp, 0, 1), 5);
  }
  ctx.restore();
}

// Desenha a forma da estrutura com origem no centro da base
function drawStructureShape(key, alpha) {
  if (key === 'muralha') {
    ctx.fillStyle = '#8d8896';
    ctx.fillRect(-13, -50, 26, 50);
    ctx.fillRect(-13, -58, 7, 9);
    ctx.fillRect(-3.5, -58, 7, 9);
    ctx.fillRect(6, -58, 7, 9);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.5;
    for (let yy = -40; yy < 0; yy += 10) {
      ctx.beginPath(); ctx.moveTo(-13, yy); ctx.lineTo(13, yy); ctx.stroke();
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
    // celeiro
    ctx.fillStyle = '#6b4a32';
    ctx.fillRect(18, -24, 22, 24);
    ctx.fillStyle = '#4a3526';
    ctx.beginPath();
    ctx.moveTo(15, -24); ctx.lineTo(29, -38); ctx.lineTo(43, -24);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(25, -12, 8, 12);
  } else if (key === 'torre') {
    ctx.fillStyle = '#8d8896';
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(-10, -66); ctx.lineTo(10, -66); ctx.lineTo(13, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(-17, -76, 34, 10);
    ctx.fillRect(-17, -84, 8, 8);
    ctx.fillRect(-4, -84, 8, 8);
    ctx.fillRect(9, -84, 8, 8);
    ctx.fillStyle = '#2a2438';
    ctx.fillRect(-3, -46, 6, 12);
    // arqueiro no topo
    ctx.strokeStyle = '#241f2e';
    ctx.fillStyle = '#241f2e';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -76); ctx.lineTo(0, -86); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -89, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -84, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  }
}

function drawCoin(c) {
  const sx = c.x - camX;
  if (sx < -20 || sx > W + 20) return;
  const y = c.grounded ? terrainY(c.x) - 6 : c.y;
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(sx, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8901e';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, y, 3.5, 0, Math.PI * 2); ctx.stroke();
}

function drawVillager(v) {
  const sx = v.x - camX;
  if (sx < -30 || sx > W + 30) return;
  const y = terrainY(v.x);
  const moving = v.st !== 'build';
  const lp = Math.sin(v.walk || 0) * 4;
  ctx.save();
  ctx.translate(sx, y);
  ctx.scale(v.dir, 1);
  ctx.strokeStyle = '#2b2433';
  ctx.fillStyle = '#2b2433';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  // pernas
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(moving ? lp : 2, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(moving ? -lp : -2, 0); ctx.stroke();
  // corpo
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -17); ctx.stroke();
  // cabeça
  ctx.beginPath(); ctx.arc(0, -20, 3.4, 0, Math.PI * 2); ctx.fill();
  // braço + martelo quando construindo
  if (v.st === 'build') {
    const a = -0.6 + Math.sin(v.swing) * 0.9;
    ctx.save();
    ctx.translate(0, -15);
    ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 0); ctx.stroke();
    ctx.fillRect(7, -3, 4, 6);
    ctx.restore();
  } else {
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(4, -10); ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(e) {
  const sx = e.x - camX;
  if (sx < -30 || sx > W + 30) return;
  const y = terrainY(e.x);
  const bob = Math.sin(animT * 6 + e.bob) * 2;
  ctx.fillStyle = '#3a2750';
  ctx.beginPath(); ctx.arc(sx, y - 8 + bob, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx - 6, y - 3 + bob, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 6, y - 3 + bob, 4, 0, Math.PI * 2); ctx.fill();
}

function drawPlayer() {
  const p = state.player;
  const sx = p.x - camX;
  const y = terrainY(p.x);
  const moving = Math.abs(p.vx) > 12;
  const ph = animT * (Math.abs(p.vx) > 220 ? 15 : 10);
  const l = moving ? Math.sin(ph) * 6 : 0;
  const l2 = moving ? Math.sin(ph + Math.PI) * 6 : 0;
  ctx.save();
  ctx.translate(sx, y);
  ctx.scale(p.dir, 1);
  ctx.strokeStyle = '#241f2e';
  ctx.fillStyle = '#241f2e';
  ctx.lineCap = 'round';
  // pernas do cavalo
  ctx.lineWidth = 3.5;
  for (const [bx, off] of [[-12, l], [-7, l2], [8, l2], [13, l]]) {
    ctx.beginPath(); ctx.moveTo(bx, -18); ctx.lineTo(bx + off, -1); ctx.stroke();
  }
  // corpo
  ctx.beginPath(); ctx.ellipse(0, -22, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
  // pescoço e cabeça
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(13, -26); ctx.lineTo(21, -37); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(24, -39, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(21, -42); ctx.lineTo(23, -46); ctx.stroke();
  // cauda
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-16, -24); ctx.quadraticCurveTo(-24, -22, -25, -14); ctx.stroke();
  // cavaleiro
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(-1, -44); ctx.stroke();
  ctx.beginPath(); ctx.arc(-1, -48, 4, 0, Math.PI * 2); ctx.fill();
  // capa
  ctx.fillStyle = '#7d2436';
  ctx.beginPath();
  ctx.moveTo(-1, -44);
  ctx.lineTo(-12 - (moving ? 6 : 0), -30 + (moving ? Math.sin(animT * 8) * 2 : 0));
  ctx.lineTo(-3, -29);
  ctx.closePath(); ctx.fill();
  // coroa
  ctx.fillStyle = '#e7b93c';
  ctx.beginPath();
  ctx.moveTo(-5, -52); ctx.lineTo(-5, -56); ctx.lineTo(-3, -53);
  ctx.lineTo(-1, -56.5); ctx.lineTo(1, -53); ctx.lineTo(3, -56); ctx.lineTo(3, -52);
  ctx.closePath(); ctx.fill();
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

// Luzes desenhadas por cima do escurecimento noturno
function drawGlows(nf) {
  // fogueira
  const fx = SPAWN_X - camX;
  const fy = terrainY(SPAWN_X);
  if (fx > -250 && fx < W + 250) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(fx, fy - 14, 4, fx, fy - 14, 180);
    g.addColorStop(0, `rgba(255,150,50,${0.10 + nf * 0.30})`);
    g.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(fx - 180, fy - 194, 360, 360);
    ctx.restore();
    // chamas
    for (let k = 0; k < 3; k++) {
      const fh = 12 + Math.sin(animT * 11 + k * 2.1) * 4;
      ctx.fillStyle = k === 1 ? '#ffd23e' : '#ff8c3a';
      ctx.beginPath();
      ctx.moveTo(fx - 6 + k * 5, fy - 5);
      ctx.lineTo(fx - 3 + k * 5, fy - 5 - fh);
      ctx.lineTo(fx + k * 5, fy - 5);
      ctx.closePath(); ctx.fill();
    }
  }
  // olhos dos monstros
  for (const e of state.enemies) {
    if (e.dead) continue;
    const sx = e.x - camX;
    if (sx < -30 || sx > W + 30) continue;
    const y = terrainY(e.x) - 10 + Math.sin(animT * 6 + e.bob) * 2;
    ctx.fillStyle = '#ff6a55';
    ctx.fillRect(sx - 4, y, 2.5, 2.5);
    ctx.fillRect(sx + 1.5, y, 2.5, 2.5);
  }
  // janelas das tendas à noite
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

// Fantasma de pré-visualização — segue o mouse pelo MUNDO inteiro
function drawGhost() {
  const key = ORDER[state.build.sel];
  const t = TYPES[key];
  const wx = mouse.x + camX;
  const v = validatePlacement(wx, key);
  const sx = wx - camX;
  const y = terrainY(wx);
  // linha-guia vertical
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();

  ctx.save();
  ctx.translate(sx, y);
  ctx.globalAlpha = 0.55;
  drawStructureShape(key, 0.55);
  ctx.globalAlpha = 1;
  ctx.fillStyle = v.ok ? 'rgba(110,230,110,0.22)' : 'rgba(235,80,70,0.30)';
  ctx.fillRect(-t.w / 2 - 4, -t.h - 4, t.w + 8, t.h + 8);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.font = 'bold 14px system-ui';
  ctx.fillStyle = v.ok ? '#9fe88f' : '#ff9a8f';
  ctx.fillText(v.ok ? `${t.nome} — ${t.custo} moedas (clique)` : v.reason, sx, y - t.h - 22);
}

function drawHUD(nf) {
  ctx.textAlign = 'left';
  // moedas
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(28, 30, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8901e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(28, 30, 6.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(state.coins, 48, 37);
  // população e dia
  ctx.font = '15px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`Aldeões: ${state.villagers.length}`, 16, 62);
  ctx.fillText(`Dia ${state.day} ${nf > 0.5 ? '🌙' : '☀️'}`, 16, 84);
  // dica
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(state.build.active ? 'Esc — sair do modo construção' : 'B — construir · H — ajuda', W - 16, 30);

  // hotbar de construção
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
      // mini-ícone
      ctx.save();
      ctx.translate(x + 30, y0 + sh - 12);
      const sc = Math.min(0.55, 42 / t.h);
      ctx.scale(sc, sc);
      drawStructureShape(key, 1);
      ctx.restore();
      // nome e custo
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui';
      ctx.fillText(`${i + 1}. ${t.nome}`, x + 56, y0 + 24);
      ctx.fillStyle = state.coins >= t.custo ? '#ffd23e' : '#ff8a7f';
      ctx.font = '13px system-ui';
      ctx.fillText(`${t.custo} moedas`, x + 56, y0 + 44);
    }
  }

  // mensagem
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
    'REINO — protótipo estilo Kingdom Two Crowns',
    '',
    'A/D ou ←/→ — cavalgar      Shift — galopar',
    'B — modo construção      1-4 ou roda do mouse — escolher',
    'Clique — posicionar EM QUALQUER LUGAR      Esc — cancelar',
    '',
    'Fazendas geram moedas de dia · Tendas atraem aldeões',
    'Aldeões constroem as obras · Torres atiram nos monstros',
    'Muralhas bloqueiam o caminho · À noite ELES vêm...',
    '',
    'H — fechar esta ajuda',
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

// ---------- Loop principal ----------
let lastTs = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!state.paused) update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
