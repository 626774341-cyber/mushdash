'use strict';
/* ============================================================
 * MushDash 主逻辑 —— v2.3 竖屏 3D · 长按菇霸版
 * 流程：标题 → 大厅（选曲 / 选角色 / 难度 / 偏移校准）→ 游戏 → 结算
 * 镜头：正后方高位越肩视角，赛道纵贯屏幕，敌人迎面袭来。
 * A/← 斩左道（紫怒菌），D/→ 斩右道（黄飞菇）；青绿菇霸要按住
 * 不放直到尾巴通过，提前松手会被咬（扣血断连击）。
 * PERFECT/GREAT/GOOD 三档判定，漏怪掉血，FEVER 双倍得分。
 * 3D 渲染：Canvas2D 手写透视投影（零依赖）——渐变球体着色、
 * 画家算法远->近排序、距离雾化、接地阴影。
 * ============================================================ */
(() => {
  // ---------- 常量 ----------
  const W = 720, H = 1280;
  const HIT_WINDOW = 0.15, PERFECT_WIN = 0.055, GREAT_WIN = 0.105;
  const ACT_DUR = 0.28;
  const CANDY_WIN = 0.18;         // 糖果收集窗口
  const FORGIVE_WIN = 0.35;       // 空挥宽容：敌人临近时挥空不断连击
  const HOLD_SEGS = 3;            // 菇霸奖励节（3 节手感更紧凑）
  const HOLD_TAIL_GRACE = 0.12;   // 尾巴通过前的松手宽容

  // 3D 相机：正后方高位越肩视角——角色落在画面下方，
  // 地平线到角色头顶之间整段来敌通道无遮挡，左右方向一目了然
  const CAM = { x: 0, y: 6.4, z: -9.0, yaw: 0, pitch: 0.27 };
  const FOCAL = H * 0.62;
  const PPU = 64;                 // 本地像素 / 世界单位（billboard 缩放基准）
  const ROAD_HW = 3.35;           // 赛道半宽（世界单位）
  const TREE_X = 5.7;             // 路旁蘑菇树横坐标
  const LANE_X = { G: -1.45, A: 1.45 };  // 谱面轨道 'G'/'A' → 左/右车道（沿用生成器标记）
  const ZRATE_K = 0.052;          // 谱面速度(px/s) → 世界单位/s
  const DRAW_FAR = 64;            // 最远绘制距离
  const FOG_NEAR = 30, FOG_FAR = 58;
  const HORIZON_Y = H / 2 - FOCAL * Math.tan(CAM.pitch);

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
  function rgba(h, a) { const c = hexRGB(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
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
  const histKey = (songId, diff) => `mushdash_history_${songId}_${diff}`;

  // ---------- 版本记录 ----------
  const GAME_VERSION = '2.2.0';
  const REPO = 'https://github.com/626774341-cyber/mushdash';
  const VERSIONS = [
    {
      v: '2.2.0', date: '2026-09-18', name: '安可舞台',
      link: './versions/v2.2/', commit: REPO + '/commits/main',
      notes: [
        '每次游完统计本地排名：结算显示第几名/共几次记录/最高分（保留最近 50 次）',
        '结算动画：主人公按等级谢幕跳舞——S 级疯狂蹦跳转圈撒星火、A 级开心挥臂、失败低头沮丧',
        '谢幕跳舞结束后结算面板才升起，可与烟花同框',
      ],
    },
    {
      v: '2.1.0', date: '2026-09-18', name: '拨云见日',
      link: './versions/v2.1/', commit: REPO + '/commits/main',
      notes: [
        '修复蘑菇伞盖与伞柄的重叠/分离：菌柄延伸进伞盖，摇摆动画下永不开缝',
        '菇霸模型重设计：宽厚身体、怒目粗眉、龇牙、小手臂，帽色回归青蓝',
        '菇霸被按住时与角色错位，不再叠影',
        '观众蘑菇细杆化、去掉表情，画面更干净',
        '移除应援灯牌，FEVER 画面更清爽',
      ],
    },
    {
      v: '2.0.0', date: '2026-09-18', name: '3D 版',
      link: './versions/v2.0/', commit: REPO + '/commits/main',
      notes: [
        '画面全面重制：16:9 横屏 2D → 9:16 竖屏 3D，越肩追尾视角 + 透视赛道',
        '双轨道改为左右车道：A/← 斩左道紫怒菌、D/→ 斩右道黄飞菇，触屏左右半屏对应',
        '全新长按怪「菇霸」：戴金冠的大蘑菇王，按住把它压扁撑到倒计时结束拿高分；提前松手会被反击',
        '星星糖果改为按对应车道互动收集；旧连打链移除',
        'FEVER 全面舞台化：荧光棒海、七彩虹、探照灯与跑马灯、全屏霓虹灯框、彩纸雨',
        '表现张力包：击杀镜头冲镜、节拍脉冲、PERFECT 白闪、人浪应援、每 25 连击爆闪、通关烟花、夜晚流星',
        '玩法判定、音乐、成绩存档与 1.x 完全兼容',
      ],
    },
    {
      v: '1.3.0', date: '2026-09-18', name: '雾蓝夜话',
      link: 'versions/v1.2.1/', commit: REPO + '/commit/08bfcd8',
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
  let streaks = [], rings = [], streakTimer = 0;
  let holdItemsLayer = [];   // 菇霸单独一层：画在角色之上，露出"正在被吃"的头部
  const hold = { track: null, enemy: null };   // 当前进行中的长按菇霸
  let score = 0, displayScore = 0, combo = 0, maxCombo = 0, hp = 100;
  let fever = 0, feverT = 0;
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let shake = 0, redFlash = 0;
  let punchT = 0, punchX = 0, punchY = 0;     // 击杀镜头冲镜
  let flashT = 0, flashCol = '#ffffff';       // 全屏快闪
  let comboBurstT = 1;                        // 连击里程碑爆闪
  let fwT = 0;                                // 通关烟花计时
  let confettiT = 0, cheerT = 0;              // FEVER 彩纸雨 / 欢呼火星
  let resultT = 0, overlayDelay = 2800;       // 结算动画时长与面板延迟
  let sparkT = 0;                             // S 级谢幕星火
  let crowdHypeT = 0, cheerNoteT = 0;         // 观众亢奋（打出好成绩时全场抛爱心星星）
  let perfT = 0;
  let curPalette = Chart.getSong(songId).palette;
  let faceTurn = 1;               // 0 = 背对镜头（攻击中），1 = 回头看镜头

  const player = { actTrack: null, actT: 0, hurtT: 0, leanX: 0 };
  const songNow = () => AudioSys.songTime() + offsetMs / 1000;
  const songSpeed = () => (song ? song.speed * ZRATE_K : 21);

  // ---------- 3D 透视投影 ----------
  const cosYaw = Math.cos(CAM.yaw), sinYaw = Math.sin(CAM.yaw);
  const cosPit = Math.cos(CAM.pitch), sinPit = Math.sin(CAM.pitch);
  function project(x, y, z) {
    const dx = x - CAM.x, dy = y - CAM.y, dz = z - CAM.z;
    const xc = dx * cosYaw - dz * sinYaw;      // 偏航
    let zr = dx * sinYaw + dz * cosYaw;
    const yc = dy * cosPit + zr * sinPit;      // 俯仰
    zr = zr * cosPit - dy * sinPit;
    if (zr < 0.35) return null;                // 相机身后/太近
    const s = FOCAL / zr;
    return { x: W / 2 + xc * s, y: H / 2 - yc * s, s, zc: zr };
  }
  const fogAlpha = zc => clamp((FOG_FAR - zc) / (FOG_FAR - FOG_NEAR), 0, 1);
  // 把画布原点挪到投影点并按距离缩放（本地像素坐标直接复用 2D 美术）
  function bill(p) { ctx.translate(p.x, p.y); ctx.scale(p.s / PPU, p.s / PPU); }

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
      dur: ev.dur || 0,
      tail: ev.kind === 'hold' ? (ev.beat + ev.dur) * spb : ev.beat * spb,
      state: 'live', fallT: 0, eaten: 0,
    }));
    candies = song.candies.map(c => ({ time: c.beat * spb, track: c.track, done: false }));
    particles = []; floats = []; slashes = [];
    streaks = []; rings = []; streakTimer = 0;
    hold.track = null; hold.enemy = null;
    score = 0; displayScore = 0; combo = 0; maxCombo = 0;
    hp = charCfg.hp;
    fever = 0; feverT = 0;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    shake = 0; redFlash = 0;
    player.actT = 0; player.hurtT = 0; player.leanX = 0;
    faceTurn = 1;
    AudioSys.startSong(songDef, Chart.BARS * 16);
    for (const k in screens) screens[k].classList.add('hidden');
    state = 'playing';
  }

  // ---------- 判定 ----------
  function enemyPos(e, now) {
    return { x: LANE_X[e.track] ?? 0, y: 0, z: (e.time - now) * song.speed * ZRATE_K };
  }
  function attack(track) {
    if (state !== 'playing') return;
    if (hold.enemy && hold.track === track) return;   // 长按中：同车道按键属于长按本身
    const now = songNow();
    player.actTrack = track; player.actT = ACT_DUR;
    slashes.push({ track, t: 0 });
    let best = null, bestAbs = 1e9;
    for (const e of enemies) {
      if (e.state !== 'live' || e.track !== track) continue;
      const ad = Math.abs(now - e.time);
      if (ad <= HIT_WINDOW && ad < bestAbs) { best = e; bestAbs = ad; }
    }
    if (best) {
      if (best.kind === 'hold') { catchHold(best, bestAbs, now, track); return; }
      killEnemy(best, bestAbs, now);
      return;
    }
    // 没有敌人时先看能不能接到同车道的星星糖果
    const c = candies.find(c => !c.done && c.track === track && Math.abs(now - c.time) <= CANDY_WIN);
    if (c) { collectCandy(c); return; }
    // 真空挥才断连击：敌人临近时（长按尾部区间）挥空不惩罚
    const near = enemies.some(e => e.state === 'live' && e.track === track && Math.abs(now - e.time) < FORGIVE_WIN);
    if (!near) emptySwing(track);
    else AudioSys.sfxSwing();
  }
  function emptySwing(track) {
    const hp2 = project((LANE_X[track] ?? 0) * 0.6, 1.5, 0.4);
    const fx = hp2 ? hp2.x : W / 2, fy = hp2 ? hp2.y : H * 0.55;
    if (combo > 0) addFloat('空挥!', fx, fy, '#c9b8e8', 22);
    combo = 0;
    AudioSys.sfxSwing();
  }
  function killEnemy(e, ad, now) {
    e.state = 'killed';
    const { judge, base } = judgeEnemy(e, ad);
    const mult = feverT > 0 ? 2 : 1;
    score += (base + combo * 2) * mult;

    const p = enemyPos(e, now);
    const ez = Math.max(p.z, 0.5);
    const col = e.track === 'G' ? '#b48ae8' : '#ffc94d';
    burst(p.x, 0.45, ez, col, 18);
    rings.push({ x: p.x, y: 0.45, z: ez, t: 0, col });
    // 击杀镜头冲镜 + PERFECT 白闪
    punchT = 0.14;
    const pp = project(p.x, 0.6, ez);
    if (pp) { punchX = pp.x; punchY = pp.y; }
    if (judge === 'PERFECT') { flashT = 0.09; flashCol = '#ffffff'; shake = Math.max(shake, 0.06); }
    crowdHypeT = 0.5;                           // 观众看到精彩操作，全场亢奋
    const sp = project(p.x, 0.6, ez);
    if (sp) addFloat(judge,
      clamp(sp.x, 80, W - 80), clamp(sp.y - 30, 140, H - 260),
      judge === 'PERFECT' ? '#ffd23e' : judge === 'GREAT' ? '#7ee787' : '#6ec6ff',
      judge === 'PERFECT' ? 30 : 24);
    AudioSys.sfxHit(judge);
  }
  function collectCandy(c) {
    c.done = true;
    score += Math.round(50 * charCfg.candyMult) * (feverT > 0 ? 2 : 1);
    sparkle(LANE_X[c.track] ?? 0, 0.8, 1.2);
    crowdHypeT = Math.max(crowdHypeT, 0.3);
    AudioSys.sfxCandy();
  }
  // 命中判定的公共部分（普通怪与菇霸头部共用）
  function judgeEnemy(e, ad) {
    let judge, base;
    // 累加时就钳制上限：即使帧循环被遮挡暂停，热情值也不会溢出
    if (ad <= PERFECT_WIN)      { judge = 'PERFECT'; base = 300; counts.perfect++; fever = Math.min(100, fever + 4 * charCfg.feverGain); }
    else if (ad <= GREAT_WIN)   { judge = 'GREAT';   base = 200; counts.great++;   fever = Math.min(100, fever + 3 * charCfg.feverGain); }
    else                        { judge = 'GOOD';    base = 100; counts.good++;    fever = Math.min(100, fever + 2 * charCfg.feverGain); }
    combo++; maxCombo = Math.max(maxCombo, combo);
    if (combo % 50 === 0) {
      hp = Math.min(charCfg.hp, hp + 4);
      addFloat('+4 ❤', W / 2, 380, '#7ee787', 26);
    }
    if (combo % 25 === 0) { AudioSys.sfxCombo(); comboBurstT = 0; }   // 里程碑爆闪
    return { judge, base };
  }
  // ---- 菇霸（长按怪）：按住头部直到尾巴通过 ----
  function catchHold(e, ad, now, track) {
    const { judge } = judgeEnemy(e, ad);
    e.state = 'holding';
    e.eaten = 0;
    hold.track = track;
    hold.enemy = e;
    const p = enemyPos(e, now);
    const ez = Math.max(p.z, 0.5);
    burst(p.x, 0.45, ez, '#5cc46a', 12);
    rings.push({ x: p.x, y: 0.45, z: ez, t: 0, col: '#7ee787' });
    const sp = project(p.x, 1.0, ez);
    if (sp) addFloat('按住!', clamp(sp.x, 80, W - 80), clamp(sp.y - 30, 140, H - 260), '#8fe89a', 26);
    AudioSys.sfxHit(judge);
  }
  function completeHold(e) {
    e.state = 'done';
    hold.track = null; hold.enemy = null;
    const mult = feverT > 0 ? 2 : 1;
    score += 300 * mult;
    fever = Math.min(100, fever + 6 * charCfg.feverGain);
    const lx = LANE_X[e.track] ?? 0;
    burst(lx, 0.5, 1.0, '#5cc46a', 20);
    rings.push({ x: lx, y: 0.45, z: 1.0, t: 0, col: '#7ee787' });
    rings.push({ x: lx, y: 0.45, z: 1.0, t: -0.08, col: '#ffffff' });
    spawnConfetti(12);
    crowdHypeT = 0.6;
    const sp = project(lx, 1.2, 1.0);
    if (sp) addFloat('完美长按! +' + 300 * mult,
      clamp(sp.x, 90, W - 90), clamp(sp.y - 30, 160, H - 240), '#7ee787', 26);
    AudioSys.sfxCombo();
  }
  function releaseHold(track) {
    if (state !== 'playing') return;               // 暂停中的松手不惩罚，恢复后撑到尾照样算完成
    if (!hold.enemy || hold.track !== track) return;
    const e = hold.enemy;
    const now = songNow();
    if (now >= e.tail - HOLD_TAIL_GRACE) { completeHold(e); return; }
    // 提前松手：菇霸逃走了
    hold.track = null; hold.enemy = null;
    e.state = 'missed'; e.fallT = 0;
    onMiss(e);
  }
  function onMiss(e) {
    counts.miss++;
    combo = 0;
    hp = Math.max(0, hp - charCfg.missDmg);
    shake = 0.35; redFlash = 0.3; player.hurtT = 0.5;
    addFloat('MISS!', W / 2 + 50, 500, '#ff5c5c', 30);
    if (e && song) {
      const p = enemyPos(e, songNow());
      rings.push({ x: p.x, y: 0.45, z: Math.max(p.z, 0.6), t: 0, col: '#ff5c5c' });
    }
    AudioSys.sfxHurt();
    if (hp <= 0) gameOver(false);
  }

  // ---------- 特效 ----------
  function burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(1.4, 5);
      particles.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2.2, vz: rand(-1.5, 2.6),
        r: rand(0.05, 0.12), life: rand(0.35, 0.7), t: 0, color,
      });
    }
  }
  function sparkle(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU, sp = rand(0.4, 1.6);
      particles.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(-0.5, 1),
        r: rand(0.035, 0.08), life: rand(0.25, 0.5), t: 0, color: '#ffd23e',
      });
    }
  }
  function addFloat(text, x, y, color, size) {
    floats.push({ text, x, y, color, size, t: 0 });
  }

  // ---------- 更新 ----------
  function update(dt) {
    const now = songNow();

    for (const e of enemies) {
      if (e.state === 'holding') {
        // 长按中：虫节逐节被吃掉（每节 +30），尾巴到达即完成
        const segStep = (e.tail - e.time) / HOLD_SEGS;
        const target = Math.min(HOLD_SEGS, Math.floor((now - e.time) / segStep));
        while (e.eaten < target) {
          e.eaten++;
          score += 30 * (feverT > 0 ? 2 : 1);
          sparkle(LANE_X[e.track] ?? 0, 0.55, 0.95);
        }
        // 音符从菇霸身上飘起
        e.noteT = (e.noteT ?? 0) - dt;
        if (e.noteT <= 0) {
          e.noteT = 0.3;
          const np = project(LANE_X[e.track] ?? 0, rand(0.9, 1.7), rand(0.8, 1.3));
          if (np) addFloat(Math.random() < 0.5 ? '♪' : '♫', np.x, np.y, '#a5f0b2', 20);
        }
        if (now >= e.tail - 0.02) completeHold(e);
        continue;
      }
      if (e.state === 'live' && now - e.time > HIT_WINDOW) {
        e.state = 'missed'; e.fallT = 0;
        onMiss(e);
      }
      if (e.state === 'missed') e.fallT += dt;
    }
    if (state !== 'playing') return;   // 本帧内已阵亡（如恢复可见时批量漏怪），立即停止后续更新

    // 糖果只在按对车道时收集（attack 内处理），这里只让过头的糖飘走
    for (const c of candies) {
      if (!c.done && now - c.time > CANDY_WIN) c.done = true;
    }

    if (player.actT > 0) player.actT -= dt;
    if (player.hurtT > 0) player.hurtT -= dt;
    for (const s of slashes) s.t += dt;
    slashes = slashes.filter(s => s.t < 0.22);

    if (feverT > 0) { feverT -= dt; if (feverT <= 0) feverT = 0; }
    else if (fever >= 100) {
      fever = 0; feverT = 10;
      AudioSys.sfxFever();
      addFloat('FEVER TIME!!', W / 2, 330, '#ffd23e', 52);
      burst(0, 2.8, 2.4, '#ffd23e', 30);
      // FEVER 爆发：金光快闪 + 双冲击环 + 全场撒花
      flashT = 0.24; flashCol = '#ffd76e';
      rings.push({ x: 0, y: 0.5, z: 1.2, t: 0, col: '#ffd23e' });
      rings.push({ x: 0, y: 0.5, z: 1.2, t: -0.09, col: '#ffffff' });
      spawnConfetti(24);
    }
    fever = Math.min(100, fever);

    displayScore += (score - displayScore) * Math.min(1, dt * 10);
    if (Math.abs(score - displayScore) < 1) displayScore = score;

    if (now > song.lastTime + 2) gameOver(true);
  }

  // ---------- 特效整合（任何状态都运行：结算烟花也要动起来） ----------
  function updateFx(dt) {
    // 速度光痕：贴着赛道两侧呼啸而过（FEVER 时变金色加倍）
    streakTimer -= dt;
    if (streakTimer <= 0 && state === 'playing') {
      streakTimer = feverT > 0 ? 0.06 : 0.15;
      streaks.push({
        x: (Math.random() < 0.5 ? -1 : 1) * rand(2.1, 3.2),
        y: rand(0.15, 1.9), z: rand(42, 56),
        len: rand(2, 3.4), a: rand(0.12, 0.28),
        col: feverT > 0 ? '#ffd76e' : '#ffffff',
      });
    }
    for (const s of streaks) s.z -= songSpeed() * 1.7 * dt;
    streaks = streaks.filter(s => s.z > -2);

    // 通关烟花：结算界面里定时彩色爆开
    if (state === 'result' && resultInfo && resultInfo.clear) {
      fwT -= dt;
      if (fwT <= 0) {
        fwT = 0.5;
        const cols = ['#ffd23e', '#ff8a5c', '#7ee787', '#6ec6ff', '#ff5f6d'];
        const col = cols[Math.floor(Math.random() * cols.length)];
        const fx = rand(-3.5, 3.5), fy = rand(3.2, 6), fz = rand(5, 14);
        burst(fx, fy, fz, col, 16);
        rings.push({ x: fx, y: fy, z: fz, t: 0, col });
      }
    }

    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.32 && r.t >= -0.2);

    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.rise) { p.x += Math.sin(p.t * 6 + p.r * 90) * 0.4 * dt; }                 // 应援物上浮
      else if (p.fl) { p.vy -= 2.5 * dt; p.x += Math.sin(p.t * 7 + p.r * 99) * 0.55 * dt; }  // 彩纸飘落
      else p.vy -= 13 * dt;
    }
    particles = particles.filter(p => p.t < p.life);
    for (const f of floats) f.t += dt;
    floats = floats.filter(f => f.t < 0.9);

    // FEVER 彩纸雨 + 路边观众欢呼火星
    if (state === 'playing' && feverT > 0) {
      confettiT -= dt;
      if (confettiT <= 0) { confettiT = 0.5; spawnConfetti(2); }
      cheerT -= dt;
      if (cheerT <= 0) {
        cheerT = 0.16;
        const side = Math.random() < 0.5 ? -1 : 1;
        sparkle(side * rand(6.8, 9.2), rand(0.8, 1.4), rand(2, 22));
      }
    }

    // 观众亢奋：往天上抛爱心和星星应援
    if (crowdHypeT > 0) crowdHypeT = Math.max(0, crowdHypeT - dt);
    if (state === 'playing' && feverT > 0 && crowdHypeT > 0) {
      cheerNoteT -= dt;
      if (cheerNoteT <= 0) {
        cheerNoteT = 0.13;
        const side = Math.random() < 0.5 ? -1 : 1;
        const isHeart = Math.random() < 0.6;
        particles.push({
          x: side * rand(6.6, 9.2), y: rand(1.7, 2.4), z: rand(2, 22),
          vx: rand(-0.3, 0.3), vy: rand(1.0, 1.9), vz: rand(-0.3, 0.3),
          r: rand(0.09, 0.15), life: rand(0.7, 1.1), t: 0,
          color: isHeart ? '#ff6b8a' : '#ffd23e',
          heart: isHeart, star: !isHeart, rise: true,
        });
      }
    }

    // 结算舞台：谢幕跳舞计时 + S 级星火环绕
    if (state === 'result' && resultInfo) {
      resultT += dt;
      if (resultInfo.clear && resultInfo.rank === 'S') {
        sparkT -= dt;
        if (sparkT <= 0) { sparkT = 0.22; sparkle(rand(-1.1, 1.1), rand(1.3, 2.7), rand(0.3, 1.2)); }
      }
    }

    if (shake > 0) shake = Math.max(0, shake - dt);
    if (redFlash > 0) redFlash = Math.max(0, redFlash - dt);
    if (punchT > 0) punchT = Math.max(0, punchT - dt);
    if (flashT > 0) flashT = Math.max(0, flashT - dt);
  }

  // 彩纸：从空中飘飘洒洒落下
  function spawnConfetti(n) {
    const cols = ['#ffd23e', '#ff8a5c', '#7ee787', '#6ec6ff', '#ff5f6d'];
    for (let i = 0; i < n; i++) {
      particles.push({
        x: rand(-2.6, 2.6), y: rand(4.5, 7.5), z: rand(0.8, 5),
        vx: rand(-0.6, 0.6), vy: rand(-1.2, -0.4), vz: rand(-0.5, 0.5),
        r: rand(0.05, 0.1), life: rand(1.2, 2.1), t: 0,
        color: cols[i % cols.length], fl: true,
      });
    }
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
    // 本地排行榜：记录本次成绩并计算排名（按分数排序，保留最近 50 次）
    const hist = loadJSON(histKey(songId, diffKey), []);
    const rec = { s: score, mc: maxCombo, acc: Math.round(acc * 100), rank, clear, d: Date.now() };
    hist.push(rec);
    hist.sort((a, b) => b.s - a.s || b.mc - a.mc);
    const top = hist.slice(0, 50);
    saveJSON(histKey(songId, diffKey), top);
    const myPos = top.indexOf(rec) + 1;

    resultInfo = { clear, rank, acc, isRecord, fullCombo, pos: myPos, total: top.length, best: top[0].s };
    resultT = 0;
    // 按等级决定谢幕跳舞时长，之后结算面板才升起
    overlayDelay = !clear ? 2400 : rank === 'S' ? 4300 : rank === 'A' ? 3800 : rank === 'B' ? 3200 : 2800;

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
    const posEl = document.getElementById('rankPos');
    if (posEl) posEl.textContent = clear
      ? `🏆 本地第 ${myPos} 名 · 共 ${top.length} 次记录 · 最佳 ${top[0].s} 分`
      : `📝 本地第 ${myPos} 名 · 共 ${top.length} 次记录 · 加油！`;
    setTimeout(() => { if (state === 'result') screens.result.classList.remove('hidden'); }, overlayDelay);
  }
  const rankOrder = r => ({ S: 4, A: 3, B: 2, C: 1, D: 0 })[r] ?? 0;
  let resultInfo = null;

  // ---------- 天空与远景 ----------
  function drawSky(t, feverMix, pulse = 0) {
    const P = curPalette;
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 50);
    g.addColorStop(0, mixColor(P.sky[0], '#ffdf9e', feverMix * 0.85));
    g.addColorStop(1, mixColor(P.sky[1], '#ff9d76', feverMix * 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON_Y + 50);

    // 太阳 / 月亮（带节拍光晕）
    if (pulse > 0) {
      ctx.globalAlpha = 0.22 * pulse;
      ctx.fillStyle = mixColor(P.sun, '#fffbe0', feverMix);
      ctx.beginPath();
      ctx.arc(W - 148, 150, (P.night ? 44 : 56) + 24 + pulse * 12, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = mixColor(P.sun, '#fffbe0', feverMix);
    ctx.beginPath(); ctx.arc(W - 148, 150, P.night ? 44 : 56, 0, TAU); ctx.fill();
    if (P.night) {
      ctx.fillStyle = mixColor(P.sky[0], '#ffdf9e', feverMix * 0.5);
      ctx.beginPath(); ctx.arc(W - 126, 136, 38, 0, TAU); ctx.fill();
      // 星星
      for (let i = 0; i < 30; i++) {
        const sx = (i * 331) % W, sy = 30 + (i * 173) % Math.max(60, HORIZON_Y - 90);
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.4 + i * 1.9));
        ctx.globalAlpha = tw * (1 - feverMix * 0.4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, 2.4, 2.4);
      }
      // 流星：每 9 秒划过一次
      const mT = t % 9;
      if (mT < 0.7 && HORIZON_Y > 140) {
        const k = mT / 0.7;
        const mx = 100 + k * 240, my = 50 + k * 80;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - 26, my - 30);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 云
    ctx.fillStyle = `rgba(255,255,255,${P.cloudA})`;
    for (let i = 0; i < 4; i++) {
      const spd = 14 + i * 7;
      const cx = ((560 - t * spd + i * 260) % (W + 320) + W + 320) % (W + 320) - 160;
      const cy = 90 + (i % 2) * 76;
      cloud(cx, cy, 30 + (i % 3) * 11);
    }

    mountains(t * 18, HORIZON_Y + 2, 54, mixColor(P.hillFar, '#ffcf5e', feverMix * 0.5));
    mountains(t * 34, HORIZON_Y + 5, 38, mixColor(P.hillNear, '#ffb44d', feverMix * 0.5));
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
    ctx.moveTo(0, baseY + 6);
    for (let x = 0; x <= W; x += 40) {
      const y = baseY - Math.abs(Math.sin((x + off) * 0.004)) * amp - Math.sin((x + off) * 0.013) * 10;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, baseY + 6);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 地面与赛道 ----------
  function groundQuad(x0, x1, z0, z1, style) {
    const a = project(x0, 0, z0), b = project(x1, 0, z0);
    const c = project(x1, 0, z1), d = project(x0, 0, z1);
    if (!a || !b || !c || !d) return;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }
  function drawGround(t, feverMix, pulse = 0) {
    const P = curPalette;
    const g = ctx.createLinearGradient(0, HORIZON_Y, 0, H);
    g.addColorStop(0, mixColor(P.grass, P.sky[1], 0.55));
    g.addColorStop(0.28, P.grass);
    g.addColorStop(1, P.grassDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);

    const zn = -5.6, zf = DRAW_FAR;
    const nl = project(-ROAD_HW, 0, zn), nr = project(ROAD_HW, 0, zn);
    const fl = project(-ROAD_HW, 0, zf), fr = project(ROAD_HW, 0, zf);
    if (nl && nr && fl && fr) {
      const rg = ctx.createLinearGradient(0, fl.y, 0, Math.min(nl.y, H));
      rg.addColorStop(0, mixColor(P.dirt, P.sky[1], 0.6));
      rg.addColorStop(0.3, P.dirt);
      rg.addColorStop(1, P.dirtDark);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y);
      ctx.lineTo(fr.x, fr.y); ctx.lineTo(fl.x, fl.y);
      ctx.closePath(); ctx.fill();
      // FEVER：赛道鎏金
      if (feverMix > 0) {
        ctx.globalAlpha = feverMix * 0.16;
        ctx.fillStyle = '#ffd76e';
        ctx.beginPath();
        ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y);
        ctx.lineTo(fr.x, fr.y); ctx.lineTo(fl.x, fl.y);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // 内侧边线
    const edgeCol = mixColor(P.dirtDark, '#000000', 0.18);
    groundQuad(-ROAD_HW + 0.18, -ROAD_HW + 0.55, zn, zf, edgeCol);
    groundQuad(ROAD_HW - 0.55, ROAD_HW - 0.18, zn, zf, edgeCol);
    // FEVER：路边鎏金
    if (feverMix > 0) {
      const gcol = `rgba(255,215,110,${(feverMix * 0.5).toFixed(3)})`;
      groundQuad(-ROAD_HW + 0.18, -ROAD_HW + 0.55, zn, zf, gcol);
      groundQuad(ROAD_HW - 0.55, ROAD_HW - 0.18, zn, zf, gcol);
    }
    // 左右车道引导线
    groundQuad(-1.52, -1.38, zn, zf, 'rgba(255,255,255,0.12)');
    groundQuad(1.38, 1.52, zn, zf, 'rgba(255,255,255,0.12)');
    // 中央滚动虚线（随节拍提亮；FEVER 时变霓虹色轮转）
    let dashCol;
    if (feverMix > 0.5) {
      dashCol = `hsl(${Math.round((t * 320) % 360)}, 100%, 62%)`;
    } else {
      const m2 = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));
      const dashRGB = m2(m2(hexRGB(P.grassLit), hexRGB('#ffcf5e'), feverMix), [255, 255, 255], pulse * 0.5);
      dashCol = `rgb(${dashRGB.join(',')})`;
    }
    const gap = 5, off = (t * songSpeed()) % gap;
    for (let k = -2; k * gap < DRAW_FAR + gap * 2; k++)
      groundQuad(-0.3, 0.3, k * gap - off, k * gap - off + 2.3, dashCol);
    // 地平线雾带
    const hz = ctx.createLinearGradient(0, HORIZON_Y - 6, 0, HORIZON_Y + 85);
    hz.addColorStop(0, rgba(P.sky[1], 0.6));
    hz.addColorStop(1, rgba(P.sky[1], 0));
    ctx.fillStyle = hz;
    ctx.fillRect(0, HORIZON_Y - 6, W, 92);
  }

  // ---------- 路旁风景 ----------
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
  function drawBush() {
    ctx.fillStyle = curPalette.grassDark;
    ctx.beginPath();
    ctx.arc(0, 0, 24, Math.PI, 0);
    ctx.quadraticCurveTo(0, 10, -24, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = curPalette.grassLit;
    ctx.beginPath(); ctx.arc(-7, -7, 6, 0, TAU); ctx.fill();
  }

  // ---------- 世界物件（画家算法：远 → 近） ----------
  function drawWorldItems(t, now, inGame, feverMix = 0) {
    const P = curPalette;
    const items = [];
    holdItemsLayer = [];
    const flow = t * songSpeed();
    // FEVER 观众/应援物的弹出进度（0 隐藏 → 1 完全出现，带过冲）
    const riseOf = (delay) => {
      const appear = clamp((10 - feverT) * 1.8 - delay, 0, 1);
      const leave = clamp(feverT / 0.9, 0, 1);
      const raw = appear * leave;
      if (raw <= 0.03) return 0;
      const pb = raw - 1;
      return 1 + pb * pb * ((2.8 + 1) * pb + 2.8);   // easeOutBack 弹出
    };

    // FEVER 应援区：路边升起荧光棒海，随人浪起伏打 call
    // FEVER 应援物配色
    const stickCols = ['#ff5f9e', '#4de1ff', '#ffd23e', '#a6ff5f', '#c49bff'];
    if (feverMix > 0) {
      // 荧光棒海：两排彩棒随人浪摇摆
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 14; i++) {
          const z = 46 - ((flow + i * 2.3 + (side > 0 ? 1.15 : 0)) % 46);
          const sx = side * (4.5 + (i % 3) * 0.55 + (i > 8 ? 0.8 : 0));
          const delay = (i % 5) * 0.18 + (side > 0 ? 0.1 : 0);
          const rise = riseOf(delay);
          if (rise <= 0.02) continue;
          const base = project(sx, 0, z);
          if (!base || base.zc > DRAW_FAR) continue;
          const hgt = (0.85 + (i % 3) * 0.22) * rise;
          const wav = Math.sin(now * 6.5 - z * 0.55 + i * 1.1) * 0.38 * (0.6 + crowdHypeT);
          const col = stickCols[(i + Math.floor(t * 2)) % stickCols.length];
          const tip = project(sx + Math.sin(wav) * hgt * 0.45, hgt, z);
          if (!tip) continue;
          const fog = fogAlpha(base.zc);
          items.push({ zc: base.zc, draw() {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = fog * rise * 0.4;
            ctx.strokeStyle = col;
            ctx.lineWidth = 0.3 * base.s;
            ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
            ctx.globalAlpha = fog * rise;
            ctx.lineWidth = 0.11 * base.s;
            ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(tip.x, tip.y, 0.075 * base.s, 0, TAU); ctx.fill();
            ctx.restore();
          }});
        }
      }
    }

      // 蘑菇观众：细杆大蘑菇大幅左右摇摆，举着荧光棒随人浪打 call
      const caps2 = ['#ff5f6d', '#4d7eff', '#2fb3c9', '#9b6bd6', '#e8a01f', '#3ecf5a'];
      const spbV = song ? song.spb : 0.44;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 9; i++) {
          const z = 42 - ((flow + i * 4.5 + (side > 0 ? 2.25 : 0) + 1.4) % 42);
          const sx = side * (5.7 + (i % 3) * 1.05);
          const delay = (i % 5) * 0.18 + (side > 0 ? 0.15 : 0);
          const rise = riseOf(delay);
          if (rise <= 0.02) continue;
          const capCol = caps2[(i + (side > 0 ? 3 : 0)) % caps2.length];
          const wave2 = Math.sin(now * 6.5 - z * 0.55 + i * 1.1);   // 人浪相位
          const bounce = Math.abs(wave2) * 0.45 * rise;
          const base = project(sx, bounce, z);
          if (!base || base.zc > DRAW_FAR) continue;
          const fog = fogAlpha(base.zc);
          const beat = (now / spbV) * Math.PI;
          const sway = Math.sin(beat) * 0.16 * rise;
          const capSway = Math.sin(beat - 0.7) * 0.06 * rise;
          const stickCol = stickCols[(i + (side > 0 ? 2 : 0)) % stickCols.length];
          items.push({ zc: base.zc, draw() {
            ctx.save();
            // 接地影子
            ctx.globalAlpha = fog * 0.3;
            ctx.fillStyle = 'rgba(20,5,31,0.4)';
            ctx.beginPath(); ctx.ellipse(base.x, base.y, 0.42 * base.s, 0.14 * base.s, 0, 0, TAU); ctx.fill();
            ctx.globalAlpha = fog;
            bill(base);
            ctx.scale(side * -1.7 * rise, 1.7 * rise);
            // 大幅左右摇摆 + 横向移动
            ctx.translate(Math.sin(beat) * 5 * rise, 0);
            ctx.rotate(sway);
            // 两支荧光棒（举在帽外两侧，随人浪挥动）
            for (const s of [-1, 1]) {
              ctx.save();
              ctx.translate(s * 11, -42);
              ctx.rotate(s * (0.4 + wave2 * 0.3));
              ctx.lineCap = 'round';
              ctx.strokeStyle = stickCol; ctx.lineWidth = 5;
              ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
              ctx.restore();
            }
            // 细细的杆
            ctx.fillStyle = '#f6ead2';
            ctx.beginPath();
            ctx.moveTo(-6, 0);
            ctx.quadraticCurveTo(-8, -36, -5, -64);
            ctx.lineTo(5, -64);
            ctx.quadraticCurveTo(8, -36, 6, 0);
            ctx.closePath(); ctx.fill();
            // 大帽（平面单色 + 帽檐暗边 + 白点 + 霓虹描边），慢半拍摇摆
            ctx.save();
            ctx.translate(0, -64);
            ctx.rotate(capSway);
            ctx.fillStyle = capCol;
            ctx.beginPath();
            ctx.arc(0, 0, 48, Math.PI, 0);
            ctx.quadraticCurveTo(0, -14 + 14, -48, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = mixColor(capCol, '#14301c', 0.3);
            ctx.beginPath();
            ctx.ellipse(0, -12, 42, 6, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.beginPath(); ctx.arc(-18, -16, 6.5, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(11, -24, 5, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(28, -6, 4.2, 0, TAU); ctx.fill();
            ctx.restore();
            ctx.restore();
          }});
        }
      }

    // 路旁：蘑菇树 + 草丛（左右两侧循环掠过）
    for (let side = -1; side <= 1; side += 2) {
      const NT = 9, SP = 7.4, LEN = NT * SP;
      for (let i = 0; i < NT; i++) {
        const z = LEN - ((flow + i * SP + (side > 0 ? SP / 2 : 0)) % LEN);
        const p = project(side * TREE_X, 0, z);
        if (!p || p.zc > DRAW_FAR) continue;
        const fog = fogAlpha(p.zc);
        const s = 0.92 + (i % 3) * 0.13;
        const cap = P.treeCap[(i + (side > 0 ? 1 : 0)) % 2];
        items.push({ zc: p.zc, draw() {
          ctx.save();
          ctx.globalAlpha = fog;
          bill(p);
          mushTree(0, 0, s, cap, P.trunk);
          ctx.restore();
        }});
      }
      const NB = 12, SB = 4.3, LB = NB * SB;
      for (let i = 0; i < NB; i++) {
        const z = LB - ((flow + i * SB + (side > 0 ? SB * 0.5 : 0)) % LB) - 1.1;
        const p = project(side * 4.5, 0, z);
        if (!p || p.zc > DRAW_FAR) continue;
        const fog = fogAlpha(p.zc);
        items.push({ zc: p.zc, draw() {
          ctx.save();
          ctx.globalAlpha = fog * 0.9;
          bill(p);
          drawBush();
          ctx.restore();
        }});
      }
    }

    if (inGame && song) {
      // 星星糖果（左右车道地面滚动）
      for (const c of candies) {
        if (c.done) continue;
        const z = (c.time - now) * song.speed * ZRATE_K;
        const lx = LANE_X[c.track] ?? 0;
        const ay = 0.62 + Math.sin(now * 5 + c.time * 7) * 0.1;
        const p = project(lx, ay, z);
        if (!p || p.zc > DRAW_FAR) continue;
        const fog = fogAlpha(p.zc);
        items.push({ zc: p.zc, draw() {
          ctx.save();
          ctx.globalAlpha = fog * (0.7 + Math.sin(now * 7 + c.time * 3) * 0.3);
          bill(p);
          ctx.fillStyle = 'rgba(255,210,62,0.3)';
          ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
          drawStar(ctx, 0, 0, 13, now * 2.5, '#ffd23e', '#e8a01f');
          ctx.restore();
        }});
      }
      // 敌人（左右车道迎面跑来）
      for (const e of enemies) {
        if (e.state === 'killed' || e.state === 'done') continue;
        const w = enemyPos(e, now);
        let ay = w.y;
        if (e.kind === 'hold') ay += Math.sin(now * 8 + e.id) * 0.05;
        else if (e.track === 'A') ay = 0.52 + Math.sin(now * 6 + e.id * 2.1) * 0.14; // 右道贴地低飞
        else if (e.state === 'live') ay += Math.abs(Math.sin(now * 9 + e.id * 1.7)) * 0.22;

        if (e.kind === 'hold') {
          // 菇霸：按住时钉在角色前方一段距离，和角色错开不重叠
          const anchorZ = e.state === 'holding' ? 1.7 : w.z;
          const hp2 = project(w.x, ay, anchorZ);
          if (!hp2 || hp2.zc > DRAW_FAR) continue;
          const alpha = e.state === 'missed' ? Math.max(0, 1 - e.fallT * 1.6) : fogAlpha(hp2.zc);
          if (alpha <= 0.02) continue;
          const item = holdItem(e, now, hp2, alpha);
          if (item) holdItemsLayer.push(item);   // 画在角色上层
          continue;
        }

        const p = project(w.x, ay, w.z);
        if (!p || p.zc > DRAW_FAR) continue;
        const alpha = e.state === 'missed' ? Math.max(0, 1 - e.fallT * 1.6) : fogAlpha(p.zc);
        if (alpha <= 0.02) continue;
        const sh = project(w.x, 0, Math.max(w.z, 0.4));
        const col = e.track === 'G' ? '#b48ae8' : '#ffc94d';
        const gr = e.track === 'G' ? drawGrumpy : drawSporefly;
        items.push({ zc: p.zc, draw() {
          if (sh) {
            // 车道光圈：用敌人本色标出来敌方向，远距离也能分清左右
            ctx.save();
            ctx.globalAlpha = alpha * 0.22;
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.ellipse(sh.x, sh.y, 0.72 * sh.s, 0.72 * sh.s * 0.3, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = '#14051f';
            ctx.beginPath();
            ctx.ellipse(sh.x, sh.y, 0.5 * sh.s, 0.5 * sh.s * 0.3, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
          ctx.save();
          ctx.globalAlpha = alpha;
          bill(p);
          gr(0, 0, now, e, e.state === 'missed');
          ctx.restore();
        }});
      }
    }

    items.sort((a, b) => b.zc - a.zc);
    for (const it of items) it.draw();
  }
  // ---------- 菇霸（长按怪）：戴金冠的大蘑菇王，按住把它压扁，撑到倒计时结束它就爆掉 ----------
  function holdItem(e, now, headP, alpha) {
    const laneX = LANE_X[e.track] ?? 0;
    const holding = e.state === 'holding';
    const dead = e.state === 'missed';
    // 按住：压扁 + 挣扎抖动；漏掉：翻滚飞出
    const sq = holding ? 1 - 0.26 * Math.abs(Math.sin(now * 10)) : 1;
    const stX = holding ? 1 + 0.18 * Math.abs(Math.sin(now * 10)) : 1;
    const jig = holding ? Math.sin(now * 33) * 3.5 : 0;
    const roll = dead ? e.fallT * 5 : 0;
    return { zc: headP.zc, draw() {
      // 按住时：脚下金色压制光环
      if (holding) {
        const rp = project(laneX, 0.02, 1.7);
        if (rp) {
          const rr = (0.88 + Math.sin(now * 12) * 0.1) * rp.s;
          ctx.save();
          ctx.globalAlpha = 0.32;
          ctx.strokeStyle = '#ffd23e';
          ctx.lineWidth = Math.max(2, 0.05 * rp.s);
          ctx.beginPath();
          ctx.ellipse(rp.x, rp.y, rr, rr * 0.35, 0, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      bill(headP);
      ctx.translate(jig, 0);
      if (dead) ctx.rotate(roll);
      ctx.scale(stX, sq);
      // 短手臂（平时叉腰，被按住时乱挥）
      ctx.strokeStyle = '#f2e3cb'; ctx.lineWidth = 11; ctx.lineCap = 'round';
      if (holding) {
        const fa = Math.sin(now * 21) * 7;
        ctx.beginPath(); ctx.moveTo(-22, -36); ctx.lineTo(-34, -48 + fa); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, -36); ctx.lineTo(34, -40 - fa); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-22, -36); ctx.lineTo(-30, -24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, -36); ctx.lineTo(30, -24); ctx.stroke();
      }
      // 宽厚身体（顶端 -62 深深伸进帽盖里，绝无接缝）
      ctx.fillStyle = '#f2e3cb';
      ctx.beginPath();
      ctx.moveTo(-24, 2);
      ctx.quadraticCurveTo(-28, -30, -22, -62);
      ctx.lineTo(22, -62);
      ctx.quadraticCurveTo(28, -30, 24, 2);
      ctx.closePath(); ctx.fill();
      // 怒目脸（粗眉 + 圆眼 + 龇牙）
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-15, -42); ctx.lineTo(-5, -37); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, -42); ctx.lineTo(5, -37); ctx.stroke();
      ctx.fillStyle = '#4a3320';
      ctx.beginPath(); ctx.arc(-9, -32, 3.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -32, 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      rrect(ctx, -10, -26, 20, 7, 2); ctx.fill();
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-4, -26); ctx.lineTo(-4, -19); ctx.moveTo(0, -26); ctx.lineTo(0, -19); ctx.moveTo(4, -26); ctx.lineTo(4, -19); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -26, 10, Math.PI + 0.25, -0.25); ctx.stroke();
      // 汗滴（被按住时）
      if (holding) {
        ctx.fillStyle = 'rgba(140,220,255,0.9)';
        const sweat = Math.abs(Math.sin(now * 13));
        ctx.beginPath(); ctx.ellipse(-30, -52 - sweat * 9, 3.6, 5, -0.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(30, -50 - (1 - sweat) * 9, 3.6, 5, 0.5, 0, TAU); ctx.fill();
      }
      // 大帽（青蓝，平面单色 + 帽檐暗边）
      ctx.fillStyle = '#2fb3c9';
      ctx.beginPath();
      ctx.arc(0, -58, 52, Math.PI, 0);
      ctx.quadraticCurveTo(0, -42, -52, -58);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b8ba0';
      ctx.beginPath();
      ctx.ellipse(0, -46, 45, 6.5, 0, 0, TAU); ctx.fill();
      // 白点
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(-20, -74, 6.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -82, 5.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(30, -64, 4.2, 0, TAU); ctx.fill();
      // 金冠（戴在帽顶，红宝石）
      ctx.save();
      ctx.translate(0, -104);
      ctx.fillStyle = '#ffd23e';
      ctx.strokeStyle = '#e8a01f'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, 8);
      ctx.lineTo(-23, -10); ctx.lineTo(-11, -3); ctx.lineTo(0, -15);
      ctx.lineTo(11, -3); ctx.lineTo(23, -10); ctx.lineTo(20, 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff5f6d';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.restore();
    }};
  }

  // ---------- 普通敌人（billboard 美术，朝向镜头） ----------
  function drawGrumpy(x, y, now, e, dead) {
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

  // ---------- 速度光痕 ----------
  function drawStreaks() {
    if (!streaks.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of streaks) {
      const p1 = project(s.x, s.y, s.z), p2 = project(s.x, s.y, s.z + s.len);
      if (!p1 || !p2) continue;
      ctx.globalAlpha = s.a * fogAlpha(p1.zc);
      ctx.strokeStyle = s.col;
      ctx.lineWidth = Math.max(1, 0.045 * p1.s);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- 角色（正视角越肩，左右侧步斩击，奔跑时回头看向镜头） ----------
  function drawPlayer(t) {
    const C = charCfg || CHARACTERS[0];
    const act = player.actT > 0;
    const holding = hold.enemy !== null;          // 正在长按菇霸
    // 结算舞台：通关谢幕跳舞（等级越高越疯狂），失败则低头沮丧
    const onStage = state === 'result' && !!resultInfo;
    const encore = onStage && resultInfo.clear;
    const sad = onStage && !resultInfo.clear;
    const attacking = act || holding;
    const ph = act ? 1 - player.actT / ACT_DUR : 0.45;
    const dir = player.actT > 0 ? (player.actTrack === 'A' ? 1 : -1)
              : holding ? (hold.track === 'A' ? 1 : -1) : 0;   // +1 右道 / -1 左道

    // 侧步：向目标车道滑移
    const leanTarget = dir !== 0 ? dir * 1.18 : 0;
    player.leanX += (leanTarget - player.leanX) * ((act || holding) ? 0.3 : 0.16);
    const pf = project(player.leanX, 0, 0);
    if (!pf) return;
    const u = pf.s / PPU;

    const faceTarget = sad ? 0.55 : (attacking || holding) ? 0.05 : 1;
    faceTurn += (faceTarget - faceTurn) * 0.14;

    // 接地阴影
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#14051f';
    const shR = 0.62 * pf.s;
    ctx.beginPath();
    ctx.ellipse(pf.x, pf.y, shR, shR * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const run = !attacking;
    const danceE = encore ? (resultInfo.rank === 'S' ? 1.6 : resultInfo.rank === 'A' ? 1.25 : 1) : 0;
    let bounce = run ? Math.abs(Math.sin(t * 9)) * 8 : 0;
    if (encore) bounce = Math.abs(Math.sin(t * 6.5)) * 12 * danceE;
    if (sad) bounce = 0;
    const hop = act ? Math.sin(ph * Math.PI) * 16
              : holding ? Math.sin(t * 10) * 3 + 8   // 按住时压低重心发力
              : encore ? Math.sin(t * 13) * 5 * danceE
              : 0;
    const lp = t * 13;
    const hurtBlink = player.hurtT > 0 && Math.floor(player.hurtT * 18) % 2 === 0;

    ctx.save();
    ctx.translate(pf.x, pf.y);
    ctx.scale(u, u);
    ctx.rotate(player.leanX * 0.09);            // 侧步倾斜
    if (encore) ctx.rotate(Math.sin(t * 3.2) * 0.1 * danceE);   // 跳舞转圈感
    if (sad) ctx.rotate(0.15);                                  // 失败低头垂丧
    ctx.translate(0, -bounce - hop);
    if (hurtBlink) ctx.globalAlpha = 0.45;

    // ---- 腿 + 靴子（侧步时蹬向目标车道） ----
    const swing = run ? Math.sin(lp) : 0;
    const liftL = run ? Math.max(0, Math.cos(lp)) * 12 : 0;
    const liftR = run ? Math.max(0, -Math.cos(lp)) * 12 : 0;
    const stance = attacking ? dir * 8 : 0;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.skin; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(-13, -56); ctx.lineTo(-15 + swing * 7 + stance, -7 - liftL); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, -56); ctx.lineTo(15 - swing * 7 + stance * 0.5, -7 - liftR); ctx.stroke();
    ctx.fillStyle = C.boot;
    ctx.beginPath(); ctx.ellipse(-15 + swing * 7 + stance, -5 - liftL, 11, 6.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(15 - swing * 7 + stance * 0.5, -5 - liftR, 11, 6.5, 0, 0, TAU); ctx.fill();

    // ---- 连衣裙（背面钟形） + 背后蝴蝶结 ----
    ctx.fillStyle = C.dress;
    ctx.beginPath();
    ctx.moveTo(-36, -52);
    ctx.quadraticCurveTo(-32, -82, -23, -100);
    ctx.lineTo(23, -100);
    ctx.quadraticCurveTo(32, -82, 36, -52);
    ctx.quadraticCurveTo(24, -45, 12, -51);
    ctx.quadraticCurveTo(0, -43, -12, -51);
    ctx.quadraticCurveTo(-24, -45, -36, -52);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,10,50,0.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-32, -60); ctx.quadraticCurveTo(0, -52, 32, -60); ctx.stroke();
    ctx.fillStyle = C.cap;
    ctx.beginPath(); ctx.moveTo(0, -98); ctx.lineTo(-16, -108); ctx.lineTo(-13, -90); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -98); ctx.lineTo(16, -108); ctx.lineTo(13, -90); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -98, 6, 0, TAU); ctx.fill();

    // ---- 左臂（随奔跑摆动） ----
    ctx.strokeStyle = C.skin; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-21, -98); ctx.lineTo(-30 - swing * 5, -74 + Math.abs(swing) * 4); ctx.stroke();

    // ---- 头 ----
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(0, -138, 40, 0, TAU); ctx.fill();

    // ---- 脸（回头杀：面向镜头时浮现） ----
    if (faceTurn > 0.03) {
      const ex = lerp(22, -13, faceTurn);
      const savedAlpha = ctx.globalAlpha;
      ctx.globalAlpha = savedAlpha * Math.pow(faceTurn, 0.7);
      const blinkOn = (t % 3.4) > 3.25;
      ctx.fillStyle = '#3a2340';
      if (blinkOn) {
        ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex - 17, -141); ctx.lineTo(ex - 7, -141); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex + 5, -141); ctx.lineTo(ex + 15, -141); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.ellipse(ex - 12, -141, 4.6, 5.4, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(ex + 10, -141, 4.6, 5.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex - 10.6, -143, 1.8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + 11.4, -143, 1.8, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = C.blush;
      ctx.beginPath(); ctx.arc(ex - 21, -131, 5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 19, -131, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ex - 1, -133, 5, 0.25, Math.PI - 0.25); ctx.stroke();
      ctx.globalAlpha = savedAlpha;
    }

    // ---- 蘑菇帽 ----
    ctx.fillStyle = C.cap;
    ctx.save();
    ctx.translate(0, -146);
    ctx.scale(1, 0.94);
    ctx.beginPath();
    ctx.arc(0, 0, 48, Math.PI, 0);
    ctx.quadraticCurveTo(0, 14, -48, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,10,50,0.22)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-46, -144); ctx.quadraticCurveTo(0, -132, 46, -144); ctx.stroke();
    ctx.fillStyle = C.capDot;
    ctx.beginPath(); ctx.arc(-24, -168, 7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -178, 5.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(30, -158, 4.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-4, -186, 3.6, 0, TAU); ctx.fill();

    // ---- 星星法杖（右手；攻击横扫，长按时前指发力） ----
    let ang = -1.05 + (run ? Math.sin(t * 9) * 0.07 : 0);
    if (act) ang = dir === 1 ? lerp(-2.4, -0.35, ph) : lerp(-0.7, -2.7, ph);
    else if (holding) ang = (dir === 1 ? -1.05 : -2.05) + Math.sin(t * 14) * 0.07;
    ctx.save();
    ctx.translate(23, -102);
    ctx.rotate(ang);
    ctx.strokeStyle = C.dress === '#ffffff' ? '#fff' : C.dress;
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(36, 0); ctx.stroke();
    drawStar(ctx, 44, 0, 12, t * 3, '#ffd76e', '#e8a01f');
    ctx.restore();

    ctx.restore();
  }

  // ---------- 其它绘制 ----------
  function drawSlashes() {
    for (const s of slashes) {
      const ph = s.t / 0.22;
      const laneX = (LANE_X[s.track] ?? 0) * 0.95;
      const a = project(laneX, 0.7, 1.0);
      if (!a) continue;
      ctx.save();
      bill(a);
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lerp(14, 3, ph);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 62, -1.5 + ph * 0.7, 0.9 + ph * 0.7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,220,255,0.8)';
      ctx.lineWidth = lerp(6, 1.5, ph);
      ctx.beginPath();
      ctx.arc(0, 0, 74, -1.3 + ph * 0.7, 0.7 + ph * 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const pr = project(p.x, p.y, p.z);
      if (!pr) continue;
      ctx.globalAlpha = (1 - p.t / p.life) * fogAlpha(pr.zc);
      if (p.heart) {
        const hs = Math.max(2, p.r * pr.s * 1.9);
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.scale(hs / 12, hs / 12);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, 4);
        ctx.bezierCurveTo(0, -6, -16, -6, -16, 4);
        ctx.bezierCurveTo(-16, 12, 0, 18, 0, 24);
        ctx.bezierCurveTo(0, 18, 16, 12, 16, 4);
        ctx.bezierCurveTo(16, -6, 0, -6, 0, 4);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.star) {
        drawStar(ctx, pr.x, pr.y, Math.max(2, p.r * pr.s * 1.6), p.t * 4, p.color, null);
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, Math.max(1, p.r * pr.s), 0, TAU);
      ctx.fill();
    }
    // 击破冲击波：贴地扩散的彩色光环
    for (const r of rings) {
      if (r.t < 0) continue;              // 延迟环还没到出场时间
      const k = r.t / 0.32;
      const pr = project(r.x, r.y, r.z);
      if (!pr) continue;
      const rad = Math.max(1, (0.3 + k * 1.7) * pr.s);
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = Math.max(1.5, 9 * (1 - k) * pr.s / PPU);
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y, rad, rad * 0.35, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawFloats() {
    for (const f of floats) {
      const ph = f.t / 0.9;
      ctx.globalAlpha = ph < 0.7 ? 1 : (1 - ph) / 0.3;
      strokeText(ctx, f.text, f.x, f.y - ph * 46, f.size, f.color);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD（竖屏布局） ----------
  function drawHUD(now) {
    const prog = clamp(now / (song.lastTime + 0.01), 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rrect(ctx, 60, 22, W - 120, 8, 4); ctx.fill();
    ctx.fillStyle = '#fff';
    rrect(ctx, 60, 22, (W - 120) * prog, 8, 4); ctx.fill();

    strokeText(ctx, String(Math.round(displayScore)).padStart(7, '0'), 36, 62, 40, '#fff', 'left');
    strokeText(ctx, `${songDef.name} · ${Chart.DIFFS[diffKey].label}`, 36, 96, 16, '#f2e6ff', 'left', 3);
    if (feverT > 0) strokeText(ctx, 'x2', 268, 62, 26, '#ffd23e', 'left');

    // 血量（右上）
    const bw = 250, bx = W - bw - 96, by = 52;
    ctx.save();
    ctx.translate(bx - 32, by + 10);
    const beat = hp < charCfg.hp * 0.3 ? 1 + Math.sin(perfT * 9) * 0.12 : 1;
    ctx.scale(1.35 * beat, 1.35 * beat);
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

    // FEVER（底部中央）
    const fw = 340, fx = W / 2 - fw / 2, fy = H - 150;
    strokeText(ctx, 'FEVER', W / 2, fy - 16, 18, feverT > 0 ? '#ffd23e' : '#ffe9a8');
    ctx.fillStyle = 'rgba(30,10,40,0.45)';
    rrect(ctx, fx, fy, fw, 16, 8); ctx.fill();
    const g2 = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    g2.addColorStop(0, '#ffd23e'); g2.addColorStop(1, '#ff8a3c');
    ctx.fillStyle = g2;
    rrect(ctx, fx + 3, fy + 3, (fw - 6) * (feverT > 0 ? 1 : fever / 100), 10, 5); ctx.fill();
    if (feverT > 0 && Math.floor(perfT * 5) % 2) strokeText(ctx, 'FEVER!!', W / 2, fy + 42, 26, '#ffd23e');

    // 连击（放在天空区，不挡来敌通道；高连击变色；每 25 连爆闪一圈）
    if (combo >= 5) {
      const pop = clamp(1 - comboPopT / 0.18, 0, 1);
      const sc = 1 + pop * 0.35;
      const col = feverT > 0 ? `hsl(${Math.round((perfT * 300) % 360)}, 100%, 72%)`
               : combo >= 100 ? '#ffb03c' : combo >= 50 ? '#ffd23e' : '#fff';
      if (comboBurstT < 0.22) {          // 里程碑放射线
        const k = comboBurstT / 0.22;
        ctx.save();
        ctx.translate(W / 2, 325);
        ctx.rotate(k * 0.35);
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = '#ffd23e';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        const r0 = 70 + k * 46, r1 = r0 + 34;
        for (let i = 0; i < 12; i++) {
          const a = i * TAU / 12;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.save();
      ctx.translate(W / 2, 325);
      ctx.scale(sc, sc);
      ctx.rotate(Math.sin(pop * Math.PI) * 0.05);
      strokeText(ctx, String(combo), 0, 0, 76, col);
      strokeText(ctx, 'COMBO', 0, 52, 22, '#ffd9ec');
      ctx.restore();
    }

    // 开场倒计时
    if (now < 0) {
      const n = Math.ceil(-now);
      strokeText(ctx, n > 0 ? String(n) : 'GO!', W / 2, 300, n > 0 ? 110 : 130, '#fff');
      strokeText(ctx, 'READY?', W / 2, 380, 34, '#ffd9ec');
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
    const now = songNow();
    // 节拍脉冲：随鼓点做一次急促衰减的呼吸
    let pulse = 0;
    if (inGame && song) {
      const bp = ((t / song.spb) % 1 + 1) % 1;
      pulse = Math.pow(1 - bp, 4);
    }

    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 24, rand(-1, 1) * shake * 24);
    if (pulse > 0) {   // 全画面轻微前冲
      ctx.translate(W / 2, H * 0.55);
      const zs = 1 + pulse * 0.01;
      ctx.scale(zs, zs);
      ctx.translate(-W / 2, -H * 0.55);
    }
    if (punchT > 0) {  // 击杀镜头冲镜：朝击破点快速推近
      const k = punchT / 0.14;
      ctx.translate(punchX, punchY);
      const zk = 1 + 0.03 * k;
      ctx.scale(zk, zk);
      ctx.translate(-punchX, -punchY);
    }

    drawSky(t, feverMix, pulse);
    drawGround(t, feverMix, pulse);
    drawWorldItems(t, now, inGame, feverMix);
    drawStreaks();
    drawPlayer(t);
    for (const it of holdItemsLayer) it.draw();   // 菇霸在角色之上
    if (inGame && song) {
      drawSlashes();
      drawParticles();
      drawFloats();
      drawHUD(now);
    }

    if (feverMix > 0) {
      ctx.fillStyle = `rgba(255,180,60,${feverMix * 0.12})`;
      ctx.fillRect(0, 0, W, H);
      const hue = Math.round((perfT * 160) % 360);
      ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${(feverMix * 0.05).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (flashT > 0) {
      ctx.fillStyle = flashCol;
      ctx.globalAlpha = clamp(flashT * 3, 0, 0.5);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (redFlash > 0) {
      ctx.fillStyle = `rgba(255,40,80,${redFlash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    // FEVER：舞台灯光秀（顶部跑马灯 + 双探照灯扫场，半透明不挡视野）
    if (feverMix > 0) drawStageLights(t, feverMix);
    // FEVER：全屏霓虹灯框（色相轮转 + 呼吸闪烁）
    if (feverMix > 0) {
      const hue = Math.round((perfT * 160) % 360);
      ctx.save();
      ctx.globalAlpha = feverMix * (0.42 + 0.2 * Math.sin(perfT * 9));
      ctx.strokeStyle = `hsl(${hue}, 100%, 62%)`;
      ctx.lineWidth = 7;
      ctx.strokeRect(6, 6, W - 12, H - 12);
      ctx.globalAlpha = feverMix * (0.16 + 0.1 * Math.sin(perfT * 9 + 1));
      ctx.lineWidth = 18;
      ctx.strokeRect(6, 6, W - 12, H - 12);
      ctx.restore();
    }
  }

  // ---------- FEVER 舞台灯光秀：彩虹 + 跑马灯 + 双探照灯 ----------
  function drawStageLights(t, k) {
    // 彩虹：横跨天空的七彩拱（随节拍闪烁）
    if (HORIZON_Y > 170) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, HORIZON_Y - 4); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const rcols = ['#ff5f6d', '#ff9a5c', '#ffd23e', '#7ee787', '#6ec6ff', '#9b8cff'];
      const rw = 9;
      for (let i = 0; i < rcols.length; i++) {
        ctx.globalAlpha = k * (0.10 + 0.13 * Math.abs(Math.sin(t * 2.4 + i * 0.8)));
        ctx.strokeStyle = rcols[i];
        ctx.lineWidth = rw;
        ctx.beginPath();
        ctx.arc(W / 2, HORIZON_Y + 140, 330 + i * rw, Math.PI * 1.02, Math.PI * 1.98);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 顶部跑马灯：一排小彩灯依次点亮
    const n = 14;
    for (let i = 0; i < n; i++) {
      const x = 26 + i * ((W - 52) / (n - 1));
      const on = Math.floor(t * 9) % n === i;
      const hue = Math.round((i * 47 + t * 60) % 360);
      ctx.save();
      ctx.globalAlpha = k * (on ? 0.95 : 0.28);
      ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
      ctx.beginPath(); ctx.arc(x, 15, on ? 7 : 4.5, 0, TAU); ctx.fill();
      if (on) {
        ctx.globalAlpha = k * 0.35;
        ctx.beginPath(); ctx.arc(x, 15, 14, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    // 双探照灯：左右上角各三束，往天空和路面来回扫
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sources = [[36, -10], [W - 36, -10]];
    for (const [sx, sy] of sources) {
      for (let i = 0; i < 3; i++) {
        const a = 1.35 + Math.sin(t * 0.8 + i * 2.1 + sx) * 0.5 + i * 0.42;
        const len = H * 1.2, spread = 0.085;
        const hue = Math.round((t * 90 + i * 110 + sx) % 360);
        const g = ctx.createLinearGradient(sx, sy, sx + Math.sin(a) * len, sy + Math.cos(a) * len);
        g.addColorStop(0, `hsla(${hue}, 100%, 68%, ${(0.15 * k).toFixed(3)})`);
        g.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.sin(a - spread) * len, sy + Math.cos(a - spread) * len);
        ctx.lineTo(sx + Math.sin(a + spread) * len, sy + Math.cos(a + spread) * len);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = k * (0.45 + 0.45 * Math.sin(t * 12 + i * 2.2));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx, sy + 4, 5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  // ---------- 主循环 ----------
  let lastTs = 0;
  function step(dt) {
    perfT += dt;
    comboPopT += dt;
    comboBurstT += dt;
    if (combo !== lastCombo) { comboPopT = 0; lastCombo = combo; }
    if (state === 'playing') update(dt);
    updateFx(dt);
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
      case 'ArrowLeft': case 'KeyA': case 'KeyF':
        attack('G'); e.preventDefault(); break;    // 斩左道
      case 'ArrowRight': case 'KeyD': case 'KeyJ':
        attack('A'); e.preventDefault(); break;    // 斩右道
    }
  });
  // 松开按键 → 结束长按（撑到尾巴算完成，提前松手菇霸逃跑）
  window.addEventListener('keyup', e => {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA' || k === 'KeyF') releaseHold('G');
    else if (k === 'ArrowRight' || k === 'KeyD' || k === 'KeyJ') releaseHold('A');
  });
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (state !== 'playing') return;
    for (const tch of e.changedTouches) {
      const rect = canvas.getBoundingClientRect();
      const x = (tch.clientX - rect.left) / rect.width * W;
      attack(x < W / 2 ? 'G' : 'A');               // 左半屏斩左道，右半屏斩右道
    }
  }, { passive: false });
  const endTouch = e => {
    if (!hold.enemy) return;
    for (const tch of e.changedTouches) {
      const rect = canvas.getBoundingClientRect();
      const x = (tch.clientX - rect.left) / rect.width * W;
      releaseHold(x < W / 2 ? 'G' : 'A');
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

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
      comboBurstT += dt;
      if (combo !== lastCombo) { comboPopT = 0; lastCombo = combo; }
      if (state === 'playing') update(clamp(dt, 0, 0.05));
      updateFx(clamp(dt, 0, 0.05));
      if (withRender) render();
    },
    info() {
      return {
        state, combo, maxCombo, fever: Math.round(fever), feverT, hp: Math.round(hp),
        score, songT: songNow(), counts: { ...counts },
        holding: hold.enemy ? hold.track : null,
        song: songId, char: charId, diff: diffKey,
      };
    },
    nearest(skipChains = false) {
      if (!song) return null;
      const now = songNow();
      let best = null;
      for (const e of enemies) {
        if (e.state !== 'live') continue;
        if (skipChains && e.kind !== 'normal') continue;
        const d = e.time - now;
        if (d < -HIT_WINDOW) continue;
        if (!best || d < best.dt) best = { track: e.track, dt: d, kind: e.kind };
      }
      return best;
    },
    nearestCandy() {
      if (!song) return null;
      const now = songNow();
      let best = null;
      for (const c of candies) {
        if (c.done) continue;
        const d = c.time - now;
        if (d < -CANDY_WIN) continue;
        if (!best || d < best.dt) best = { track: c.track, dt: d };
      }
      return best;
    },
  };
})();
