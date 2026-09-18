'use strict';
/* ============================================================
 * MushDash 谱面生成器
 * 48 小节 / 138BPM 的歌曲结构：intro → verse → chorus → verse
 * → chorus → outro，每个小节从对应密度的模式库随机抽取，
 * 保证敌人与音乐节拍严格对齐。
 * ============================================================ */
const Chart = (() => {
  const BARS = 48;
  const BPM = 138;
  const BEAT = 60 / BPM;          // 一拍时长（秒）
  const TOTAL_BEATS = BARS * 4;

  // 每小节所属段落
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

  /* 模式库：每个元素是一小节的事件列表
   * 事件 = [拍位(0~3.75), 轨道 'G'地面/'A'空中, 类型 'n'普通/'c'连打链, 链长] */
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

  // 尾声：稀疏收尾
  const OUTRO = [
    [[0,'G','n'],[2,'A','n']],
    [[0,'A','n'],[2,'G','n']],
    [[1,'G','n'],[3,'A','n']],
  ];

  const DIFFS = {
    easy:   { label: '轻松', pxPerSec: 430, candyChance: 0.45 },
    normal: { label: '普通', pxPerSec: 505, candyChance: 0.55 },
    hard:   { label: '狂热', pxPerSec: 585, candyChance: 0.60 },
  };

  function generate(diffKey) {
    const d = DIFFS[diffKey] || DIFFS.normal;
    let gid = 0;
    const events = [];

    for (let bar = 0; bar < BARS; bar++) {
      const sec = sectionAt(bar);
      if (sec === 'intro') continue;                 // 前奏只出糖果热身
      const pool = sec === 'outro' ? OUTRO
                 : sec === 'chorus' ? POOLS[diffKey].chorus : POOLS[diffKey].verse;
      const pat = pool[Math.floor(Math.random() * pool.length)];
      for (const ev of pat) {
        const beat = bar * 4 + ev[0];
        if (ev[2] === 'c') {
          const gap = diffKey === 'hard' ? 0.5 : 1;  // 连打链珠间距
          const id = gid++;
          for (let i = 0; i < ev[3]; i++)
            events.push({ beat: beat + i * gap, track: ev[1], kind: 'chain', groupId: id });
        } else {
          events.push({ beat, track: ev[1], kind: 'normal', groupId: null });
        }
      }
    }

    // 按时间排序并去掉同一拍同一轨道的冲突
    events.sort((a, b) => a.beat - b.beat);
    const clean = [];
    for (const e of events) {
      const prev = clean[clean.length - 1];
      if (prev && Math.abs(prev.beat - e.beat) < 0.01 && prev.track === e.track) continue;
      clean.push(e);
    }

    // 糖果：前奏 16 颗热身串，正篇在空闲反拍随机撒
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
    for (const e of clean) lastTime = Math.max(lastTime, e.beat * BEAT);

    return {
      events: clean, candies,
      totalBeats: TOTAL_BEATS,
      lastTime,
      speed: d.pxPerSec,      // 敌人移动速度（像素/秒）
      spb: BEAT,
    };
  }

  return { generate, DIFFS, BARS, BPM, BEAT, sectionAt };
})();
