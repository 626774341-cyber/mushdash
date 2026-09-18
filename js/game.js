'use strict';
/* ============================================================
 * MushDash 主逻辑
 * 流程：标题 → 大厅（选曲 / 选角色 / 难度 / 偏移校准）→ 游戏 → 结算
 * ←/A/F 跳劈空中敌人，→/D/J 下斩地面敌人；PERFECT/GREAT/GOOD
 * 三档判定，漏怪掉血，攒满热情槽进入 FEVER 双倍得分。
 * ============================================================ */
(() => {
  // ---------- 常量 ----------
  const W = 1280, H = 720;
  const PLAYER_X = 260, GROUND_Y = 556, AIR_Y = 366;
  const HIT_WINDOW = 0.15, PERFECT_WIN = 0.055, GREAT_WIN = 0.105;
  const ACT_DUR = 0.28;

  // ---------- 角色 ----------
  const CHARACTERS = [
    {
      id: 'popo', name: '波波', title: '元气蘑菇',
      trait: '生命 100 · 各项均衡，安稳上手',
      hp: 100, feverGain: 1, candyMult: 1, missDmg: 14,
      cap: '#ff5f6d', capDot: '#ffffff', dress: '#ffffff',
      boot: '#e8447a', skin: '#ffe9dc', blush: 'rgba(255,140,160,0.65)',
    },
    {
      id: 'berry', name: '蓝莓', title: '星光法师',
      trait: '生命 80 · Fever 积攒 +40%，糖果双倍',
      hp: 80, feverGain: 1.4, candyMult: 2, missDmg: 14,
      cap: '#4d7eff', capDot: '#dff0ff', dress: '#dce8ff',
      boot: '#2c5ecc', skin: '#ffe9dc', blush: 'rgba(120,160,255,0.6)',
    },
    {
      id: 'rocky', name: '岩岩', title: '坚壁卫士',
      trait: '生命 130 · 漏怪伤害减半，Fever −20%',
      hp: 130, feverGain: 0.8, candyMult: 1, missDmg: 7,
      cap: '#8a9bb0', capDot: '#e8eef4', dress: '#c9b8a0',
      boot: '#5f6b7a', skin: '#f2e4d4', blush: 'rgba(200,160,120,0.5)',
    },
  ];
  const getChar = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR; canvas.height = H * DPR;
  const $ = id => document.getElementById(id);
  const screens = {
    title: $('titleScreen'), lobby: $('lobbyScreen'),
    pause: $('pauseScreen'), result: $('resultScreen'),
    versions: $('versionsScreen'),
  };

  // 页面错误收集，便于自动化测试
  window.__errors = [];
  window.addEventListener('error', e => window.__errors.push(String(e.message)));

  // ---------- 小工具 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
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
  const loadJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const bestKey = (songId, diff) => `mushdash_best_${songId}_${diff}`;
  const getBest = (songId, diff) => loadJSON(bestKey(songId, diff), null);

  // ---------- 版本记录 ----------
  const GAME_VERSION = '1.3.0';
  const REPO = 'https://github.com/626774341-cyber/mushdash';
  const VERSIONS = [
    {
      v: '1.3.0', date: '2026-09-18', name: '雾蓝夜话',
      link: './', commit: REPO + '/commit/08bfcd8',
      notes: [
        '新曲目「雾蓝 Swag」——SWAG 系列美学致敬：极简黑封面语言、雾蓝私密度假夜',
        'R&B 编曲引擎：808 长低音、摇摆 hi-hat、切分底鼓、激光合成器扫频',
        '92BPM 慢热谱面：敌人稀疏但节拍刁钻，「慢歌高精度」全新挑战维度',
      ],
    },
    {
      v: '1.2.1', date: '2026-09-18', name: '时光机',
      link: 'versions/v1.2.1/', commit: REPO + '/commit/6fc4d2f',
      notes: [
        '版本记录升级：每个版本都可以点击「玩这个版本」，回到当年的游戏',
        '历史版本源码归档进仓库（versions/ 目录），附 GitHub 源码快照链接',
      ],
    },
    {
      v: '1.2.0', date: '2026-09-18', name: '酸性绿入侵',
      link: 'versions/v1.2.0/', commit: REPO + '/commit/e2cb092',
      notes: [
        '编曲全面电子化：四踩底鼓、侧链泵感、酸性贝斯、失谐和声与主旋律回声',
        '新曲目「酸柠狂潮 Acid Lime」——酸性绿舞池主题，148BPM 洗脑 riff',
        '游戏内版本记录功能上线',
      ],
    },
    {
      v: '1.1.0', date: '2026-09-18', name: '演出大厅',
      link: 'versions/v1.1.0/', commit: REPO + '/commit/a1106b4',
      notes: [
        '新流程：选曲 × 角色 × 难度的大厅',
        '新角色 蓝莓（Fever 加成）与 岩岩（高血量减伤）',
        '判定偏移校准、每曲目×难度成绩存档、FULL COMBO 结算徽章',
        '曲目主题化场景（草原 / 黄昏 / 星夜）',
      ],
    },
    {
      v: '1.0.0', date: '2026-09-18', name: '蘑菇冲刺',
      link: 'versions/v1.0.0/', commit: REPO + '/commit/dc24396',
      notes: [
        '核心玩法：跳劈 / 下斩双轨道节奏跑酷',
        'PERFECT / GREAT / GOOD 三档判定，连击加成与 FEVER 系统',
        '曲目「霓虹疾走」，连打链与糖果收集',
      ],
    },
  ];
  function buildVersions() {
    const list = $('versionList');
    list.innerHTML = '';
    for (const ver of VERSIONS) {
      const card = document.createElement('div');
      card.className = 'ver-card' + (ver.v === GAME_VERSION ? ' latest' : '');
      const isCurrent = ver.v === GAME_VERSION;
      card.innerHTML = `
        <div class="ver-head">
          <span class="ver-badge">v${ver.v}</span>
          ${isCurrent ? '<span class="ver-date">当前版本</span>' : ''}
          <span class="ver-date">${ver.date}</span>
          <span class="ver-name">${ver.name}</span>
        </div>
        <ul class="ver-notes">${ver.notes.map(n => `<li>${n}</li>`).join('')}</ul>
        <div class="ver-links">
          <a class="ver-play" href="${ver.link}" target="_blank" rel="noopener">${isCurrent ? '▶ 玩当前版本' : '▶ 玩这个版本'}</a>
          <a class="ver-src" href="${ver.commit}" target="_blank" rel="noopener">源码快照 ↗</a>
        </div>`;
      list.appendChild(card);
    }
  }

  // ---------- 选择状态 ----------
  let songId = 'neon';
  let charId = 'popo';
  let diffKey = 'normal';
  let offsetMs = clamp(+(localStorage.getItem('mushdash_offset') || 0), -300, 300) || 0;

  // ---------- 游戏状态 ----------
  let state = 'title';            // title | lobby | playing | paused | result
  let song = null;                // 当前谱面
  let songDef = null;             // 当前曲目定义
  let charCfg = null;             // 当前角色
  let enemies = [], candies = [], particles = [], floats = [], slashes = [];
  let chainMissed = new Set();
  let score = 0, displayScore = 0, combo = 0, maxCombo = 0, hp = 100;
  let fever = 0, feverT = 0;
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let shake = 0, redFlash = 0;
  let perfT = 0;
  let curPalette = Chart.getSong(songId).palette;

  const player = { actTrack: null, actT: 0, hurtT: 0 };
  const songNow = () => AudioSys.songTime() + offsetMs / 1000;

  // ---------- 大厅 UI ----------
  function buildLobby() {
    const list = $('songList');
    list.innerHTML = '';
    for (const s of Chart.SONGS) {
      const card = document.createElement('button');
      card.className = 'song-card' + (s.id === songId ? ' selected' : '');
      card.innerHTML = `
        <div class="song-thumb" style="background:linear-gradient(150deg, ${s.palette.sky[0]}, ${s.palette.hillNear})">${s.emoji}</div>
        <div class="song-info">
          <div class="song-name">${s.name} <small style="opacity:.55;font-weight:600">${s.en}</small></div>
          <div class="song-sub">${s.desc} · ${s.bpm} BPM</div>
        </div>
        <div class="song-best">${bestLineHTML(s)}</div>`;
      card.addEventListener('click', () => {
        songId = s.id;
        AudioSys.ensure(); AudioSys.sfxUI();
        buildLobby();
      });
      list.appendChild(card);
    }

    const row = $('charRow');
    row.innerHTML = '';
    for (const c of CHARACTERS) {
      const card = document.createElement('button');
      card.className = 'char-card' + (c.id === charId ? ' selected' : '');
      card.innerHTML = `
        <div class="char-avatar" style="background:linear-gradient(160deg, ${c.cap} 46%, ${c.dress} 46%)"></div>
        <div class="char-name">${c.name}</div>
        <div class="char-title">${c.title}</div>
        <div class="char-trait">${c.trait}</div>`;
      card.addEventListener('click', () => {
        charId = c.id;
        AudioSys.ensure(); AudioSys.sfxUI();
        buildLobby();
      });
      row.appendChild(card);
    }

    document.querySelectorAll('#diffRow .diff-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.diff === diffKey);
    });

    $('offsetVal').textContent = (offsetMs > 0 ? '+' : '') + offsetMs + 'ms';
    const rec = $('records');
    rec.innerHTML = '';
    const best = getBest(songId, diffKey);
    const chip = document.createElement('span');
    if (best) {
      chip.className = 'record-chip';
      chip.textContent = `当前选择最佳：${best.rank} 级 · ${best.score} 分`;
    } else {
      chip.className = 'record-chip none';
      chip.textContent = '这首 × 这个难度还没有成绩';
    }
    rec.appendChild(chip);
  }
  function bestLineHTML(s) {
    const ranks = ['easy', 'normal', 'hard'].map(d => {
      const b = getBest(s.id, d);
      return b ? `<small>${Chart.DIFFS[d].label} ${b.rank}</small>` : '';
    }).filter(Boolean).join('');
    const top = getBest(s.id, diffKey);
    return (top ? `${top.rank} · ${top.score}<small>${Chart.DIFFS[diffKey].label}最佳</small>` : '') + ranks;
  }

  // ---------- 开局 ----------
  function startGame() {
    songDef = Chart.getSong(songId);
    charCfg = getChar(charId);
    curPalette = songDef.palette;
    AudioSys.ensure(); AudioSys.resumeCtx(); AudioSys.sfxUI();
    song = Chart.generate(songDef, diffKey);
    const spb = song.spb;
    enemies = song.events.map((ev, i) => ({
      id: i, time: ev.beat * spb, track: ev.track, kind: ev.kind,
      groupId: ev.groupId, state: 'live', fallT: 0, missX: 0,
    }));
    candies = song.candies.map(c => ({ time: c.beat * spb, track: c.track, done: false }));
    chainMissed = new Set();
    particles = []; floats = []; slashes = [];
    score = 0; displayScore = 0; combo = 0; maxCombo = 0;
    hp = charCfg.hp;
    fever = 0; feverT = 0;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    shake = 0; redFlash = 0;
    player.actT = 0; player.hurtT = 0;
    AudioSys.startSong(songDef, Chart.BARS * 16);
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
    if (!best) { emptySwing(track); return; }
    killEnemy(best, bestAbs, now);
  }
  function emptySwing(track) {
    if (combo > 0) addFloat('空挥!', PLAYER_X + 60, track === 'G' ? GROUND_Y - 90 : AIR_Y - 40, '#c9b8e8', 22);
    combo = 0;
    AudioSys.sfxSwing();
  }
  function killEnemy(e, ad, now) {
    e.state = 'killed';
    let judge, base;
    if (ad <= PERFECT_WIN)      { judge = 'PERFECT'; base = 300; counts.perfect++; fever += 4 * charCfg.feverGain; }
    else if (ad <= GREAT_WIN)   { judge = 'GREAT';   base = 200; counts.great++;   fever += 3 * charCfg.feverGain; }
    else                        { judge = 'GOOD';    base = 100; counts.good++;    fever += 2 * charCfg.feverGain; }
    combo++; maxCombo = Math.max(maxCombo, combo);
    if (combo > 0 && combo % 50 === 0) {
      hp = Math.min(charCfg.hp, hp + 4);
      addFloat('+4 ❤', PLAYER_X + 40, 250, '#7ee787', 26);
    }
    if (combo > 0 && combo % 25 === 0) AudioSys.sfxCombo();
    const mult = feverT > 0 ? 2 : 1;
    score += (base + combo * 2) * mult;

    const p = enemyPos(e, now);
    const col = e.track === 'G' ? '#b48ae8' : '#ffc94d';
    burst(p.x, p.y, col, 14);
    addFloat(judge, p.x, p.y - 60, judge === 'PERFECT' ? '#ffd23e' : judge === 'GREAT' ? '#7ee787' : '#6ec6ff', judge === 'PERFECT' ? 30 : 24);
    if (judge === 'PERFECT') shake = Math.max(shake, 0.06);
    AudioSys.sfxHit(judge);

    if (e.groupId != null) {
      const group = enemies.filter(o => o.groupId === e.groupId);
      if (group.every(o => o.state === 'killed')) {
        score += 500 * mult;
        addFloat('完美连斩! +' + 500 * mult, PLAYER_X + 200, p.y - 110, '#ffd23e', 26);
      }
    }
  }
  function onMiss(e) {
    counts.miss++;
    combo = 0;
    hp = Math.max(0, hp - charCfg.missDmg);
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

    for (const e of enemies) {
      if (e.state === 'live' && now - e.time > HIT_WINDOW) {
        e.state = 'missed'; e.fallT = 0;
        e.missX = PLAYER_X + (e.time - now) * song.speed;
        if (e.groupId == null) onMiss(e);
        else if (!chainMissed.has(e.groupId)) { chainMissed.add(e.groupId); onMiss(e); }
      }
      if (e.state === 'missed') e.fallT += dt;
    }

    for (const c of candies) {
      if (c.done) continue;
      const dtc = now - c.time;
      if (Math.abs(dtc) <= 0.13) {
        c.done = true;
        score += Math.round(50 * charCfg.candyMult) * (feverT > 0 ? 2 : 1);
        const y = c.track === 'G' ? GROUND_Y - 50 : AIR_Y;
        sparkle(PLAYER_X + 40, y);
        if (Math.random() < 0.4) AudioSys.sfxCandy();
      } else if (dtc > 0.13) c.done = true;
    }

    if (player.actT > 0) player.actT -= dt;
    if (player.hurtT > 0) player.hurtT -= dt;
    for (const s of slashes) s.t += dt;
    slashes = slashes.filter(s => s.t < 0.22);

    if (feverT > 0) { feverT -= dt; if (feverT <= 0) feverT = 0; }
    else if (fever >= 100) {
      fever = 0; feverT = 10;
      AudioSys.sfxFever();
      addFloat('FEVER TIME!!', W / 2, 200, '#ffd23e', 52);
      burst(W / 2, 210, '#ffd23e', 30);
    }
    fever = Math.min(100, fever);

    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; }
    particles = particles.filter(p => p.t < p.life);
    for (const f of floats) f.t += dt;
    floats = floats.filter(f => f.t < 0.9);

    if (shake > 0) shake = Math.max(0, shake - dt);
    if (redFlash > 0) redFlash = Math.max(0, redFlash - dt);

    displayScore += (score - displayScore) * Math.min(1, dt * 10);
    if (Math.abs(score - displayScore) < 1) displayScore = score;

    if (now > song.lastTime + 2) gameOver(true);
  }

  function gameOver(clear) {
    if (state !== 'playing') return;
    state = 'result';
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    const acc = total ? (counts.perfect + counts.great * 0.7 + counts.good * 0.4) / total : 0;
    const rank = !clear ? 'D'
      : acc >= 0.95 ? 'S' : acc >= 0.88 ? 'A' : acc >= 0.75 ? 'B' : acc >= 0.6 ? 'C' : 'D';
    const fullCombo = clear && counts.miss === 0;
    const prev = getBest(songId, diffKey);
    const isRecord = clear && (!prev || score > prev.score);
    if (clear) saveJSON(bestKey(songId, diffKey), {
      score: Math.max(score, prev ? prev.score : 0),
      rank: prev ? (rankOrder(rank) >= rankOrder(prev.rank) ? rank : prev.rank) : rank,
      maxCombo: Math.max(maxCombo, prev ? prev.maxCombo : 0),
    });
    resultInfo = { clear, rank, acc, isRecord, fullCombo };

    if (clear) AudioSys.sfxClear(); else AudioSys.stopSong();

    $('resultTitle').textContent = clear ? 'CLEAR!' : 'FAILED…';
    $('resultTitle').style.color = clear ? '#7ee787' : '#ff5c5c';
    $('resultMeta').textContent =
      `${songDef.name} · ${Chart.DIFFS[diffKey].label} ${diffKey.toUpperCase()} · ${charCfg.name}「${charCfg.title}」`;
    $('rankBadge').textContent = rank;
    $('rankBadge').style.background = rank === 'S' ? 'linear-gradient(160deg,#ffd23e,#ff9a1f)'
      : rank === 'A' ? 'linear-gradient(160deg,#ff8a5c,#ff4d7e)'
      : rank === 'B' ? 'linear-gradient(160deg,#6ec6ff,#4d7eff)'
      : 'linear-gradient(160deg,#b8a6d9,#8a72b8)';
    $('fcBadge').classList.toggle('hidden', !fullCombo);
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
  const rankOrder = r => ({ S: 4, A: 3, B: 2, C: 1, D: 0 })[r] ?? 0;
  let resultInfo = null;

  // ---------- 背景绘制（按曲目配色主题化） ----------
  function drawBackground(t, feverMix) {
    const P = curPalette;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixColor(P.sky[0], '#ffdf9e', feverMix * 0.85));
    g.addColorStop(1, mixColor(P.sky[1], '#ff9d76', feverMix * 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 太阳 / 月亮
    ctx.fillStyle = mixColor(P.sun, '#fffbe0', feverMix);
    ctx.beginPath(); ctx.arc(1020, 130, P.night ? 46 : 58, 0, TAU); ctx.fill();
    if (P.night) {
      ctx.fillStyle = mixColor(P.sky[0], '#ffdf9e', feverMix * 0.5);
      ctx.beginPath(); ctx.arc(1040, 118, 40, 0, TAU); ctx.fill();
      // 星星
      for (let i = 0; i < 26; i++) {
        const sx = (i * 491) % W, sy = 40 + (i * 173) % 300;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.4 + i * 1.9));
        ctx.globalAlpha = tw * (1 - feverMix * 0.4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, 2.4, 2.4);
      }
      ctx.globalAlpha = 1;
    }

    // 云
    ctx.fillStyle = `rgba(255,255,255,${P.cloudA})`;
    for (let i = 0; i < 4; i++) {
      const spd = 14 + i * 7;
      const cx = ((900 - t * spd + i * 430) % (W + 320) + W + 320) % (W + 320) - 160;
      const cy = 90 + (i % 2) * 70;
      cloud(cx, cy, 34 + (i % 3) * 12);
    }

    mountains(t * 18, H - 230, 60, mixColor(P.hillFar, '#ffcf5e', feverMix * 0.5));
    mountains(t * 34, H - 190, 44, mixColor(P.hillNear, '#ffb44d', feverMix * 0.5));

    const treeSpd = 70;
    for (let i = 0; i < 3; i++) {
      const period = 560;
      const x = ((i * 300 + 120 - t * treeSpd) % (W + period) + W + period) % (W + period) - 200;
      mushTree(x, GROUND_Y + 42, 0.7 + (i % 3) * 0.25, P.treeCap[i % 2], P.trunk);
    }

    ctx.fillStyle = P.dirt;
    ctx.fillRect(0, GROUND_Y + 40, W, H - GROUND_Y - 40);
    ctx.fillStyle = P.dirtDark;
    for (let i = 0; i < 9; i++) {
      const x = ((i * 170 - t * 240) % (W + 170) + W + 170) % (W + 170) - 85;
      ctx.fillRect(x, GROUND_Y + 88, 70, 14);
    }
    ctx.fillStyle = mixColor(P.grass, '#ffcf5e', feverMix);
    ctx.fillRect(0, GROUND_Y + 28, W, 26);
    ctx.fillStyle = mixColor(P.grassLit, '#ffe58a', feverMix);
    ctx.fillRect(0, GROUND_Y + 28, W, 10);

    ctx.fillStyle = mixColor(P.grassDark, '#e8b84d', feverMix);
    for (let i = 0; i < 12; i++) {
      const x = ((i * 127 - t * 240) % (W + 100) + W + 100) % (W + 100) - 50;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 32);
      ctx.lineTo(x + 7, GROUND_Y + 12);
      ctx.lineTo(x + 14, GROUND_Y + 32);
      ctx.fill();
    }

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
  function mushTree(x, baseY, s, capColor, trunkColor) {
    ctx.fillStyle = trunkColor;
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
    const C = charCfg || CHARACTERS[0];
    const px = PLAYER_X;
    let py = GROUND_Y;
    const attacking = player.actT > 0;
    const ph = attacking ? 1 - player.actT / ACT_DUR : 0;

    if (!attacking) py -= Math.abs(Math.sin(t * 9)) * 7;
    if (attacking && player.actTrack === 'A') py -= Math.sin(ph * Math.PI) * 64;

    const hurtBlink = player.hurtT > 0 && Math.floor(player.hurtT * 18) % 2 === 0;
    ctx.save();
    ctx.translate(px, py);
    if (hurtBlink) ctx.globalAlpha = 0.45;
    const dir = attacking && player.actTrack === 'G' ? 1 : 0;
    if (dir) ctx.rotate(lerp(0, 0.22, Math.sin(ph * Math.PI)));

    const legSw = attacking ? 0 : Math.sin(t * 13) * 9;
    ctx.strokeStyle = C.skin; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -34); ctx.lineTo(-6 + legSw, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -34); ctx.lineTo(7 - legSw, -2); ctx.stroke();
    ctx.fillStyle = C.boot;
    ctx.beginPath(); ctx.ellipse(-6 + legSw, -2, 8, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7 - legSw, -2, 8, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = C.dress;
    ctx.beginPath();
    ctx.moveTo(-20, -36); ctx.quadraticCurveTo(0, -46, 20, -36);
    ctx.lineTo(13, -66); ctx.quadraticCurveTo(0, -72, -13, -66);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(0, -84, 22, 0, TAU); ctx.fill();
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
    ctx.fillStyle = C.blush;
    ctx.beginPath(); ctx.arc(-15, -79, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(15, -79, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = C.cap;
    ctx.beginPath();
    ctx.arc(0, -96, 30, Math.PI, 0);
    ctx.quadraticCurveTo(0, -86, -30, -96);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.capDot;
    ctx.beginPath(); ctx.arc(-12, -110, 5.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -114, 4.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(20, -102, 3.4, 0, TAU); ctx.fill();

    let ang = 0.6;
    if (attacking) ang = player.actTrack === 'A' ? lerp(2.4, -0.9, ph) : lerp(-0.4, 1.9, ph);
    ctx.save();
    ctx.translate(18, -60);
    ctx.rotate(ang);
    ctx.strokeStyle = C.dress === '#ffffff' ? '#fff' : C.dress; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(38, 0); ctx.stroke();
    drawStar(ctx, 44, 0, 11, t * 3, '#ffd76e', '#e8a01f');
    ctx.restore();

    ctx.restore();
  }

  // ---------- 敌人绘制 ----------
  function drawEnemies(now) {
    const byGroup = new Map();
    for (const e of enemies) {
      if (e.groupId == null || e.state !== 'live') continue;
      if (!byGroup.has(e.groupId)) byGroup.set(e.groupId, []);
      byGroup.get(e.groupId).push(e);
    }
    ctx.strokeStyle = 'rgba(92,196,106,0.65)'; ctx.lineWidth = 5;
    for (const list of byGroup.values()) {
      list.sort((a, b) => b.time - a.time);
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
    ctx.fillStyle = '#7c4dc4';
    ctx.beginPath(); ctx.arc(x, y - 26, 26, Math.PI, 0); ctx.quadraticCurveTo(x, y - 18, x - 26, y - 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9b6bd6';
    ctx.beginPath(); ctx.arc(x, y - 26, 26, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8d9ff';
    ctx.beginPath(); ctx.arc(x - 10, y - 36, 4.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 12, y - 32, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff5e0';
    ctx.beginPath(); ctx.arc(x, y - 12, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (dead) {
      ctx.beginPath(); ctx.moveTo(x - 10, y - 18); ctx.lineTo(x - 3, y - 11); ctx.moveTo(x - 3, y - 18); ctx.lineTo(x - 10, y - 11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 18); ctx.lineTo(x + 10, y - 11); ctx.moveTo(x + 10, y - 18); ctx.lineTo(x + 3, y - 11); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x - 11, y - 19); ctx.lineTo(x - 3, y - 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 11, y - 19); ctx.lineTo(x + 3, y - 16); ctx.stroke();
      ctx.fillStyle = '#3a2340';
      ctx.beginPath(); ctx.arc(x - 6, y - 11, 2.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 6, y - 11, 2.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 4, 3.4, 0, Math.PI); ctx.stroke();
    }
    ctx.fillStyle = '#7c4dc4';
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
    ctx.strokeStyle = '#3a9c4a'; ctx.lineWidth = 3;
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
    const prog = clamp(now / (song.lastTime + 0.01), 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rrect(ctx, W / 2 - 200, 10, 400, 7, 4); ctx.fill();
    ctx.fillStyle = '#fff';
    rrect(ctx, W / 2 - 200, 10, 400 * prog, 7, 4); ctx.fill();

    strokeText(ctx, String(Math.round(displayScore)).padStart(7, '0'), 40, 40, 36, '#fff', 'left');
    strokeText(ctx, `${songDef.name} · ${Chart.DIFFS[diffKey].label}`, 40, 74, 15, '#f2e6ff', 'left', 3);
    if (feverT > 0) strokeText(ctx, 'x2', 210, 54, 24, '#ffd23e', 'left');

    const bw = 300, bx = W / 2 - bw / 2, by = 32;
    ctx.save();
    ctx.translate(bx - 34, by + 12);
    const beat = hp < charCfg.hp * 0.3 ? 1 + Math.sin(perfT * 9) * 0.12 : 1;
    ctx.scale(beat, beat);
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
    const hpr = hp / charCfg.hp;
    ctx.fillStyle = hpr > 0.5 ? '#7ee787' : hpr > 0.25 ? '#ffd23e' : (Math.floor(perfT * 6) % 2 ? '#ff5c5c' : '#ffb3b3');
    rrect(ctx, bx + 3, by + 3, (bw - 6) * hpr, 12, 6); ctx.fill();

    const fw = 180, fx = W - fw - 30, fy = 30;
    strokeText(ctx, 'FEVER', fx + fw / 2, fy - 14, 17, feverT > 0 ? '#ffd23e' : '#ffe9a8');
    ctx.fillStyle = 'rgba(30,10,40,0.45)';
    rrect(ctx, fx, fy, fw, 16, 8); ctx.fill();
    const g2 = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    g2.addColorStop(0, '#ffd23e'); g2.addColorStop(1, '#ff8a3c');
    ctx.fillStyle = g2;
    rrect(ctx, fx + 3, fy + 3, (fw - 6) * (feverT > 0 ? 1 : fever / 100), 10, 5); ctx.fill();
    if (feverT > 0 && Math.floor(perfT * 5) % 2) strokeText(ctx, 'FEVER!!', fx + fw / 2, fy + 42, 26, '#ffd23e');

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
    if (k === 'Escape' || k === 'KeyP') {
      if (state === 'versions') { showScreen('title'); return; }
      if (state === 'lobby') { showScreen('title'); return; }
      setPause(state === 'playing');
      return;
    }
    if (state !== 'playing') {
      if (k === 'Enter' && (state === 'title' || state === 'lobby')) {
        if (state === 'title') enterLobby();
        else startGame();
      }
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
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (state !== 'playing') return;
    for (const tch of e.changedTouches) {
      const rect = canvas.getBoundingClientRect();
      const x = (tch.clientX - rect.left) / rect.width * W;
      attack(x < W / 2 ? 'A' : 'G');
    }
  }, { passive: false });

  // ---------- 界面导航 ----------
  function showScreen(name) {
    if (name === 'title') state = 'title';
    else if (name === 'lobby') state = 'lobby';
    else if (name === 'versions') state = 'versions';
    for (const k in screens) screens[k].classList.add('hidden');
    if (name === 'title') screens.title.classList.remove('hidden');
    if (name === 'lobby') { buildLobby(); screens.lobby.classList.remove('hidden'); }
    if (name === 'versions') { buildVersions(); screens.versions.classList.remove('hidden'); }
  }
  function enterLobby() {
    AudioSys.ensure(); AudioSys.sfxUI();
    showScreen('lobby');
  }

  $('startBtn').addEventListener('click', enterLobby);
  $('versionBtn').textContent = `v${GAME_VERSION} · 更新记录`;
  $('versionBtn').addEventListener('click', () => { AudioSys.ensure(); AudioSys.sfxUI(); showScreen('versions'); });
  $('versionsCloseBtn').addEventListener('click', () => { AudioSys.sfxUI(); showScreen('title'); });
  $('backBtn').addEventListener('click', () => { AudioSys.sfxUI(); showScreen('title'); });
  $('playBtn').addEventListener('click', () => { startGame(); $('playBtn').blur(); });
  document.querySelectorAll('#diffRow .diff-btn').forEach(b => {
    b.addEventListener('click', () => {
      diffKey = b.dataset.diff;
      AudioSys.ensure(); AudioSys.sfxUI();
      buildLobby();
    });
  });
  $('offsetMinus').addEventListener('click', () => {
    offsetMs = clamp(offsetMs - 10, -300, 300);
    localStorage.setItem('mushdash_offset', String(offsetMs));
    $('offsetVal').textContent = (offsetMs > 0 ? '+' : '') + offsetMs + 'ms';
    AudioSys.sfxUI();
  });
  $('offsetPlus').addEventListener('click', () => {
    offsetMs = clamp(offsetMs + 10, -300, 300);
    localStorage.setItem('mushdash_offset', String(offsetMs));
    $('offsetVal').textContent = (offsetMs > 0 ? '+' : '') + offsetMs + 'ms';
    AudioSys.sfxUI();
  });
  $('resumeBtn').addEventListener('click', () => setPause(false));
  $('restartBtn').addEventListener('click', () => { AudioSys.resume(); startGame(); });
  $('quitBtn').addEventListener('click', () => {
    AudioSys.resume(); AudioSys.stopSong(); AudioSys.sfxUI();
    showScreen('lobby');
  });
  $('retryBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', () => {
    AudioSys.sfxUI();
    showScreen('lobby');
  });
  $('muteBtn').addEventListener('click', () => {
    const btn = $('muteBtn');
    const toMute = btn.textContent === '🔊';
    btn.textContent = toMute ? '🔇' : '🔊';
    AudioSys.setMuted(toMute);
  });

  // ---------- 自动化测试钩子：手动驱动帧循环 / 只读状态（正常游玩不依赖） ----------
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
        song: songId, char: charId, diff: diffKey,
      };
    },
    nearest() {
      if (!song) return null;
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
