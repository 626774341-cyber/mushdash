'use strict';
/* ============================================================
 * MushDash 音频系统：Web Audio 程序化 chiptune + 音效
 * 以 AudioContext 时钟为准调度 16 分音符，游戏逻辑全部
 * 挂在 songTime() 上，音乐与谱面天然同步；暂停用
 * ctx.suspend()，时钟冻结，恢复零漂移。
 * 曲目通过 startSong(songDef, totalSteps) 注入：
 * BPM、和弦进行、旋律素材、主音色都随歌切换。
 * ============================================================ */
const AudioSys = (() => {
  const F = m => 440 * Math.pow(2, (m - 69) / 12);   // MIDI → 频率

  let ctx = null, master, musicGain, sfxGain, noiseBuf;
  let duckGain = null;            // 侧链泵感总线：kick 触发时整体下压再回弹
  let echoSend = null, echoDelay = null;  // 主旋律回声总线（附点八分）
  let muted = false;
  let songTimer = null, stepIdx = 0, nextStepT = 0, totalSteps = 0;
  let songStartT = 0, playing = false;
  let cur = null;                                    // 当前歌曲定义
  let STEP = 60 / 138 / 4;

  // 自动化测试模式（?testclock=1）：用 40 倍速性能时钟驱动游戏时间，
  // BGM 静默跳过，方便脚本快速跑完整局。正常游玩不携带该参数，行为完全不变。
  const TEST_CLOCK = /[?&#]testclock=1/.test(location.href);
  const TEST_SPEED = 40;
  let testT0 = performance.now() / 1000;
  let pausedAt = null;

  function ensure() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.42;
    musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55;
    sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 舞曲总线：music → duck（侧链泵感）→ master；lead → echo（回声）→ duck
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    musicGain.disconnect();
    musicGain.connect(duckGain); duckGain.connect(master);
    echoSend = ctx.createGain(); echoSend.gain.value = 0.22;
    echoDelay = ctx.createDelay(1); echoDelay.delayTime.value = 0.26;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const wet = ctx.createGain(); wet.gain.value = 0.8;
    echoSend.connect(echoDelay);
    echoDelay.connect(fb); fb.connect(echoDelay);
    echoDelay.connect(wet); wet.connect(duckGain);
    return ctx;
  }
  function resumeCtx() {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
  }
  const tnow = () => {
    if (!TEST_CLOCK) return ctx.currentTime;
    if (pausedAt !== null) return pausedAt;
    return testT0 + (performance.now() / 1000 - testT0) * TEST_SPEED;
  };

  /* ---------- 基础发声 ---------- */
  function tone({ t, f0, f1, dur, type = 'square', vol = 0.2, dest, attack = 0.004, lp = 0 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(dest || musicGain);
    o.start(t); o.stop(t + dur + 0.06);
  }
  function noise({ t, dur, vol = 0.2, hp = 0, dest }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = s;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp;
      node.connect(f); node = f;
    }
    node.connect(g); g.connect(dest || musicGain);
    s.start(t); s.stop(t + dur + 0.06);
  }

  const kick  = (t, v = 1) => {
    tone({ t, f0: 150, f1: 44, dur: 0.22, type: 'sine', vol: 0.6 * v });
    // 侧链泵感：底鼓瞬间压低音乐总线，随后回弹（club 音乐的呼吸感）
    if (duckGain) {
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(0.5, t);
      duckGain.gain.linearRampToValueAtTime(1, t + 0.2);
    }
  };
  const snare = (t, v = 1) => {
    noise({ t, dur: 0.1, vol: 0.2 * v, hp: 1500 });
    tone({ t, f0: 210, f1: 150, dur: 0.08, type: 'triangle', vol: 0.16 * v });
  };
  const hat  = (t, open = false, v = 1) => noise({ t, dur: open ? 0.14 : 0.035, vol: 0.07 * v, hp: 6800 });
  const bass = (t, f, v = 1) => tone({ t, f0: f, dur: 0.17, type: 'square', vol: 0.15 * v, lp: 720 });
  // 酸性贝斯：锯齿波 + 共振低通扫频，acid house 的标志音色
  const acid = (t, f, v = 1) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 9;
    flt.frequency.setValueAtTime(1500, t);
    flt.frequency.exponentialRampToValueAtTime(240, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15 * v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(flt); flt.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 0.22);
  };
  // 超宽和声 stab：三层微失谐锯齿波短促齐奏
  const stab = (t, fs) => {
    for (const f of fs) for (const det of [-9, 0, 9])
      tone({ t, f0: f * Math.pow(2, det / 1200), dur: 0.15, type: 'sawtooth', vol: 0.028, lp: 3200 });
  };
  const lead = (t, f, dur, wave, v = 1) => {
    const main = wave === 'sawtooth' ? 0.085 : 0.105;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(main * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicGain); g.connect(echoSend);
    o.start(t); o.stop(t + dur + 0.06);
    tone({ t, f0: f * 2.004, dur: dur * 0.8, type: 'triangle', vol: 0.045 * v });
  };
  const pad = (t, fs, dur) => { for (const f of fs) tone({ t, f0: f, dur, type: 'triangle', vol: 0.042, attack: 0.22 }); };

  /* ---------- 步进调度（随曲目变化） ---------- */
  function scheduleStep(idx, t) {
    if (TEST_CLOCK || !cur) return;
    const bar = idx >> 4, st = idx & 15;
    const sec = Chart.sectionAt(bar);
    const chord = cur.music.chords[bar % 4];

    if (sec === 'intro') {
      if (st % 4 === 0) kick(t, 0.8);
      if (st % 4 === 0) hat(t, false, 0.8);
    } else if (sec === 'verse') {
      if (st % 4 === 0) kick(t);                    // 四踩底鼓
      if (st === 4 || st === 12) snare(t);
      if (st % 4 === 0) hat(t);                     // 正拍闭镲
      if (st % 4 === 2) hat(t, true, 0.8);          // 反拍开镲，舞池律动
    } else if (sec === 'chorus') {
      if (st % 4 === 0) kick(t);
      if (st === 4 || st === 12) snare(t);
      if (st === 14) snare(t, 0.4);
      if (st % 4 === 0) hat(t);
      if (st % 4 === 2) hat(t, true);
      // 副歌：酸性贝斯 16 分连奏（末拍上五度翻飞）
      if (st % 2 === 0) acid(t, (st === 14) ? F(chord.r) * 1.5 : F(chord.r));
      if (st === 0 || st === 8) stab(t, chord.pad.map(n => n * 2));  // 失谐和声 stab
    } else { // outro
      if (st % 8 === 0) kick(t, 0.7);
      if (st === 4 || st === 12) snare(t, 0.5);
      if (st % 4 === 0) hat(t, false, 0.6);
    }

    if (sec === 'verse' && st % 2 === 0) {
      const f = F(chord.r);
      bass(t, (st === 14) ? f * 1.5 : f);
    }
    if (st === 0 && sec !== 'chorus') pad(t, chord.pad, STEP * 16 * 0.95);

    const seqBank = cur.music.lead;
    let seq, li;
    if (sec === 'intro')       { seq = seqBank.intro;  li = bar; }
    else if (sec === 'verse')  { seq = seqBank.verse;  li = (bar - 4)  % 4; }
    else if (sec === 'chorus') { seq = seqBank.chorus; li = (bar < 36 ? bar - 20 : bar - 36) % 4; }
    else                       { seq = seqBank.outro;  li = (bar - 44) % seqBank.outro.length; }
    const note = seq[li % seq.length][st];
    if (note) lead(t, F(note), sec === 'chorus' ? 0.16 : 0.2, cur.music.wave);
  }

  /* ---------- 歌曲控制 ---------- */
  function startSong(songDef, steps) {
    ensure(); resumeCtx();
    cur = songDef;
    STEP = 60 / songDef.bpm / 4;
    if (echoDelay) echoDelay.delayTime.value = STEP * 3;   // 附点八分回声
    totalSteps = steps;
    stepIdx = 0;
    nextStepT = tnow() + 0.4;          // 留 0.4s 缓冲作为歌曲起点
    songStartT = nextStepT;
    playing = true;
    musicGain.gain.cancelScheduledValues(tnow());
    musicGain.gain.setTargetAtTime(0.42, tnow(), 0.05);
    if (songTimer) clearInterval(songTimer);
    songTimer = setInterval(() => {
      if (!playing) return;
      while (nextStepT < tnow() + 0.3 && stepIdx < totalSteps) {
        scheduleStep(stepIdx, nextStepT);
        stepIdx++; nextStepT += STEP;
      }
    }, 50);
  }
  const songTime = () => (ctx ? tnow() - songStartT : 0);
  function stopSong() {
    playing = false;
    if (songTimer) { clearInterval(songTimer); songTimer = null; }
    if (ctx) musicGain.gain.setTargetAtTime(0.0001, tnow(), 0.12);
  }
  const suspend = () => {
    if (TEST_CLOCK) { pausedAt = tnow(); return; }
    if (ctx && ctx.state === 'running') ctx.suspend();
  };
  const resume = () => {
    if (TEST_CLOCK) {
      if (pausedAt !== null) {
        // 回推时钟基准，使恢复瞬间 tnow === pausedAt（倍速换算）：
        // pausedAt = testT0' + (nowReal - testT0')*SPEED
        const nowReal = performance.now() / 1000;
        testT0 = (TEST_SPEED * nowReal - pausedAt) / (TEST_SPEED - 1);
        pausedAt = null;
      }
      return;
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };
  const setMuted = m => { muted = m; if (ctx) master.gain.value = m ? 0 : 0.9; };

  /* ---------- 音效 ---------- */
  function sfxHit(quality) {
    ensure(); const t = tnow();
    if (quality === 'PERFECT') {
      tone({ t, f0: 880, f1: 1760, dur: 0.09, vol: 0.15, dest: sfxGain });
      tone({ t: t + 0.02, f0: 1320, f1: 2640, dur: 0.07, type: 'sine', vol: 0.1, dest: sfxGain });
    } else if (quality === 'GREAT') {
      tone({ t, f0: 660, f1: 1180, dur: 0.08, vol: 0.13, dest: sfxGain });
    } else {
      tone({ t, f0: 520, f1: 780, dur: 0.07, vol: 0.11, dest: sfxGain });
    }
  }
  function sfxCombo() {
    ensure(); const t = tnow();
    tone({ t, f0: 784, dur: 0.07, vol: 0.1, dest: sfxGain });
    tone({ t: t + 0.07, f0: 1046, dur: 0.1, vol: 0.1, dest: sfxGain });
  }
  const sfxSwing = () => { ensure(); noise({ t: tnow(), dur: 0.06, vol: 0.05, hp: 3200, dest: sfxGain }); };
  const sfxHurt  = () => { ensure(); tone({ t: tnow(), f0: 220, f1: 70, dur: 0.25, type: 'sawtooth', vol: 0.18, dest: sfxGain }); };
  function sfxCandy() {
    ensure(); const t = tnow();
    tone({ t, f0: 1568, dur: 0.06, type: 'sine', vol: 0.1, dest: sfxGain });
    tone({ t: t + 0.05, f0: 2093, dur: 0.08, type: 'sine', vol: 0.09, dest: sfxGain });
  }
  function sfxFever() {
    ensure(); const t = tnow();
    [69, 72, 76, 81].forEach((m, i) =>
      tone({ t: t + i * 0.06, f0: F(m), dur: 0.13, vol: 0.12, dest: sfxGain }));
  }
  function sfxClear() {
    ensure(); const t = tnow();
    [69, 73, 76, 81].forEach((m, i) =>
      tone({ t: t + i * 0.09, f0: F(m), dur: 0.22, vol: 0.13, dest: sfxGain }));
  }
  function sfxFail() {
    ensure(); const t = tnow();
    [64, 60, 57].forEach((m, i) =>
      tone({ t: t + i * 0.14, f0: F(m), dur: 0.3, type: 'triangle', vol: 0.14, dest: sfxGain }));
  }
  const sfxUI = () => { ensure(); tone({ t: tnow(), f0: 880, dur: 0.05, type: 'sine', vol: 0.08, dest: sfxGain }); };

  return {
    ensure, resumeCtx, songTime,
    startSong, stopSong, suspend, resume, setMuted,
    sfxHit, sfxCombo, sfxSwing, sfxHurt, sfxCandy, sfxFever, sfxClear, sfxFail, sfxUI,
  };
})();
