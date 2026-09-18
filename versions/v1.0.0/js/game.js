'use strict';
/* ============================================================
 * MushDash 主逻辑
 * 玩法：角色定在左侧自动奔跑，敌人沿上下两条轨道从右侧袭来
 * ←/A/F 跳劈空中敌人，→/D/J 下斩地面敌人，节奏判定 PERFECT/
 * GREAT/GOOD，漏怪掉血，攒满热情槽进入 FEVER 双倍得分。
 * ============================================================ */
(() => {
  // ---------- 常量 ----------
  const W = 1280, H = 720;
  const PLAYER_X = 260, GROUND_Y = 556, AIR_Y = 366;
  const HIT_WINDOW = 0.15, PERFECT_WIN = 0.055, GREAT_WIN = 0.105;
  const ACT_DUR = 0.28;

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR; canvas.height = H * DPR;
  const $ = id => document.getElementById(id);
  const screens = { title: $('titleScreen'), pause: $('pauseScreen'), result: $('resultScreen') };

  // 页面错误收集，便于自动化测试
  window.__errors = [];
  window.addEventListener('error', e => window.__errors.push(String(e.message)));

  // ---------- 小工具 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  function hexRGB(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mixColor(a, b, t) {
    const A = hexRGB(a), B = hexRGB(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }
  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function strokeText(c, txt, x, y, size, fill, align = 'center', strokeW = null) {
    c.font = `900 ${size}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
    c.textAlign = align; c.textBaseline = 'middle';
    c.lineWidth = strokeW || Math.max(3, size * 0.16);
    c.strokeStyle = 'rgba(40,10,50,0.75)'; c.lineJoin = 'round';
    c.strokeText(txt, x, y);
    c.fillStyle = fill; c.fillText(txt, x, y);
  }
  function drawStar(c, x, y, r, rot, fill, stroke) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5;
      const a2 = a + TAU / 10;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      c.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
    }
    c.closePath();
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = 2.5; c.strokeStyle = stroke; c.stroke(); }
    c.restore();
  }

  // ---------- 游戏状态 ----------
  let state = 'title';            // title | playing | paused | result
  let diffKey = 'normal';
  let song = null;
  let enemies = [], candies = [], particles = [], floats = [], slashes = [];
  let chainMissed = new Set();
  let score = 0, displayScore = 0, combo = 0, maxCombo = 0, hp = 100;
  let fever = 0, feverT = 0;
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let shake = 0, redFlash = 0;
  let perfT = 0;                  // 菜单界面的自由时钟
  let resultInfo = null;

  const player = { actTrack: null, actT: 0, hurtT: 0, blink: 0 };
  const songNow = () => AudioSys.songTime();

  // ---------- 开局 ----------
  function startGame() {
    AudioSys.ensure(); AudioSys.resumeCtx(); AudioSys.sfxUI();
    song = Chart.generate(diffKey);
    const spb = song.spb;
    enemies = song.events.map((ev, i) => ({
      id: i, time: ev.beat * spb, track: ev.track, kind: ev.kind,
      groupId: ev.groupId, state: 'live', fallT: 0, missX: 0,
    }));
    candies = song.candies.map(c => ({ time: c.beat * spb, track: c.track, done: false }));
    chainMissed = new Set();
    particles = []; floats = []; slashes = [];
    score = 0; displayScore = 0; combo = 0; maxCombo = 0; hp = 100;
    fever = 0; feverT = 0;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    shake = 0; redFlash = 0; resultInfo = null;
    player.actT = 0; player.hurtT = 0;
    AudioSys.startSong(Chart.BARS * 16);
    for (const k in screens) screens[k].classList.add('hidden');
    state = 'playing';
  }

  // ---------- 判定 ----------
  function enemyPos(e, now) {
    return { x: PLAYER_X + (e.time - now) * song.speed, y: e.track === 'G' ? GROUND_Y : AIR_Y };
  }
  function attack(track) {
    if (state !== 'playing') return;
    const now = songNow();
    player.actTrack = track; player.actT = ACT_DUR;
    slashes.push({ track, t: 0 });
    let best = null, bestAbs = 1e9;
    for (const e of enemies) {
      if (e.state !== 'live' || e.track !== track) continue;
      const ad = Math.abs(now - e.time);
      if (ad <= HIT_WINDOW && ad < bestAbs) { best = e; bestAbs = ad; }
    }
    if (!best) { emptySwing(track, now); return; }
    killEnemy(best, bestAbs, now);
  }
  function emptySwing(track, now) {
    if (combo > 0) addFloat('空挥!', PLAYER_X + 60, track === 'G' ? GROUND_Y - 90 : AIR_Y - 40, '#c9b8e8', 22);
    combo = 0;
    AudioSys.sfxSwing();
  }
  function killEnemy(e, ad, now) {
    e.state = 'killed';
    let judge, base;
    if (ad <= PERFECT_WIN)      { judge = 'PERFECT'; base = 300; counts.perfect++; fever += 4; }
    else if (ad <= GREAT_WIN)   { judge = 'GREAT';   base = 200; counts.great++;   fever += 3; }
    else                        { judge = 'GOOD';    base = 100; counts.good++;    fever += 2; }
    combo++; maxCombo = Math.max(maxCombo, combo);
    if (combo > 0 && combo % 50 === 0) { hp = Math.min(100, hp + 4); addFloat('+4 ❤', PLAYER_X + 40, 250, '#7ee787', 26); }
    if (combo > 0 && combo % 25 === 0) AudioSys.sfxCombo();
    const mult = feverT > 0 ? 2 : 1;
    score += (base + combo * 2) * mult;

    const p = enemyPos(e, now);
    const col = e.track === 'G' ? '#b48ae8' : '#ffc94d';
    burst(p.x, p.y, col, 14);
    addFloat(judge, p.x, p.y - 60, judge === 'PERFECT' ? '#ffd23e' : judge === 'GREAT' ? '#7ee787' : '#6ec6ff', judge === 'PERFECT' ? 30 : 24);
    AudioSys.sfxHit(judge);

    if (e.groupId != null) {
      const group = enemies.filter(o => o.groupId === e.groupId);
      if (group.every(o => o.state === 'killed')) {
        score += 500 * mult;
        addFloat('完美连斩! +' + 500 * mult, PLAYER_X + 200, p.y - 110, '#ffd23e', 26);
      }
    }
  }
  function onMiss(e, now) {
    counts.miss++;
    combo = 0;
    hp = Math.max(0, hp - 14);
    shake = 0.35; redFlash = 0.3; player.hurtT = 0.5;
    addFloat('MISS!', PLAYER_X + 120, 300, '#ff5c5c', 30);
    AudioSys.sfxHurt();
    if (hp <= 0) gameOver(false);
  }

  // ---------- 特效 ----------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(80, 340);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: rand(2.5, 6), life: rand(0.35, 0.7), t: 0, color });
    }
  }
  const rand = (a, b) => a + Math.random() * (b - a);
  function addFloat(text, x, y, color, size) {
    floats.push({ text, x, y, color, size, t: 0 });
  }
  function sparkle(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU, sp = rand(40, 160);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1.5, 3.5), life: rand(0.25, 0.5), t: 0, color: '#ffd23e' });
    }
  }

  // ---------- 更新 ----------
  function update(dt) {
    const now = songNow();

    // 漏怪检查
    for (const e of enemies) {
      if (e.state === 'live' && now - e.time > HIT_WINDOW) {
        e.state = 'missed'; e.fallT = 0;
        e.missX = PLAYER_X + (e.time - now) * song.speed;
        if (e.groupId == null) onMiss(e, now);
        else if (!chainMissed.has(e.groupId)) { chainMissed.add(e.groupId); onMiss(e, now); }
      }
      if (e.state === 'missed') e.fallT += dt;
    }

    // 糖果：路过自动收集
    for (const c of candies) {
      if (c.done) continue;
      const dtc = now - c.time;
      if (Math.abs(dtc) <= 0.13) {
        c.done = true;
        score += 50 * (feverT > 0 ? 2 : 1);
        const y = c.track === 'G' ? GROUND_Y - 50 : AIR_Y;
        sparkle(PLAYER_X + 40, y);
        if (Math.random() < 0.4) AudioSys.sfxCandy();
      } else if (dtc > 0.13) c.done = true;
    }

    // 玩家动作计时
    if (player.actT > 0) player.actT -= dt;
    if (player.hurtT > 0) player.hurtT -= dt;
    for (const s of slashes) s.t += dt;
    slashes = slashes.filter(s => s.t < 0.22);

    // FEVER
    if (feverT > 0) { feverT -= dt; if (feverT <= 0) feverT = 0; }
    else if (fever >= 100) {
      fever = 0; feverT = 10;
      AudioSys.sfxFever();
      addFloat('FEVER TIME!!', W / 2, 200, '#ffd23e', 52);
      burst(W / 2, 210, '#ffd23e', 30);
    }
    fever = Math.min(100, fever);

    // 粒子与浮字
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; }
    particles = particles.filter(p => p.t < p.life);
    for (const f of floats) f.t += dt;
    floats = floats.filter(f => f.t < 0.9);

    if (shake > 0) shake = Math.max(0, shake - dt);
    if (redFlash > 0) redFlash = Math.max(0, redFlash - dt);

    // 分数滚动
    displayScore += (score - displayScore) * Math.min(1, dt * 10);
    if (Math.abs(score - displayScore) < 1) displayScore = score;

    // 结束判定
    if (now > song.lastTime + 2) gameOver(true);
  }

  function gameOver(clear) {
    if (state !== 'playing') return;
    state = 'result';
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    const acc = total ? (counts.perfect + counts.great * 0.7 + counts.good * 0.4) / total : 0;
    const rank = !clear ? 'D'
      : acc >= 0.95 ? 'S' : acc >= 0.88 ? 'A' : acc >= 0.75 ? 'B' : acc >= 0.6 ? 'C' : 'D';
    const bestKey = 'mushdash_best_' + diffKey;
    const prevBest = +(localStorage.getItem(bestKey) || 0);
    const isRecord = clear && score > prevBest;
    if (isRecord) localStorage.setItem(bestKey, String(score));
    resultInfo = { clear, rank, acc, isRecord };

    if (clear) AudioSys.sfxClear(); else AudioSys.stopSong();

    $('resultTitle').textContent = clear ? 'CLEAR!' : 'FAILED…';
    $('resultTitle').style.color = clear ? '#7ee787' : '#ff5c5c';
    $('rankBadge').textContent = rank;
    $('rankBadge').style.background = rank === 'S' ? 'linear-gradient(160deg,#ffd23e,#ff9a1f)'
      : rank === 'A' ? 'linear-gradient(160deg,#ff8a5c,#ff4d7e)'
      : rank === 'B' ? 'linear-gradient(160deg,#6ec6ff,#4d7eff)'
      : 'linear-gradient(160deg,#b8a6d9,#8a72b8)';
    $('finalScore').textContent = String(score);
    $('stP').textContent = counts.perfect;
    $('stG').textContent = counts.great;
    $('stO').textContent = counts.good;
    $('stM').textContent = counts.miss;
    $('stC').textContent = maxCombo;
    $('stA').textContent = Math.round(acc * 100) + '%';
    $('newRecord').classList.toggle('hidden', !isRecord);
    setTimeout(() => { if (state === 'result') screens.result.classList.remove('hidden'); }, 500);
  }

  // ---------- 背景绘制 ----------
  function drawBackground(t, feverMix) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixColor('#ffd9ec', '#ffdf9e', feverMix));
    g.addColorStop(1, mixColor('#bfeaff', '#ff9d76', feverMix));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 太阳
    ctx.fillStyle = mixColor('#fff7d6', '#fffbe0', feverMix);
    ctx.beginPath(); ctx.arc(1020, 130, 58, 0, TAU); ctx.fill();

    // 云（视差）
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) {
      const spd = 14 + i * 7;
      const cx = ((900 - t * spd + i * 430) % (W + 320) + W + 320) % (W + 320) - 160;
      const cy = 90 + (i % 2) * 70;
      cloud(cx, cy, 34 + (i % 3) * 12);
    }

    // 远山两层
    mountains(t * 18, H - 230, 60, '#d9bde8');
    mountains(t * 34, H - 190, 44, '#c4a3dd');

    // 蘑菇树（中景视差）
    const treeSpd = 70;
    for (let i = 0; i < 3; i++) {
      const period = 560;
      const x = ((i * 300 + 120 - t * treeSpd) % (W + period) + W + period) % (W + period) - 200;
      mushTree(x, GROUND_Y + 42, 0.7 + (i % 3) * 0.25, i % 2 ? '#ff9fbf' : '#c9a7e8');
    }

    // 地面
    ctx.fillStyle = '#c7935f';
    ctx.fillRect(0, GROUND_Y + 40, W, H - GROUND_Y - 40);
    ctx.fillStyle = '#b07f4d';
    for (let i = 0; i < 9; i++) {
      const x = ((i * 170 - t * 240) % (W + 170) + W + 170) % (W + 170) - 85;
      ctx.fillRect(x, GROUND_Y + 88, 70, 14);
    }
    ctx.fillStyle = mixColor('#7ed67e', '#ffcf5e', feverMix);
    ctx.fillRect(0, GROUND_Y + 28, W, 26);
    ctx.fillStyle = mixColor('#98e58a', '#ffe58a', feverMix);
    ctx.fillRect(0, GROUND_Y + 28, W, 10);

    // 草丛点缀
    ctx.fillStyle = mixColor('#6cc46c', '#e8b84d', feverMix);
    for (let i = 0; i < 12; i++) {
      const x = ((i * 127 - t * 240) % (W + 100) + W + 100) % (W + 100) - 50;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 32);
      ctx.lineTo(x + 7, GROUND_Y + 12);
      ctx.lineTo(x + 14, GROUND_Y + 32);
      ctx.fill();
    }

    // FEVER 氛围罩
    if (feverMix > 0) {
      ctx.fillStyle = `rgba(255,180,60,${feverMix * 0.12})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.arc(x + r * 0.9, y + 6, r * 0.7, 0, TAU);
    ctx.arc(x - r * 0.9, y + 8, r * 0.65, 0, TAU);
    ctx.fill();
  }
  function mountains(off, baseY, amp, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) {
      const y = baseY - Math.abs(Math.sin((x + off) * 0.004)) * amp - Math.sin((x + off) * 0.013) * 14;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
  function mushTree(x, baseY, s, capColor) {
    ctx.fillStyle = '#fff1f4';
    rrect(ctx, x - 13 * s, baseY - 110 * s, 26 * s, 110 * s, 10 * s);
    ctx.fill();
    ctx.fillStyle = capColor;
    ctx.beginPath();
    ctx.arc(x, baseY - 108 * s, 62 * s, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(x - 20 * s, baseY - 132 * s, 9 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 22 * s, baseY - 122 * s, 6 * s, 0, TAU); ctx.fill();
  }

  // ---------- 角色绘制 ----------
  function drawPlayer(t) {
    const px = PLAYER_X;
    let py = GROUND_Y;
    const attacking = player.actT > 0;
    const ph = attacking ? 1 - player.actT / ACT_DUR : 0;

    if (!attacking) py -= Math.abs(Math.sin(t * 9)) * 7;                 // 奔跑弹跳
    if (attacking && player.actTrack === 'A') py -= Math.sin(ph * Math.PI) * 64;  // 跳劈弧线

    const hurtBlink = player.hurtT > 0 && Math.floor(player.hurtT * 18) % 2 === 0;
    ctx.save();
    ctx.translate(px, py);
    if (hurtBlink) ctx.globalAlpha = 0.45;
    const dir = attacking && player.actTrack === 'G' ? 1 : 0;
    if (dir) ctx.rotate(lerp(0, 0.22, Math.sin(ph * Math.PI)));

    const legSw = attacking ? 0 : Math.sin(t * 13) * 9;
    // 腿
    ctx.strokeStyle = '#ffcfb0'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -34); ctx.lineTo(-6 + legSw, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -34); ctx.lineTo(7 - legSw, -2); ctx.stroke();
    // 靴子
    ctx.fillStyle = '#e8447a';
    ctx.beginPath(); ctx.ellipse(-6 + legSw, -2, 8, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7 - legSw, -2, 8, 5, 0, 0, TAU); ctx.fill();
    // 裙子
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-20, -36); ctx.quadraticCurveTo(0, -46, 20, -36);
    ctx.lineTo(13, -66); ctx.quadraticCurveTo(0, -72, -13, -66);
    ctx.closePath(); ctx.fill();
    // 脸
    ctx.fillStyle = '#ffe9dc';
    ctx.beginPath(); ctx.arc(0, -84, 22, 0, TAU); ctx.fill();
    // 眼睛（会眨）
    const blinkOn = (t % 3.4) > 3.25;
    ctx.fillStyle = '#3a2340';
    if (blinkOn) {
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#3a2340';
      ctx.beginPath(); ctx.moveTo(-12, -86); ctx.lineTo(-5, -86); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, -86); ctx.lineTo(12, -86); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(-8, -86, 3.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(8, -86, 3.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-7, -87.5, 1.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -87.5, 1.4, 0, TAU); ctx.fill();
    }
    // 腮红
    ctx.fillStyle = 'rgba(255,140,160,0.65)';
    ctx.beginPath(); ctx.arc(-15, -79, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(15, -79, 4, 0, TAU); ctx.fill();
    // 蘑菇帽
    ctx.fillStyle = '#ff5f6d';
    ctx.beginPath();
    ctx.arc(0, -96, 30, Math.PI, 0);
    ctx.quadraticCurveTo(0, -86, -30, -96);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-12, -110, 5.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -114, 4.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(20, -102, 3.4, 0, TAU); ctx.fill();

    // 魔法棒
    let ang = 0.6;                                   // 默认斜握
    if (attacking) ang = player.actTrack === 'A' ? lerp(2.4, -0.9, ph) : lerp(-0.4, 1.9, ph);
    ctx.save();
    ctx.translate(18, -60);
    ctx.rotate(ang);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(38, 0); ctx.stroke();
    drawStar(ctx, 44, 0, 11, t * 3, '#ffd76e', '#e8a01f');
    ctx.restore();

    ctx.restore();
  }

  // ---------- 敌人绘制 ----------
  function drawEnemies(now) {
    // 连打链：先画存活珠子间的连线
    const byGroup = new Map();
    for (const e of enemies) {
      if (e.groupId == null || e.state !== 'live') continue;
      if (!byGroup.has(e.groupId)) byGroup.set(e.groupId, []);
      byGroup.get(e.groupId).push(e);
    }
    ctx.strokeStyle = 'rgba(92,196,106,0.65)'; ctx.lineWidth = 5;
    for (const list of byGroup.values()) {
      list.sort((a, b) => b.time - a.time);            // x 大（远）在前
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const p = enemyPos(list[i], now);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    for (const e of enemies) {
      const p = enemyPos(e, now);
      if (p.x > W + 80 || p.x < -80) continue;
      if (e.state === 'killed') continue;

      let x = p.x, y = p.y, alpha = 1;
      if (e.state === 'missed') {
        y += e.fallT * e.fallT * 900;
        alpha = Math.max(0, 1 - e.fallT * 2);
        if (alpha <= 0) continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      if (e.kind === 'chain') drawBead(x, y, now, e);
      else if (e.track === 'G') drawGrumpy(x, y, now, e, e.state === 'missed');
      else drawSporefly(x, y, now, e, e.state === 'missed');
      ctx.restore();
    }
  }
  function drawGrumpy(x, y, now, e, dead) {
    const hop = e.state === 'live' ? Math.abs(Math.sin(now * 9 + e.id * 1.7)) * 10 : 0;
    y -= hop;
    ctx.fillStyle = '#7c4dc4';                                     // 菌盖
    ctx.beginPath(); ctx.arc(x, y - 26, 26, Math.PI, 0); ctx.quadraticCurveTo(x, y - 18, x - 26, y - 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9b6bd6';
    ctx.beginPath(); ctx.arc(x, y - 26, 26, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8d9ff';
    ctx.beginPath(); ctx.arc(x - 10, y - 36, 4.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 12, y - 32, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff5e0';                                     // 脸
    ctx.beginPath(); ctx.arc(x, y - 12, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (dead) {                                                     // X 眼
      ctx.beginPath(); ctx.moveTo(x - 10, y - 18); ctx.lineTo(x - 3, y - 11); ctx.moveTo(x - 3, y - 18); ctx.lineTo(x - 10, y - 11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 18); ctx.lineTo(x + 10, y - 11); ctx.moveTo(x + 10, y - 18); ctx.lineTo(x + 3, y - 11); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x - 11, y - 19); ctx.lineTo(x - 3, y - 16); ctx.stroke();   // 皱眉
      ctx.beginPath(); ctx.moveTo(x + 11, y - 19); ctx.lineTo(x + 3, y - 16); ctx.stroke();
      ctx.fillStyle = '#3a2340';
      ctx.beginPath(); ctx.arc(x - 6, y - 11, 2.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 6, y - 11, 2.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 4, 3.4, 0, Math.PI); ctx.stroke();                     // 撇嘴
    }
    ctx.fillStyle = '#7c4dc4';                                      // 小脚
    ctx.beginPath(); ctx.ellipse(x - 8, y + 2, 7, 4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 8, y + 2, 7, 4, 0, 0, TAU); ctx.fill();
  }
  function drawSporefly(x, y, now, e, dead) {
    y += Math.sin(now * 6 + e.id * 2.1) * 12;
    const wing = Math.sin(now * 40 + e.id) * 0.7;
    ctx.fillStyle = 'rgba(200,230,255,0.75)';
    ctx.save(); ctx.translate(x - 6, y - 22); ctx.rotate(-0.5 + wing);
    ctx.beginPath(); ctx.ellipse(0, -10, 7, 16, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x + 6, y - 22); ctx.rotate(0.5 - wing);
    ctx.beginPath(); ctx.ellipse(0, -10, 7, 16, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e8960f';
    ctx.beginPath(); ctx.arc(x, y - 20, 22, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb531';
    ctx.beginPath(); ctx.arc(x, y - 20, 22, Math.PI, 0); ctx.closePath();
    ctx.lineTo(x, y - 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff5e0';
    ctx.beginPath(); ctx.arc(x - 9, y - 30, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 8, y - 27, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff5e0';
    ctx.beginPath(); ctx.arc(x, y - 8, 13, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (dead) {
      ctx.beginPath(); ctx.moveTo(x - 8, y - 12); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x - 2, y - 12); ctx.lineTo(x - 8, y - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 2, y - 12); ctx.lineTo(x + 8, y - 6); ctx.moveTo(x + 8, y - 12); ctx.lineTo(x + 2, y - 6); ctx.stroke();
    } else {
      ctx.fillStyle = '#3a2340';
      ctx.beginPath(); ctx.arc(x - 5, y - 9, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 5, y - 9, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 3, 3, 0, Math.PI); ctx.stroke();
    }
  }
  function drawBead(x, y, now, e) {
    const bob = Math.sin(now * 8 + e.id) * 3;
    y -= bob;
    ctx.strokeStyle = '#3a9c4a'; ctx.lineWidth = 3;                 // 叶子
    ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.quadraticCurveTo(x + 12, y - 24, x + 20, y - 18); ctx.stroke();
    ctx.fillStyle = '#5cc46a';
    ctx.beginPath(); ctx.arc(x, y, 17, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8fe89a';
    ctx.beginPath(); ctx.arc(x - 5, y - 6, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c7a3a';
    ctx.beginPath(); ctx.arc(x - 4, y + 2, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y + 2, 2.4, 0, TAU); ctx.fill();
  }

  // ---------- 其它绘制 ----------
  function drawCandies(now) {
    for (const c of candies) {
      if (c.done) continue;
      const x = PLAYER_X + (c.time - now) * song.speed;
      if (x > W + 40 || x < -40) continue;
      const y = (c.track === 'G' ? GROUND_Y - 50 : AIR_Y) + Math.sin(now * 5 + c.time * 7) * 6;
      const glow = 0.7 + Math.sin(now * 7 + c.time * 3) * 0.3;
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = 'rgba(255,210,62,0.3)';
      ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
      drawStar(ctx, x, y, 13, now * 2.5, '#ffd23e', '#e8a01f');
      ctx.restore();
    }
  }
  function drawSlashes() {
    for (const s of slashes) {
      const ph = s.t / 0.22;
      const y = s.track === 'G' ? GROUND_Y - 12 : AIR_Y;
      ctx.save();
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lerp(14, 3, ph);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(PLAYER_X + 46, y, 62, -1.5 + ph * 0.7, 0.9 + ph * 0.7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,220,255,0.8)';
      ctx.lineWidth = lerp(6, 1.5, ph);
      ctx.beginPath();
      ctx.arc(PLAYER_X + 46, y, 74, -1.3 + ph * 0.7, 0.7 + ph * 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawParticlesFloats() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const f of floats) {
      const ph = f.t / 0.9;
      ctx.globalAlpha = ph < 0.7 ? 1 : (1 - ph) / 0.3;
      strokeText(ctx, f.text, f.x, f.y - ph * 46, f.size, f.color);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------
  function drawHUD(now) {
    // 进度条
    const prog = clamp(now / (song.lastTime + 0.01), 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rrect(ctx, W / 2 - 200, 10, 400, 7, 4); ctx.fill();
    ctx.fillStyle = '#fff';
    rrect(ctx, W / 2 - 200, 10, 400 * prog, 7, 4); ctx.fill();

    // 分数
    strokeText(ctx, String(Math.round(displayScore)).padStart(7, '0'), 40, 44, 38, '#fff', 'left');
    if (feverT > 0) strokeText(ctx, 'x2', 210, 58, 24, '#ffd23e', 'left');

    // 血条
    const bw = 300, bx = W / 2 - bw / 2, by = 32;
    ctx.save();
    ctx.translate(bx - 34, by + 12);
    ctx.scale(hp < 30 ? 1 + Math.sin(perfT * 9) * 0.12 : 1, hp < 30 ? 1 + Math.sin(perfT * 9) * 0.12 : 1);
    ctx.fillStyle = '#ff5f6d';
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(0, -6, -16, -6, -16, 4);
    ctx.bezierCurveTo(-16, 12, 0, 18, 0, 24);
    ctx.bezierCurveTo(0, 18, 16, 12, 16, 4);
    ctx.bezierCurveTo(16, -6, 0, -6, 0, 4);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(30,10,40,0.45)';
    rrect(ctx, bx, by, bw, 18, 9); ctx.fill();
    const hpr = hp / 100;
    ctx.fillStyle = hpr > 0.5 ? '#7ee787' : hpr > 0.25 ? '#ffd23e' : (Math.floor(perfT * 6) % 2 ? '#ff5c5c' : '#ffb3b3');
    rrect(ctx, bx + 3, by + 3, (bw - 6) * hpr, 12, 6); ctx.fill();

    // FEVER 槽
    const fw = 180, fx = W - fw - 30, fy = 30;
    strokeText(ctx, 'FEVER', fx + fw / 2, fy - 14, 17, feverT > 0 ? '#ffd23e' : '#ffe9a8');
    ctx.fillStyle = 'rgba(30,10,40,0.45)';
    rrect(ctx, fx, fy, fw, 16, 8); ctx.fill();
    const g2 = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    g2.addColorStop(0, '#ffd23e'); g2.addColorStop(1, '#ff8a3c');
    ctx.fillStyle = g2;
    rrect(ctx, fx + 3, fy + 3, (fw - 6) * (feverT > 0 ? 1 : fever / 100), 10, 5); ctx.fill();
    if (feverT > 0 && Math.floor(perfT * 5) % 2) strokeText(ctx, 'FEVER!!', fx + fw / 2, fy + 42, 26, '#ffd23e');

    // COMBO
    if (combo >= 5) {
      const pop = clamp(1 - comboPopT / 0.18, 0, 1);
      const sc = 1 + pop * 0.35;
      ctx.save();
      ctx.translate(W / 2, 208);
      ctx.scale(sc, sc);
      ctx.rotate(Math.sin(pop * Math.PI) * 0.05);
      strokeText(ctx, String(combo), 0, 0, 76, '#fff');
      strokeText(ctx, 'COMBO', 0, 52, 22, '#ffd9ec');
      ctx.restore();
    }

    // 开场倒计时
    if (now < 0) {
      const n = Math.ceil(-now);
      strokeText(ctx, n > 0 ? String(n) : 'GO!', W / 2, H / 2 - 40, n > 0 ? 110 : 130, '#fff');
      strokeText(ctx, 'READY?', W / 2, H / 2 + 46, 34, '#ffd9ec');
    }
  }
  let comboPopT = 1;
  let lastCombo = 0;

  // ---------- 渲染主入口 ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const inGame = state === 'playing' || state === 'paused' || state === 'result';
    const t = inGame ? Math.max(0, songNow()) : perfT;
    const feverMix = feverT > 0 ? clamp(Math.min((10 - feverT) * 5, feverT), 0, 1) : 0;

    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 24, rand(-1, 1) * shake * 24);

    drawBackground(t, feverMix);
    if (inGame && song) {
      const now = songNow();
      drawCandies(now);
      drawEnemies(now);
      drawSlashes();
      drawPlayer(t);
      drawParticlesFloats();
      drawHUD(now);
    } else {
      drawPlayer(perfT);
    }

    if (redFlash > 0) {
      ctx.fillStyle = `rgba(255,40,80,${redFlash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---------- 主循环 ----------
  let lastTs = 0;
  function step(dt) {
    perfT += dt;
    comboPopT += dt;
    if (combo !== lastCombo) { comboPopT = 0; lastCombo = combo; }
    if (state === 'playing') update(dt);
    render();
  }
  function frame(ts) {
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;
    step(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 切到后台时自动暂停，避免回来时音乐已前进、被成批漏怪打死
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPause(true);
  });

  // ---------- 暂停 ----------
  function setPause(on) {
    if (on && state === 'playing') {
      state = 'paused';
      screens.pause.classList.remove('hidden');
      AudioSys.suspend();
    } else if (!on && state === 'paused') {
      state = 'playing';
      screens.pause.classList.add('hidden');
      AudioSys.resume();
      AudioSys.sfxUI();
    }
  }

  // ---------- 输入 ----------
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.code;
    if (k === 'Escape' || k === 'KeyP') { setPause(state === 'playing'); return; }
    if (state !== 'playing') {
      if (k === 'Enter' && state === 'title') startGame();
      if (k === 'KeyR' && state === 'result') startGame();
      return;
    }
    switch (k) {
      case 'ArrowLeft': case 'KeyA': case 'KeyF': case 'ArrowUp': case 'KeyW':
        attack('A'); e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': case 'KeyJ': case 'ArrowDown': case 'KeyS':
        attack('G'); e.preventDefault(); break;
    }
  });
  // 触屏：左半屏打空中，右半屏打地面
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (state !== 'playing') return;
    for (const tch of e.changedTouches) {
      const rect = canvas.getBoundingClientRect();
      const x = (tch.clientX - rect.left) / rect.width * W;
      attack(x < W / 2 ? 'A' : 'G');
    }
  }, { passive: false });

  // ---------- 菜单 ----------
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      diffKey = btn.dataset.diff;
      updateBestLine();
      AudioSys.ensure(); AudioSys.sfxUI();
    });
  });
  function updateBestLine() {
    const best = +(localStorage.getItem('mushdash_best_' + diffKey) || 0);
    $('bestLine').textContent = best > 0
      ? `🏆 ${Chart.DIFFS[diffKey].label}难度最高分：${best}`
      : '还没有纪录，来创造第一个吧！';
  }
  updateBestLine();

  $('startBtn').addEventListener('click', () => { startGame(); $('startBtn').blur(); });
  $('resumeBtn').addEventListener('click', () => setPause(false));
  $('restartBtn').addEventListener('click', () => { AudioSys.resume(); startGame(); });
  $('quitBtn').addEventListener('click', () => {
    AudioSys.resume(); AudioSys.stopSong(); AudioSys.sfxUI();
    state = 'title';
    screens.pause.classList.add('hidden');
    screens.title.classList.remove('hidden');
    updateBestLine();
  });
  $('retryBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', () => {
    state = 'title';
    screens.result.classList.add('hidden');
    screens.title.classList.remove('hidden');
    updateBestLine();
    AudioSys.sfxUI();
  });
  $('muteBtn').addEventListener('click', () => {
    const btn = $('muteBtn');
    const toMute = btn.textContent === '🔊';
    btn.textContent = toMute ? '🔇' : '🔊';
    AudioSys.setMuted(toMute);
  });

  // 自动化测试钩子：手动驱动帧循环 / 只读状态快照（正常游玩不依赖）
  window.__mushdash = {
    step(dt = 1 / 60, withRender = true) {
      perfT += clamp(dt, 0, 0.05);
      comboPopT += dt;
      if (combo !== lastCombo) { comboPopT = 0; lastCombo = combo; }
      if (state === 'playing') update(clamp(dt, 0, 0.05));
      if (withRender) render();
    },
    info() {
      return {
        state, combo, maxCombo, fever: Math.round(fever), feverT, hp: Math.round(hp),
        score, songT: songNow(), counts: { ...counts },
      };
    },
    nearest() {
      const now = songNow();
      let best = null;
      for (const e of enemies) {
        if (e.state !== 'live') continue;
        const d = e.time - now;
        if (d < -HIT_WINDOW) continue;
        if (!best || d < best.dt) best = { track: e.track, dt: d };
      }
      return best;
    },
  };
})();
