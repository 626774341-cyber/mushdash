'use strict';
/* ============================================================
 * MushDash 曲目与谱面生成器
 * 三首曲目各自拥有独立的 BPM / 敌速 / 配色主题 / 旋律素材。
 * 每小节从对应密度的模式库随机抽取，保证敌人与音乐节拍严格对齐。
 * ============================================================ */
const Chart = (() => {
  const BARS = 48;

  const _ = null;
  /* ---------- 旋律素材（各调五声音阶，16 步 / 小节，null = 休止） ---------- */
  const MUSIC = {
    meadow: {
      wave: 'square',
      chords: [                                   // C - G - Am - F
        { r: 48, pad: [64, 67, 72] },
        { r: 43, pad: [62, 67, 74] },
        { r: 45, pad: [60, 64, 69] },
        { r: 41, pad: [60, 65, 69] },
      ],
      lead: {
        intro: [[72,_,_,_, 74,_,_,_, 76,_,_,_, 74,_,72,_]],
        verse: [
          [72,_,74,_, 76,_,74,72, 69,_,67,_, 64,_,67,_],
          [72,_,76,_, 79,_,76,74, 72,_,69,_, 67,_,64,_],
          [76,_,79,_, 81,_,79,76, 74,_,72,_, 74,_,76,_],
          [79,76,74,_, 72,_,74,72, 69,_,67,_, 64,_,67,_],
        ],
        chorus: [
          [76,79,81,79, 84,_,81,79, 76,72,74,76, 79,_,_,_],
          [81,79,76,79, 81,81,_,79, 76,74,72,74, 76,_,_,_],
          [84,_,81,_, 79,81,79,76, 72,_,76,_, 79,_,81,_],
          [81,_,79,_, 76,79,76,72, 74,_,76,_, 72,_,_,_],
        ],
        outro: [[72,_,_,_, 67,_,_,_, 64,_,_,_, 60,_,62,_]],
      },
    },
    neon: {
      wave: 'square',
      chords: [                                   // Am - F - C - G
        { r: 45, pad: [57, 64, 72] },
        { r: 41, pad: [57, 65, 72] },
        { r: 48, pad: [55, 64, 72] },
        { r: 43, pad: [55, 62, 71] },
      ],
      lead: {
        intro: [[69,_,_,_, 72,_,_,_, 76,_,_,_, 74,_,72,_]],
        verse: [
          [69,_,72,_, 76,_,74,72, 69,_,67,_, 64,_,67,_],
          [69,_,72,_, 74,_,72,69, 67,_,64,_, 62,_,64,_],
          [72,_,74,_, 76,_,79,76, 74,_,72,_, 69,_,72,_],
          [74,72,69,_, 67,_,69,67, 64,_,62,_, 60,_,62,64],
        ],
        chorus: [
          [76,74,72,74, 76,76,_,72, 74,72,69,72, 74,_,_,_],
          [77,76,74,76, 77,77,_,74, 76,74,72,74, 76,_,_,_],
          [79,_,76,_, 74,76,74,72, 69,_,72,_, 74,_,76,_],
          [77,_,74,_, 72,74,72,69, 67,_,69,_, 64,_,67,_],
        ],
        outro: [[69,_,_,_, 64,_,_,_, 67,_,_,_, 64,_,62,_]],
      },
    },
    midnight: {
      wave: 'sawtooth',
      chords: [                                   // Em - C - G - D
        { r: 40, pad: [64, 67, 71] },
        { r: 48, pad: [60, 64, 67] },
        { r: 43, pad: [62, 67, 71] },
        { r: 50, pad: [62, 66, 69] },
      ],
      lead: {
        intro: [[76,_,_,_, 79,_,_,_, 81,_,_,_, 79,_,76,_]],
        verse: [
          [64,_,67,_, 71,_,69,67, 64,_,62,_, 64,_,67,_],
          [71,_,74,_, 76,_,74,71, 69,_,67,_, 69,_,71,_],
          [76,_,79,_, 81,_,79,76, 74,_,71,_, 69,_,71,_],
          [79,76,74,_, 71,_,74,71, 69,_,67,_, 64,_,67,_],
        ],
        chorus: [
          [76,79,83,79, 81,_,83,79, 81,79,76,79, 83,_,_,_],
          [81,83,81,79, 76,79,76,74, 71,_,74,_, 76,_,79,_],
          [83,_,81,_, 79,81,79,76, 74,_,76,_, 79,_,83,_],
          [81,79,76,_, 74,_,76,74, 71,_,69,_, 67,_,64,_],
        ],
        outro: [[64,_,_,_, 62,_,_,_, 64,_,_,_, 67,_,64,_]],
      },
    },
    lime: {
      wave: 'sawtooth',
      chords: [                                   // Em - C - G - D
        { r: 40, pad: [64, 67, 71] },
        { r: 48, pad: [60, 64, 67] },
        { r: 43, pad: [62, 67, 71] },
        { r: 50, pad: [62, 66, 69] },
      ],
      lead: {                                     // 三音洗脑 riff 反复，club hook 式写法
        intro: [[76,_,_,_, 76,_,79,_, 76,_,74,_, 76,_,_,_]],
        verse: [
          [76,_,_,76, _,76,_,_, 79,_,_,76, _,74,_,_],
          [76,_,_,76, _,76,_,_, 81,_,79,_, 76,_,_,_],
          [74,_,_,74, _,74,_,_, 76,_,_,74, _,72,_,_],
          [71,_,_,71, _,72,_,74, 76,_,_,_, _,_,_,_],
        ],
        chorus: [
          [76,79,81,79, 76,79,81,83, 81,79,76,79, 81,_,83,_],
          [86,_,83,_, 81,83,81,79, 76,_,79,_, 81,_,79,_],
          [83,81,79,81, 83,83,_,81, 79,76,79,81, 83,_,79,_],
          [81,79,76,79, 81,_,83,_, 86,_,83,_, 81,79,76,_],
        ],
        outro: [[76,_,_,_, _,_,_,_, 74,_,_,_, _,_,_,_]],
      },
    },
  };

  /* ---------- 曲目定义 ---------- */
  const SONGS = [
    {
      id: 'meadow', name: '草原漫步', en: 'Meadow Walk',
      bpm: 128, emoji: '🌻', desc: '清新明快 · 节奏舒缓，入门首选',
      speeds: { easy: 400, normal: 465, hard: 540 },
      music: MUSIC.meadow,
      palette: {
        sky: ['#bfefff', '#eaffdc'], sun: '#fff7c0', cloudA: 0.92, night: false,
        hillFar: '#b8e6b0', hillNear: '#8fd68b',
        grass: '#7ed67e', grassLit: '#98e58a', grassDark: '#6cc46c',
        dirt: '#c7935f', dirtDark: '#b07f4d',
        treeCap: ['#ff9fbf', '#ffd76e'], trunk: '#fff1f4',
      },
    },
    {
      id: 'neon', name: '霓虹疾走', en: 'Neon Rush',
      bpm: 138, emoji: '🌆', desc: '黄昏城市 · 标准手感，原味体验',
      speeds: { easy: 430, normal: 505, hard: 585 },
      music: MUSIC.neon,
      palette: {
        sky: ['#f6c6ff', '#9db8ff'], sun: '#fff0b8', cloudA: 0.8, night: false,
        hillFar: '#d9bde8', hillNear: '#a58cd9',
        grass: '#8f7ed6', grassLit: '#ab97e8', grassDark: '#7a6ac4',
        dirt: '#6b5a9e', dirtDark: '#5a4a8a',
        treeCap: ['#ff6b9d', '#4dd0e1'], trunk: '#f4e8ff',
      },
    },
    {
      id: 'midnight', name: '午夜狂奔', en: 'Midnight Dash',
      bpm: 152, emoji: '🌙', desc: '深夜电音 · 高速高压，为高手准备',
      speeds: { easy: 455, normal: 540, hard: 625 },
      music: MUSIC.midnight,
      palette: {
        sky: ['#141b3d', '#2a3a6e'], sun: '#f4f1de', cloudA: 0.22, night: true,
        hillFar: '#3a4a7a', hillNear: '#2c3a66',
        grass: '#3f5e46', grassLit: '#4f7457', grassDark: '#35503c',
        dirt: '#4a3b33', dirtDark: '#3b2f29',
        treeCap: ['#ff5f6d', '#4dd0e1'], trunk: '#cfd8ea',
      },
    },
    {
      id: 'lime', name: '酸柠狂潮', en: 'Acid Lime',
      bpm: 148, emoji: '💚', desc: '酸性绿舞池 · Hyper 节拍，全速冲锋',
      speeds: { easy: 470, normal: 550, hard: 635 },
      music: MUSIC.lime,
      palette: {
        sky: ['#8ace00', '#9fdc14'], sun: '#f4ffd6', cloudA: 0.55, night: false,
        hillFar: '#7cbf0a', hillNear: '#699f00',
        grass: '#8ace00', grassLit: '#a3e21a', grassDark: '#78b300',
        dirt: '#55631f', dirtDark: '#48541b',
        treeCap: ['#1f2a08', '#2f3d10'], trunk: '#e8f4d0',
      },
    },
  ];
  const getSong = id => SONGS.find(s => s.id === id) || SONGS[0];

  /* ---------- 段落结构（所有曲目共用） ---------- */
  const SECTIONS = [];
  for (let b = 0; b < BARS; b++) {
    SECTIONS.push(
      b < 4  ? 'intro'  :
      b < 20 ? 'verse'  :
      b < 28 ? 'chorus' :
      b < 36 ? 'verse'  :
      b < 44 ? 'chorus' : 'outro'
    );
  }
  const sectionAt = bar => SECTIONS[Math.max(0, Math.min(BARS - 1, bar))];

  /* 模式库：每小节事件 = [拍位(0~3.75), 轨道 'G'/'A', 类型 'n'/'c', 链长] */
  const POOLS = {
    easy: {
      verse: [
        [[0,'G','n'],[2,'G','n']],
        [[0,'A','n'],[2,'A','n']],
        [[0,'G','n'],[2,'A','n']],
        [[0,'A','n'],[2,'G','n']],
        [[1,'G','n'],[3,'G','n']],
        [[0,'G','n'],[1,'G','n'],[2,'G','n'],[3,'G','n']],
        [[0,'A','n'],[1,'A','n'],[2,'A','n'],[3,'A','n']],
      ],
      chorus: [
        [[0,'G','n'],[1,'G','n'],[2,'A','n'],[3,'A','n']],
        [[0,'A','n'],[1,'A','n'],[2,'G','n'],[3,'G','n']],
        [[0,'G','n'],[1,'A','n'],[2,'G','n'],[3,'A','n']],
        [[0,'G','c',2],[2,'A','n'],[3,'G','n']],
        [[0,'A','c',2],[2,'G','n'],[3,'A','n']],
        [[0,'G','n'],[1,'A','n'],[2,'A','n'],[3,'G','n']],
      ],
    },
    normal: {
      verse: [
        [[0,'G','n'],[2,'G','n']],
        [[0,'A','n'],[2,'A','n']],
        [[0,'G','n'],[2,'A','n']],
        [[0,'A','n'],[2,'G','n']],
        [[1,'G','n'],[3,'G','n']],
        [[0,'G','n'],[1,'G','n'],[2,'G','n'],[3,'G','n']],
        [[0,'A','n'],[1,'A','n'],[2,'A','n'],[3,'A','n']],
        [[0,'G','n'],[1,'A','n'],[2,'G','n'],[2.5,'A','n'],[3,'G','n']],
        [[0,'G','n'],[0.5,'A','n'],[2,'A','n'],[2.5,'G','n']],
        [[0,'G','c',3]],
        [[0,'G','n'],[1,'G','n'],[2,'A','n'],[3,'A','n'],[3.5,'G','n']],
      ],
      chorus: [
        [[0,'G','n'],[1,'A','n'],[1.5,'G','n'],[2,'A','n'],[3,'G','n']],
        [[0,'G','n'],[0,'A','n'],[2,'G','n'],[2.5,'A','n']],
        [[0,'G','c',3],[3,'A','n']],
        [[0,'A','n'],[1,'G','n'],[2,'A','n'],[2.5,'G','n'],[3,'A','n']],
        [[0,'G','n'],[1,'G','n'],[2,'G','c',2]],
        [[0,'A','n'],[0.5,'A','n'],[2,'G','n'],[2.5,'G','n'],[3.5,'A','n']],
      ],
    },
    hard: {
      verse: [
        [[0,'G','n'],[0.5,'A','n'],[1,'G','n'],[2,'A','n'],[2.5,'G','n'],[3,'A','n']],
        [[0,'G','n'],[1,'A','n'],[1.5,'G','n'],[2,'A','n'],[3,'G','n'],[3.5,'A','n']],
        [[0,'G','c',4]],
        [[0,'G','n'],[0,'A','n'],[1.5,'G','n'],[2,'A','n'],[2,'G','n'],[3.5,'A','n']],
        [[0,'A','n'],[1,'A','n'],[2,'G','n'],[2.5,'A','n'],[3,'G','n']],
      ],
      chorus: [
        [[0,'G','n'],[0.5,'A','n'],[1,'G','n'],[1.5,'A','n'],[2,'G','n'],[3,'A','n']],
        [[0,'G','c',4]],
        [[0,'A','c',4]],
        [[0,'G','n'],[0,'A','n'],[1,'G','n'],[1.5,'A','n'],[2,'G','n'],[2,'A','n'],[3,'G','n']],
        [[0,'G','n'],[1,'A','n'],[2,'G','n'],[2.5,'A','n'],[3,'G','n'],[3.5,'A','n']],
        [[0,'A','n'],[0.5,'G','n'],[1.5,'A','n'],[2,'G','n'],[3,'A','n'],[3.5,'G','n']],
      ],
    },
  };
  const OUTRO = [
    [[0,'G','n'],[2,'A','n']],
    [[0,'A','n'],[2,'G','n']],
    [[1,'G','n'],[3,'A','n']],
  ];

  const DIFFS = {
    easy:   { label: '轻松', candyChance: 0.45 },
    normal: { label: '普通', candyChance: 0.55 },
    hard:   { label: '狂热', candyChance: 0.60 },
  };

  function generate(song, diffKey) {
    const d = DIFFS[diffKey] || DIFFS.normal;
    const bpm = song.bpm;
    const beat = 60 / bpm;
    const speed = song.speeds[diffKey] || song.speeds.normal;
    let gid = 0;
    const events = [];

    for (let bar = 0; bar < BARS; bar++) {
      const sec = sectionAt(bar);
      if (sec === 'intro') continue;
      const pool = sec === 'outro' ? OUTRO
                 : sec === 'chorus' ? POOLS[diffKey].chorus : POOLS[diffKey].verse;
      const pat = pool[Math.floor(Math.random() * pool.length)];
      for (const ev of pat) {
        const beatPos = bar * 4 + ev[0];
        if (ev[2] === 'c') {
          const gap = diffKey === 'hard' ? 0.5 : 1;
          const id = gid++;
          for (let i = 0; i < ev[3]; i++)
            events.push({ beat: beatPos + i * gap, track: ev[1], kind: 'chain', groupId: id });
        } else {
          events.push({ beat: beatPos, track: ev[1], kind: 'normal', groupId: null });
        }
      }
    }

    events.sort((a, b) => a.beat - b.beat);
    const clean = [];
    for (const e of events) {
      const prev = clean[clean.length - 1];
      if (prev && Math.abs(prev.beat - e.beat) < 0.01 && prev.track === e.track) continue;
      clean.push(e);
    }

    const candies = [];
    for (let b = 0; b < 16; b++)
      candies.push({ beat: b * 0.5, track: b % 2 ? 'A' : 'G' });
    for (let bar = 4; bar < BARS; bar++) {
      for (const off of [1.5, 2.5, 3.5]) {
        if (Math.random() > d.candyChance) continue;
        const beat = bar * 4 + off;
        if (clean.some(e => Math.abs(e.beat - beat) < 0.3)) continue;
        candies.push({ beat, track: Math.random() < 0.5 ? 'A' : 'G' });
      }
    }

    let lastTime = 0;
    for (const e of clean) lastTime = Math.max(lastTime, e.beat * beat);

    return {
      events: clean, candies,
      totalBeats: BARS * 4,
      lastTime,
      speed,
      spb: beat,
    };
  }

  return { generate, SONGS, getSong, DIFFS, BARS, sectionAt };
})();
