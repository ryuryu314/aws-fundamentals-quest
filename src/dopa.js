/* ドパミン演出キット（Dopa）: 効果音・BGM・粒子・ハンコ・XPゲージ・バナー・スロット・一時停止画面・設定。
   簿記ドパミンクエスト（https://ryuryu314.github.io/boki2-quest/）の effects.js と bgm.js を移植したもの（同じ作者のコード）。
   効果音とBGMは Web Audio でその場で合成し、音源ファイルや外部通信は使わない（iPhoneの消音モード中は鳴らない）。
   画面の動きは canvas と transform/opacity に限る。使い方: const fx = Dopa.create({ key, root, avatar }) */
(function () {
'use strict';
/* ================= 合成効果音（boki2 effects.js より） ================= */
const semi = (f, s) => f * Math.pow(2, s / 12), rand = (a, b) => a + Math.random() * (b - a);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const HUES = ['#ff3d9a', '#ffb300', '#29a3f0', '#7c4dff', '#2ecc71', '#ff7a00'];
// コンプレッサー手前の音量。OfflineAudioContextで実測し、正解音が従来版と同じ大きさになる値（自動メイクアップは働かない）。
const TRIM = 1;

/* ================= synth: 合成効果音 ================= */
// ac は AudioContext（本番）か OfflineAudioContext（検証）。always は検証用で、状態や音量を問わず鳴らす。
function createSynth(ac, opt = {}) {
  const level = opt.level || (() => .6), always = !!opt.always, wall = () => performance.now();
  let master = null, bus = null, verbIn = null, noiseBuf = null, built = false, voices = [];
  if (ac) { master = ac.createGain(); master.gain.value = level(); master.connect(ac.destination); bus = master; }
  function build() {
    if (built) return; built = true;
    // 和音が重なっても割れないよう、穏やかなコンプレッサーを通す。
    try {
      const comp = ac.createDynamicsCompressor(), trim = ac.createGain();
      comp.threshold.value = -9; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .22;
      trim.gain.value = TRIM; trim.connect(comp); comp.connect(master); bus = trim;
    } catch (e) { bus = master; }
    // 生成したインパルス応答による小部屋程度の残響。
    try {
      const rate = ac.sampleRate, len = Math.floor(rate * 1.4), ir = ac.createBuffer(2, len, rate), conv = ac.createConvolver(), wet = ac.createGain();
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      conv.buffer = ir; wet.gain.value = .28; verbIn = ac.createGain(); verbIn.connect(conv); conv.connect(wet); wet.connect(bus);
    } catch (e) { verbIn = null; }
    try { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } catch (e) { noiseBuf = null; }
  }
  const live = () => !!ac && (always || (ac.state === 'running' && level() > 0));
  // 同時発音の目安。連打される小さな音だけを上限で間引く。
  function busy(cap) { const t = wall(); voices = voices.filter(e => e > t); return voices.length >= cap; }
  const claim = sec => { voices.push(wall() + sec * 1000 + 40); };
  function route(node, t, o) {
    let n = node;
    if (o.pan && ac.createStereoPanner) { try { const p = ac.createStereoPanner(); p.pan.setValueAtTime(Math.max(-1, Math.min(1, o.pan)), t); n.connect(p); n = p; } catch (e) { n = node; } }
    n.connect(bus);
    if (o.verb && verbIn) { const s = ac.createGain(); s.gain.value = o.verb; n.connect(s); s.connect(verbIn); }
  }
  function env(g, t, vol, a, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(a + .012, dur)); }
  function tone(f, dur, type = 'square', vol = .2, when = 0, slide = 0, o = {}) {
    if (!live()) return; build();
    const t = ac.currentTime + Math.max(0, when), osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    if (o.detune && osc.detune) osc.detune.setValueAtTime(o.detune, t);
    let src = osc;
    if (o.lp) { const bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.setValueAtTime(o.lp, t); bq.Q.value = o.q || .7; osc.connect(bq); src = bq; }
    src.connect(g); env(g, t, vol, o.attack || .006, dur); route(g, t, o);
    osc.start(t); osc.stop(t + dur + .05); claim(when + dur);
  }
  function noise(dur, vol = .2, when = 0, o = {}) {
    if (!live()) return; build(); if (!noiseBuf) return;
    const t = ac.currentTime + Math.max(0, when), src = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    bq.type = o.type || 'bandpass'; bq.frequency.setValueAtTime(o.f || 2000, t);
    if (o.to) bq.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    bq.Q.value = o.q == null ? 1 : o.q;
    src.connect(bq); bq.connect(g); env(g, t, vol, o.attack || .003, dur); route(g, t, o);
    src.start(t, Math.random() * .5); src.stop(t + dur + .05); claim(when + dur);
  }
  // ---- 楽器 ----
  const kick = (when = 0, vol = .4, f0 = 160, f1 = 45, dur = .16) => tone(f0, dur, 'sine', vol, when, f1 / f0, { attack: .002 });
  const crash = (when = 0, vol = .1, dur = 1.3) => noise(dur, vol, when, { type: 'highpass', f: 5200, q: .4, verb: .5 });
  const swish = (when = 0, vol = .08, up = true, dur = .22) => noise(dur, vol, when, { f: up ? 500 : 3200, to: up ? 3800 : 420, q: 1.3, attack: dur * .45 });
  const timp = (when = 0, f = 98, vol = .3) => { tone(f, .55, 'sine', vol, when, .8, { attack: .003, verb: .25 }); noise(.06, vol * .25, when, { type: 'lowpass', f: 700 }); };
  function bell(f, when = 0, vol = .1, dur = .9, pan = 0) {
    [[1, 1, 1], [2.76, .35, .5], [5.4, .15, .25]].forEach(([m, v, d]) => { if (f * m < 12000) tone(f * m, dur * d, 'sine', vol * v, when, 0, { attack: .002, verb: .32, pan }); });
  }
  function sparkle(n = 5, when = 0, vol = .04, base = 2093) {
    const top = Math.min(base, 2093);
    for (let i = 0; i < n; i++) tone(semi(top, PENTA[Math.random() * 6 | 0]), rand(.07, .15), 'sine', vol, when + i * rand(.025, .05), 0, { attack: .002, pan: rand(-.7, .7), verb: .45 });
  }
  function lead(f, when, dur, vol = .05) {
    tone(f, dur, 'sawtooth', vol, when, 0, { lp: Math.min(5000, f * 4), q: 1, attack: .015, verb: .2 });
    tone(f, dur, 'square', vol * .5, when, 0, { lp: Math.min(4000, f * 3), attack: .015, detune: 6 });
  }
  // 金管風の和音: ノコギリ波2本をずらし、フィルターを一瞬開いて閉じる。
  function brass(freqs, when = 0, dur = .5, vol = .03) {
    if (!live()) return; build();
    for (const f of freqs) for (const d of [-9, 9]) {
      const t = ac.currentTime + Math.max(0, when), o = ac.createOscillator(), bq = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); if (o.detune) o.detune.setValueAtTime(d, t);
      bq.type = 'lowpass'; bq.Q.value = 1.2; bq.frequency.setValueAtTime(Math.min(4000, f * 1.5), t);
      bq.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 7), t + .05); bq.frequency.exponentialRampToValueAtTime(Math.min(6000, f * 2.6), t + dur);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .03); g.gain.setValueAtTime(vol, t + Math.max(.04, dur * .7)); g.gain.exponentialRampToValueAtTime(.0001, t + dur + .1);
      o.connect(bq); bq.connect(g); route(g, t, { pan: d / 25, verb: .22 }); o.start(t); o.stop(t + dur + .14); claim(when + dur + .1);
    }
  }
  const C5 = 523.25;
  const SFX = {
    // ---- 操作音: 宅建版の音階はそのまま、輪郭だけ足す ----
    move() { tone(rand(1150, 1300), .03, 'square', .045, 0, 0, { lp: 5200, pan: rand(-.2, .2) }); },
    bump() { tone(140, .07, 'square', .08, 0, 0, { lp: 1400 }); noise(.06, .05, 0, { type: 'lowpass', f: 380 }); },
    ok() { noise(.018, .03, 0, { type: 'highpass', f: 4500 }); tone(660, .05, 'square', .085, 0, 0, { lp: 5400 }); tone(990, .08, 'square', .085, .045, 0, { lp: 5400, verb: .1 }); },
    back() { tone(520, .05, 'square', .07, 0, 0, { lp: 4200 }); tone(350, .08, 'square', .07, .045, 0, { lp: 3600 }); noise(.05, .03, .02, { f: 1800, to: 600, q: 1.2 }); },
    tick() { tone(1800, .02, 'square', .04, 0, 0, { lp: 6500 }); },
    // テンキー: 打鍵音に、数字ごとに違う音程の粒を重ねる。
    key(d) {
      tone(1800, .02, 'square', .035, 0, 0, { lp: 6500 });
      const n = { '000': 10, '00': 9, '.': 8, '±': 6 }[d] ?? (d === 'C' || d === '⌫' ? -1 : +d);
      if (n >= 0) tone(semi(659.25, PENTA[n % PENTA.length]), .06, 'triangle', .06, .003, 0, { pan: (n % 10 - 4.5) / 8, verb: .06 });
      else tone(420, .06, 'triangle', .05, .003, .7);
    },
    select(i = 0) { const f = semi(880, PENTA[(+i || 0) % 5]); noise(.015, .03, 0, { type: 'highpass', f: 5000 }); tone(f, .07, 'triangle', .085, 0, 0, { attack: .002 }); tone(f * 2, .045, 'square', .025, .012, 0, { lp: 4500, verb: .12 }); },
    pick() { noise(.02, .03, 0, { type: 'highpass', f: 5000 }); tone(988, .1, 'triangle', .08, 0, 0, { attack: .002 }); tone(1319, .14, 'triangle', .075, .05, 0, { attack: .002, verb: .15 }); },
    add() { tone(520, .08, 'sine', .09, 0, 1.7, { attack: .003 }); tone(1568, .05, 'triangle', .04, .06, 0, { verb: .12 }); },
    remove() { swish(0, .05, false, .14); tone(500, .09, 'triangle', .06, 0, .55); },
    whoosh() { swish(0, .075, true, .2); },
    // ---- 正誤 ----
    // 正解: 打撃＋上昇アルペジオ＋きらめき。コンボで音程が上がり、5連続で低音、10連続で金管が加わる。
    correct(combo = 1) {
      const c = Math.max(1, combo | 0), base = semi(C5, PENTA[Math.min(c - 1, 8)]), fever = c >= 10;
      kick(0, .3, 170, 50, .13); noise(.03, .07, 0, { f: 3600, q: .8 });
      [0, 4, 7, 12].forEach((s, i) => { const f = semi(base, s), w = i * .05, p = -.3 + i * .2;
        tone(f, .11, 'square', .08, w, 0, { lp: 5600, pan: p });
        tone(f, .14, 'triangle', .05, w, 0, { detune: 7, pan: -p, verb: .15 }); });
      tone(semi(base, 12), .36, 'triangle', .08, .2, 0, { verb: .3 });
      sparkle(fever ? 7 : 4, .2, fever ? .042 : .032, semi(base, 12));
      if (c >= 5) tone(semi(base, -12), .32, 'triangle', .085);
      if (fever) brass([0, 4, 7].map(s => semi(base, s - 12)), .18, .45, .026);
    },
    // 不正解でも明るく: 「ぽよん」と跳ねて、すぐ上向きの和音で励ます。
    wrong() {
      noise(.05, .04, 0, { type: 'lowpass', f: 700 });
      tone(262, .2, 'sine', .12, 0, 1.6, { attack: .004 }); tone(524, .09, 'triangle', .04, .02, .7);
      [0, 4, 7, 12].forEach((s, i) => tone(semi(523.25, s), .15, 'triangle', .065, .26 + i * .045, 0, { verb: .25, pan: -.3 + i * .2 }));
      sparkle(3, .44, .028, 1568);
    },
    // コンボが途切れても、積み上げた数をたたえる明るい音。
    comboBreak() {
      swish(0, .04, true, .15);
      [0, 4, 7, 12].forEach((s, i) => tone(semi(659.25, s), .09, 'square', .045, .1 + i * .05, 0, { lp: 5600, pan: -.4 + i * .25, verb: .2 }));
      bell(1568, .32, .05, .7); sparkle(5, .3, .03, 2093);
    },
    // ---- パチスロ風（模試） ----
    lever() { noise(.04, .12, 0, { f: 900, q: 1.2 }); tone(130, .09, 'sine', .25, 0, .45, { attack: .002 }); noise(.012, .06, .045, { type: 'highpass', f: 4000 }); },
    // リールの回転音: ノイズを毎秒21回刻み、モーターのうなりを重ねる。
    reelSpin(dur = 2.8) {
      if (!live()) return; build(); if (!noiseBuf) return;
      const t = ac.currentTime, d = Math.max(.3, dur), src = ac.createBufferSource(), bq = ac.createBiquadFilter(), am = ac.createGain(), g = ac.createGain(), lfo = ac.createOscillator(), depth = ac.createGain();
      src.buffer = noiseBuf; src.loop = true; bq.type = 'bandpass'; bq.frequency.setValueAtTime(2300, t); bq.Q.value = 1.4;
      lfo.type = 'square'; lfo.frequency.setValueAtTime(21, t); depth.gain.value = .5; am.gain.value = .5; lfo.connect(depth); depth.connect(am.gain);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.07, t + .08); g.gain.setValueAtTime(.07, t + d - .1); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      src.connect(bq); bq.connect(am); am.connect(g); route(g, t, {});
      src.start(t, Math.random() * .5); src.stop(t + d + .05); lfo.start(t); lfo.stop(t + d + .05); claim(d);
      tone(95, d, 'sawtooth', .02, 0, 0, { lp: 320, attack: .08 });
    },
    reelStop(i = 0) { kick(0, .34, 150, 48, .12); noise(.025, .09, 0, { f: 1800, q: 1.5 }); tone(semi(880, [0, 3, 7][(i | 0) % 3]), .07, 'triangle', .07, .005, 0, { pan: -.5 + ((i | 0) % 3) * .5 }); },
    // 確定音「キュイン」: 速いビブラートつきの上昇音。
    kyuin(when = 0) {
      if (!live()) return; build();
      const t = ac.currentTime + Math.max(0, when), o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), dep = ac.createGain(), bq = ac.createBiquadFilter();
      o.type = 'square'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(2600, t + .16);
      lfo.type = 'sine'; lfo.frequency.setValueAtTime(28, t); dep.gain.value = 60; lfo.connect(dep); dep.connect(o.frequency);
      bq.type = 'lowpass'; bq.frequency.setValueAtTime(5200, t); bq.Q.value = .7;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.06, t + .02); g.gain.setValueAtTime(.06, t + .3); g.gain.exponentialRampToValueAtTime(.0001, t + .62);
      o.connect(bq); bq.connect(g); route(g, t, { verb: .3 }); o.start(t); o.stop(t + .66); lfo.start(t); lfo.stop(t + .66); claim(when + .62);
      tone(2600, .5, 'sine', .025, when + .16, 0, { verb: .4 });
    },
    // 「GOGO!」ランプ点灯の「ペカッ」。
    peka() { tone(2637, .06, 'square', .05, 0, 0, { lp: 6500 }); tone(3520, .14, 'square', .05, .055, 0, { lp: 7000, verb: .25 }); bell(1760, .05, .06, .9); sparkle(5, .1, .03, 2093); },
    // ボーナス確定のファンファーレ（8bit風）。tier 1〜4 で調が上がる。
    bigBonus(tier = 1) {
      const b = semi(523.25, [0, 0, 2, 5, 7][tier | 0] || 0);
      [[0, 0, .1], [4, .12, .1], [7, .24, .1], [12, .36, .22], [7, .62, .1], [12, .74, .1], [16, .86, .1], [19, .98, .5]].forEach(([s, w, d], i) => { tone(semi(b, s), d, 'square', .055, w, 0, { lp: 6000, pan: -.3 + (i % 4) * .2, verb: .15 }); tone(semi(b, s - 12), d, 'triangle', .045, w); });
      [0, .36, .62, .98].forEach(w => kick(w, .3)); [.18, .5, .8].forEach(w => noise(.08, .08, w, { type: 'highpass', f: 2000 }));
      crash(.98, .1, 1.4); brass([b / 2, semi(b, 4) / 2, semi(b, 7) / 2, b], .98, .9, .028); sparkle(10, 1, .035, 2093);
    },
    // メダル払い出し「チャリチャリ」。
    payout(n = 20) { const m = Math.min(48, Math.max(4, n | 0)); for (let i = 0; i < m; i++) { const w = i * .045; tone(rand(2900, 3600), .05, 'sine', .035, w, 0, { attack: .001, pan: rand(-.5, .5) }); tone(rand(4200, 5200), .03, 'sine', .015, w + .006, 0, { attack: .001 }); } },
    // 100点の「フリーズ」: 低いうなりで止め、明けに「ギュイーン」。
    freeze() { tone(70, 1.1, 'sine', .35, 0, .5, { attack: .005 }); noise(.4, .08, 0, { type: 'lowpass', f: 300 }); },
    premium(when = 0) {
      tone(180, .7, 'sawtooth', .07, when, 14, { lp: 4200 }); noise(.7, .06, when, { f: 300, to: 7000, q: 1, attack: .6 });
      kick(when + .7, .45); crash(when + .7, .14, 2); [0, 4, 7, 11, 14].forEach((s, i) => bell(semi(1046.5, s), when + .72 + i * .06, .045, 1, -.5 + i * .25));
    },
    chance() { [0, 7, 12, 16].forEach((s, i) => tone(semi(880, s), .07, 'square', .05, i * .045, 0, { lp: 6000, verb: .2 })); bell(2349, .2, .05, .7); },
    complete() { [0, 7, 12].forEach((s, i) => tone(semi(1046.5, s), .09, 'sine', .07, i * .07, 0, { verb: .3 })); sparkle(3, .2, .025, 2093); },
    lampOn(i = 0) { kick(0, .18, 140, 60, .08); tone(semi(1318.5, PENTA[(i | 0) % 6]), .08, 'square', .04, .01, 0, { lp: 6000, verb: .15 }); },
    gameStart() { SFX.lever(); SFX.reelSpin(.9); [0, 4, 7, 12].forEach((s, i) => tone(semi(659.25, s), .08, 'square', .05, .95 + i * .05, 0, { lp: 6000, verb: .15 })); kick(.95, .25); },
    combo(n = 3, when = 0) {
      const b = semi(659.25, Math.min(12, Math.floor(n / 3) * 2));
      swish(when, .05, true, .16); kick(when + .12, .16);
      [0, 4, 7, 11, 14].forEach((s, i) => tone(semi(b, s), .1, 'square', .05, when + .12 + i * .032, 0, { lp: 5600, pan: -.4 + i * .2, verb: .2 }));
    },
    crit() {
      swish(0, .08, true, .2); kick(.18, .36); crash(.18, .07, 1);
      [2093, 2637, 3136].forEach((f, i) => bell(f, .18 + i * .045, .055, 1, -.4 + i * .4));
      for (let i = 0; i < 8; i++) tone(rand(1800, 3200), .06, 'square', .03, .2 + i * .03, 0, { lp: 6500, pan: rand(-.6, .6) });
    },
    fever() {
      tone(200, .5, 'sawtooth', .06, 0, 6, { lp: 2600 }); noise(.5, .06, 0, { f: 400, to: 5200, q: 1.2, attack: .4 });
      kick(.5, .42); crash(.5, .11, 1.5);
      [0, 3, 7, 10, 12, 15, 19, 22, 24].forEach((s, i) => tone(semi(440, s), .09, 'square', .055, .52 + i * .04, 0, { lp: 5200, pan: -.5 + i * .12, verb: .2 }));
      brass([220, 261.63, 329.63, 392], .52, .7, .024);
    },
    level() {
      kick(0, .32); timp(0, 131, .2);
      [[0, 0], [4, .1], [7, .2], [12, .3], [7, .42], [12, .52], [16, .62], [19, .72], [24, .82]].forEach(([s, w], i) => tone(semi(C5, s), .16, 'square', .07, w, 0, { lp: 5400, pan: -.4 + i * .1, verb: .15 }));
      tone(semi(C5, 24), .7, 'triangle', .08, .95, 0, { verb: .35 });
      brass([261.63, 329.63, 392], .3, .2, .022); brass([261.63, 329.63, 392, 523.25], .82, 1, .03);
      kick(.82, .38); crash(.82, .1, 1.6); timp(.82, 98, .25); sparkle(10, .9, .036, 2093);
    },
    coin() { tone(1568, .04, 'square', .045, 0, 0, { lp: 6500 }); tone(2093, .1, 'square', .045, .04, 0, { lp: 6500, verb: .12 }); },
    // XPゲージへコインが届いた音。連続しても割れないよう間引く。
    coinTick(i = 0) { if (busy(44)) return; const f = semi(1568, PENTA[(i | 0) % 6]); tone(f, .035, 'square', .03, 0, 0, { lp: 6500, pan: rand(-.3, .3) }); tone(f * 1.335, .06, 'square', .028, .03, 0, { lp: 6500, verb: .1 }); },
    // レジの「ガチャ・チーン」。獲得XPの確定に使う。
    register(when = 0) {
      noise(.045, .09, when, { f: 1300, q: 1.6 }); tone(180, .04, 'square', .045, when, 0, { lp: 900 }); noise(.03, .06, when + .05, { f: 2600, q: 2 });
      bell(2637, when + .07, .09, 1.1, .15); bell(3951, when + .07, .045, .8, -.15); tone(1318.5, .5, 'triangle', .045, when + .07, 0, { verb: .3 });
    },
    chip(i = 0, when = 0) { const f = semi(1046.5, PENTA[Math.min(i | 0, 8)]); noise(.012, .025, when, { type: 'highpass', f: 6000 }); tone(f, .06, 'triangle', .07, when, 0, { attack: .002, pan: -.3 + (i % 4) * .2 }); tone(f * 1.5, .05, 'sine', .03, when + .02, 0, { verb: .2 }); },
    // ハンコ: 低い打撃と紙を叩く音。
    stamp(ok = true, when = 0) { kick(when, .45, 130, 38, .2); noise(.08, .2, when, { type: 'lowpass', f: 2400, q: .5 }); noise(.04, .05, when + .005, { type: 'highpass', f: 5200 }); if (ok) bell(1568, when + .05, .028, .5); },
    // 借方と貸方の合計がそろった。
    balance() { bell(1046.5, 0, .06, .7, -.2); bell(1568, .07, .055, .8, .2); sparkle(4, .12, .022, 2093); },
    start() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(semi(392, s), .12, 'square', .075, i * .045, 0, { lp: 5400, pan: -.45 + i * .15, verb: .1 })); },
    questStart() { swish(0, .06, true, .26); SFX.start(); kick(.32, .24); crash(.32, .05, .7); },
    rank() { tone(80, .5, 'sawtooth', .12, 0, .4, { lp: 900 }); tone(160, .3, 'square', .08, 0, 0, { lp: 1300 }); kick(0, .45, 120, 35, .3); noise(.14, .1, 0, { type: 'lowpass', f: 1600 }); crash(0, .05, .9); },
    fanfare(r = 'A') {
      const big = r === 'S', seq = big ? [[0, 0, .14], [4, .14, .14], [7, .28, .14], [12, .42, .55]] : [[0, 0, .12], [7, .12, .12], [12, .24, .42]], hit = seq[seq.length - 1][1];
      seq.forEach(([s, w, d]) => lead(semi(C5, s), w, d, .05));
      brass([261.63, 329.63, 392, 523.25], hit, big ? 1 : .6, .028); kick(hit, .35);
      if (big) { crash(hit, .11, 1.6); timp(hit, 98, .25); sparkle(12, hit + .08, .036, 2093); } else sparkle(6, hit + .06, .032, 2093);
    },
    drumroll(dur = 1.5) {
      let t = 0, gap = .08, i = 0;
      while (t < dur && i < 64) { noise(.06, .035 + .085 * (t / dur), t, { f: 1700, q: .7, pan: i % 2 ? .15 : -.15 }); t += gap; gap = Math.max(.034, gap * .955); i++; }
      timp(0, 82, .12); timp(dur * .5, 82, .16);
    },
    count(p = 0) { if (busy(48)) return; tone(semi(880, Math.round(p * 14)), .03, 'square', .026, 0, 0, { lp: 6000 }); },
    pass() {
      kick(0, .45); timp(0, 98, .3); crash(0, .12, 2);
      brass([261.63, 329.63, 392], 0, .2, .026); brass([349.23, 440, 523.25], .22, .2, .026); brass([392, 493.88, 587.33], .44, .2, .026); brass([523.25, 659.25, 783.99, 1046.5], .66, 1.2, .03);
      [[392, 0, .2], [523.25, .22, .2], [587.33, .44, .2], [783.99, .66, .8]].forEach(([f, w, d]) => lead(f, w, d, .045));
      kick(.66, .42); crash(.66, .12, 2); timp(.66, 65.41, .3);
      bell(2093, .7, .07, 1.4, -.3); bell(2637, .82, .06, 1.3, .3); sparkle(14, .75, .035, 2093);
    },
    // 不合格でも明るく: 弾んで上がるフレーズで「次回に期待」。
    fail() {
      [[0, 0], [4, .1], [7, .2], [9, .3], [7, .42], [12, .54]].forEach(([s, w], i) => tone(semi(C5, s), .14, 'square', .055, w, 0, { lp: 5200, pan: -.4 + i * .15, verb: .18 }));
      kick(.54, .2); bell(2093, .7, .05, .9); sparkle(6, .7, .03, 2093);
    },
    record() { [0, 4, 7, 12, 16, 19, 24, 28].forEach((s, i) => tone(semi(659.25, s), .07, 'square', .045, i * .035, 0, { lp: 6500, pan: -.5 + i * .14 })); bell(2637, .3, .065, 1, 0); sparkle(8, .32, .032, 2093); },
    daily() { SFX.coin(); tone(2093, .1, 'square', .04, .12, 0, { lp: 6500 }); tone(2637, .16, 'square', .04, .2, 0, { lp: 6500, verb: .2 }); brass([523.25, 659.25, 783.99], .26, .5, .024); sparkle(8, .3, .032, 2093); },
    memo() { SFX.coin(); tone(660, .05, 'square', .07, .09, 0, { lp: 5400 }); tone(990, .08, 'square', .07, .135, 0, { lp: 5400, verb: .1 }); sparkle(4, .15, .03, 2093); },
    boom() { if (busy(50)) return; kick(0, .22, 110, 40, .25); noise(.5, .06, .01, { type: 'highpass', f: 3000, q: .5, verb: .4, attack: .01 }); sparkle(3, .06, .02, 1568); },
  };
  return { SFX, live, busy, setLevel(v) { if (master) master.gain.value = v; } };
}

/* ================= BGM（boki2 bgm.js より） ================= */
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const MAJ = [0, 4, 7, 12], MIN = [0, 3, 7, 12];
// 曲: bpm、小節ごとのコード [ルートのMIDI番号, 和音]、メロディ（小節ごとに [16分の位置, MIDI, 長さ(16分)]）、style。
const SONGS = {
  // メニュー: のんびりしたハ長調。鐘のメロディとやわらかい和音。
  menu: { bpm: 92, style: 'calm', chords: [[48, MAJ], [45, MIN], [41, MAJ], [43, MAJ], [48, MAJ], [45, MIN], [50, MIN], [43, MAJ]],
    melody: [[[0, 76, 4], [4, 79, 4], [8, 81, 4], [12, 79, 4]], [[0, 76, 6], [6, 74, 2], [8, 72, 8]], [[0, 81, 4], [4, 84, 4], [8, 81, 4], [12, 77, 4]], [[0, 79, 6], [6, 81, 2], [8, 83, 4], [12, 86, 4]],
      [[0, 84, 4], [4, 79, 4], [8, 76, 4], [12, 79, 4]], [[0, 81, 6], [6, 79, 2], [8, 76, 8]], [[0, 77, 4], [4, 81, 4], [8, 86, 4], [12, 84, 4]], [[0, 83, 8], [8, 79, 4], [12, 74, 4]]] },
  // 練習: 弾むト長調のチップチューン。
  practice: { bpm: 126, style: 'pop', chords: [[43, MAJ], [50, MAJ], [52, MIN], [48, MAJ], [43, MAJ], [50, MAJ], [52, MIN], [48, MAJ]],
    melody: [[[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]], [[0, 78, 2], [2, 81, 2], [4, 86, 4], [8, 81, 4], [12, 78, 4]],
      [[0, 79, 2], [2, 83, 2], [4, 88, 4], [8, 86, 2], [10, 83, 2], [12, 81, 4]], [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 81, 8]],
      [[0, 86, 2], [2, 83, 2], [4, 79, 2], [6, 83, 2], [8, 86, 4], [12, 88, 4]], [[0, 86, 4], [4, 81, 2], [6, 78, 2], [8, 81, 8]],
      [[0, 83, 2], [2, 86, 2], [4, 88, 4], [8, 91, 4], [12, 88, 4]], [[0, 84, 4], [4, 83, 2], [6, 81, 2], [8, 79, 8]]] },
  // 模試: パチスロ風のイ短調。4つ打ちとうねるベース、鐘のリフ。
  exam: { bpm: 132, style: 'slot', chords: [[45, MIN], [43, MAJ], [41, MAJ], [40, MAJ], [45, MIN], [43, MAJ], [41, MAJ], [40, MAJ]],
    melody: [[[0, 81, 2], [3, 84, 1], [4, 88, 2], [6, 84, 2], [8, 81, 2], [10, 79, 2], [12, 76, 4]], [[0, 79, 2], [3, 83, 1], [4, 86, 2], [6, 83, 2], [8, 79, 4], [12, 74, 4]],
      [[0, 77, 2], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 2], [10, 76, 2], [12, 72, 4]], [[0, 76, 2], [2, 80, 2], [4, 83, 2], [6, 88, 2], [8, 86, 2], [10, 83, 2], [12, 80, 4]],
      [[0, 81, 2], [3, 84, 1], [4, 88, 2], [6, 84, 2], [8, 81, 2], [10, 79, 2], [12, 76, 4]], [[0, 79, 2], [3, 83, 1], [4, 86, 2], [6, 83, 2], [8, 79, 4], [12, 74, 4]],
      [[0, 77, 2], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 2], [10, 76, 2], [12, 72, 4]], [[0, 88, 2], [2, 86, 2], [4, 83, 2], [6, 80, 2], [8, 76, 8]]] },
};
SONGS.fever = Object.assign({}, SONGS.practice, { bpm: 140, transpose: 2, hot: true });

// ac は AudioContext（本番）か OfflineAudioContext（検証）。level は 0〜1 の音量。
function createBgm(ac, opt = {}) {
  const level = opt.level || (() => .2), live = () => !!ac && (opt.always || ac.state === 'running');
  let out = null, duckG = null, songG = null, nb = null, timer = 0, cur = null, want = null, step = 0, nextT = 0, held = false;
  function ensure() {
    if (out) return;
    out = ac.createGain(); out.gain.value = level(); duckG = ac.createGain(); duckG.gain.value = 1; out.connect(duckG); duckG.connect(ac.destination);
    nb = ac.createBuffer(1, Math.floor(ac.sampleRate * .5), ac.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function env(g, t, vol, a, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(a + .02, dur)); }
  function note(type, f, t, dur, vol, o = {}) {
    const osc = ac.createOscillator(), g = ac.createGain(); osc.type = type; osc.frequency.setValueAtTime(f, t);
    let src = osc; if (o.lp) { const bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.setValueAtTime(o.lp, t); bq.Q.value = .7; osc.connect(bq); src = bq; }
    src.connect(g); env(g, t, vol, o.attack || .005, dur); g.connect(songG); osc.start(t); osc.stop(t + dur + .05);
  }
  const bell = (f, t, dur, vol) => { note('sine', f, t, dur, vol); note('sine', f * 2.76, t, dur * .35, vol * .22); };
  function kick(t, vol) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .12); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + .16); o.connect(g); g.connect(songG); o.start(t); o.stop(t + .2); }
  function hit(t, dur, vol, type, f) { const s = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; bq.type = type; bq.frequency.setValueAtTime(f, t); bq.Q.value = .8; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); s.connect(bq); bq.connect(g); g.connect(songG); s.start(t, Math.random() * .3); s.stop(t + dur + .02); }
  // 16分音符1つ分を予約する。
  function schedule(song, n, t) {
    const bars = song.chords.length, bar = Math.floor(n / 16) % bars, s = n % 16, spb = 60 / song.bpm / 4, tr = song.transpose || 0;
    const [r0, ch] = song.chords[bar], root = r0 + tr;
    for (const [at, m, len] of song.melody[bar]) if (at === s) {
      if (song.style === 'pop') note('square', midi(m + tr), t, len * spb * .9, .045, { lp: 3200 });
      else bell(midi(m + tr), t, Math.max(.25, len * spb * 1.2), song.style === 'calm' ? .07 : .06);
    }
    if (song.style === 'calm') {
      if (s === 0) for (const k of ch.slice(0, 3)) note('triangle', midi(root + 12 + k), t, spb * 15, .022, { attack: .25 });
      if (s === 0 || s === 8) note('triangle', midi(s ? root + 7 : root), t, spb * 6, .1);
      if (s === 12) note('triangle', midi(root + 12), t, spb * 4, .07);
      if (s === 0 || s === 8) kick(t, .09);
      if (s === 4 || s === 12) hit(t, .04, .03, 'bandpass', 2600);
      if (s % 2 === 0) hit(t, .03, .012, 'highpass', 7000);
    } else if (song.style === 'pop') {
      if (s % 2 === 0) note('square', midi(root + (s % 4 ? 12 : 0)), t, spb * 1.6, .05, { lp: 700 });
      if (song.hot || bar >= 4) note('square', midi(root + 24 + ch[s % 4]), t, spb * .8, .012, { lp: 2600 });
      if (s === 0 || s === 8 || s === 10) kick(t, .14);
      if (s === 4 || s === 12) hit(t, .12, .05, 'highpass', 1500);
      if (song.hot ? true : s % 2 === 0) hit(t, s === 14 ? .12 : .03, .016, 'highpass', 8000);
    } else {
      if ([0, 3, 6, 8, 10, 13, 14].includes(s)) note('sawtooth', midi(root + [0, 0, 12, 0, 7, 12, 0][[0, 3, 6, 8, 10, 13, 14].indexOf(s)]), t, spb * 1.4, .045, { lp: 520 });
      if (s % 4 === 2) for (const k of ch.slice(0, 3)) note('square', midi(root + 24 + k), t, spb * .9, .01, { lp: 2200 });
      if (s % 4 === 0) kick(t, .14);
      if (s === 4 || s === 12) hit(t, .1, .05, 'bandpass', 1500);
      if (s % 2 === 1 || song.hot) hit(t, s % 4 === 2 ? .09 : .03, .014, 'highpass', 7500);
    }
  }
  function begin(name, t) {
    if (songG) { const old = songG; old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value || 1, t); old.gain.linearRampToValueAtTime(.0001, t + .35); setTimeout(() => { try { old.disconnect(); } catch (e) { /* 既に切断 */ } }, 900); }
    songG = ac.createGain(); songG.gain.setValueAtTime(.0001, t); songG.gain.linearRampToValueAtTime(1, t + .4); songG.connect(out);
    cur = name; step = 0; nextT = t + .05;
  }
  function tick() {
    if (!want || level() <= 0 || !live() || (typeof document !== 'undefined' && document.hidden)) return;
    ensure(); const now = ac.currentTime;
    if (cur !== want) begin(want, now);
    if (nextT < now) nextT = now + .05; // 裏に回っていた間の分は鳴らさない
    const song = SONGS[cur], spb = 60 / song.bpm / 4;
    while (nextT < now + .3) { schedule(song, step, nextT); step = (step + 1) % (song.chords.length * 16); nextT += spb; }
  }
  return {
    songs: Object.keys(SONGS),
    play(name) { if (!SONGS[name]) return; want = name; if (!timer && !opt.always) timer = setInterval(tick, 60); tick(); },
    // すぐに小さくして止め、次に鳴らすときは曲の頭からフェードインする。
    stop() {
      want = null; cur = null; if (!songG) return;
      const old = songG, t = ac.currentTime; songG = null;
      old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(.0001, t + .3);
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* 既に切断 */ } }, 700);
    },
    current: () => want,
    // 読み上げの間はBGMを下げたままにする（途中のファンファーレの後も戻さない）。
    hold(on) {
      held = !!on; if (!duckG || !ac) return; const t = ac.currentTime, g = duckG.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(held ? .25 : 1, t + .25);
    },
    setLevel() { if (out) out.gain.value = level(); if (level() <= 0) cur = null; },
    // ファンファーレの間だけ少し下げる。
    duck(to = .35, sec = 1.4) {
      if (!duckG || !live()) return; const t = ac.currentTime, g = duckG.gain, base = held ? .25 : 1; to = Math.min(to, base);
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + .06); g.setValueAtTime(to, t + sec); g.linearRampToValueAtTime(base, t + sec + .5);
    },
    // 検証用: 指定の曲を sec 秒分まとめて予約する（OfflineAudioContext 向け）。
    prime(name, sec) { if (!SONGS[name]) return; ensure(); begin(name, 0); const song = SONGS[name], spb = 60 / song.bpm / 4; while (nextT < sec) { schedule(song, step, nextT); step = (step + 1) % (song.chords.length * 16); nextT += spb; } },
  };
}

/* ================= 進み具合（経験値・レベル・称号） ================= */
// 簿記ドパミンクエストと同じ計算。正解は BASE+10、初めて+5、前回の間違いを取り返す REVENGE+6、
// 5コンボごとに ×0.5（最大 ×4）、10コンボ以上は FEVER ×2、8% で CRITICAL ×3。不正解はチャレンジXP +2。
function level(xp) { let x = Math.max(0, Math.floor(+xp || 0)), lv = 1, need = 60; while (x >= need) { x -= need; lv++; need = 60 + (lv - 1) * 35; } return { lv, xp: x, need }; }
function scoreAnswer(o) {
  const chips = [];
  if (!o.ok) return { gain: 2, chips: [['チャレンジXP +2', 'gold']], crit: false };
  const c = Math.max(1, o.combo | 0);
  let gain = 10; chips.push(['BASE +10', '']);
  if (o.revenge) { gain += 6; chips.push(['REVENGE +6', 'pink']); }
  if (o.first) { gain += 5; chips.push(['NEW +5', '']); }
  const mult = 1 + Math.min(3, Math.floor(c / 5) * .5), fever = c >= 10 ? 2 : 1;
  if (mult > 1) chips.push(['COMBO ×' + mult, 'pink']);
  if (fever > 1) chips.push(['FEVER ×2', 'pink']);
  gain = Math.round(gain * mult * fever);
  const crit = (o.random ? o.random() : Math.random()) < .08;
  if (crit) { gain *= 3; chips.push(['CRITICAL ×3', 'gold']); }
  chips.push(['+' + gain + ' XP', 'tot']);
  return { gain, chips, crit, feverStart: c === 10 };
}
function xpInfo(xp0, xp1, titleOf) {
  const L0 = level(xp0), L1 = level(xp1), t = titleOf || (() => '');
  return { lv0: L0.lv, f0: L0.xp / L0.need, lv1: L1.lv, f1: L1.xp / L1.need, gain: xp1 - xp0, up: L1.lv > L0.lv, title: t(L1.lv), titleUp: t(L1.lv) !== t(L0.lv) };
}
// 正答率のランク（5問以上で全問正解ならS）。
const rankLetter = (correct, total) => { const acc = total ? correct / total : 0; return total >= 5 && acc === 1 ? 'S' : acc >= .8 ? 'A' : acc >= .6 ? 'B' : acc >= .4 ? 'C' : 'D'; };
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ================= 演出エンジン ================= */
// opt: key（設定の保存キー）、root（揺らす要素を返す関数）、avatar（一時停止画面の画像）。
function create(opt = {}) {
const KEY = (opt.key || 'dopa') + '.dopa-settings';
const set = { vol: 70, bgm: 40, fx: true, rumble: true };
try { Object.assign(set, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 保存できない環境 */ }
const saveSet = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) { /* 保存できない環境 */ } };
const $ = s => document.querySelector(s), now = () => performance.now();
const appRoot = () => (opt.root && opt.root()) || document.body;
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lite = () => !set.fx;
const motion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!(motion && motion.matches);
// 「派手な演出」オフ、または端末の「視差効果を減らす」では、揺れ・点滅・光線を出さない。
const calm = () => lite() || reduced();
const layer = (tag, cls) => { const e = document.createElement(tag); e.className = cls; e.setAttribute('aria-hidden', 'true'); document.body.appendChild(e); return e; };
const cv = layer('canvas', 'dopa-fx'), flashEl = layer('div', 'dopa-flash'), toastEl = layer('div', 'dopa-toast'), hintEl = layer('div', 'dopa-sound-hint');
toastEl.setAttribute('aria-hidden', 'false'); toastEl.setAttribute('role', 'status');
hintEl.textContent = '♪ 画面をタップすると音が鳴ります';
const cx = cv.getContext('2d');

/* ---- audio ---- */
let ac = null;
try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
const sfxLevel = () => (set.vol / 100) * .6, syn = createSynth(ac, { level: sfxLevel }), SFX = syn.SFX;
// BGM は効果音とは別の音量。大きなファンファーレの間だけ下げる。
const bgmLevel = () => ((set.bgm ?? 40) / 100) * .25, bgm = ac ? createBgm(ac, { level: bgmLevel }) : null;
const DUCK = new Set(['level', 'fever', 'crit', 'pass', 'bigBonus', 'premium', 'fanfare', 'record', 'daily', 'freeze']);
// iOS の古い版は無音バッファの再生を伴わないと解錠されないことがある。
function audioUnlock() {
  if (!ac || ac.state === 'running') return;
  try { const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch (e) { /* unsupported */ }
  try { const p = ac.resume(); return p && p.then ? p.catch(() => {}) : undefined; } catch (e) { return undefined; }
}
function soundHint() { hintEl.classList.toggle('show', !!ac && (set.vol > 0 || set.bgm > 0) && ac.state !== 'running' && !!bgm && !!bgm.current()); }
if (ac) { ac.onstatechange = soundHint; setTimeout(soundHint, 1500); }
for (const t of ['touchend', 'pointerdown', 'keydown']) addEventListener(t, audioUnlock, { passive: true });
function run(name, args) { try { SFX[name](...args); } catch (e) { /* 音が出なくても操作は止めない */ } }
function play(name, ...args) {
  if (!SFX[name] || !ac || set.vol <= 0) return;
  if (bgm && DUCK.has(name)) bgm.duck();
  if (ac.state === 'running') run(name, args);
  else { const pending = audioUnlock(); if (pending) pending.then(() => { if (ac && ac.state === 'running') run(name, args); }); }
}

/* ---- haptics ---- */
const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let taptic = null;
// iPhone の Safari は vibrate 非対応。iOS 18 以降はスイッチ型チェックボックスの切替で触覚が返るため、タップ直後だけそれを使う。
function haptic(kind = 'light') {
  if (!set.rumble) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  try {
    if (!iOS) { if (navigator.vibrate) navigator.vibrate({ light: 10, ok: 25, good: [20, 40, 30], bad: [60, 40, 60], big: [40, 30, 40, 30, 90] }[kind] || 15); return; }
    if (!taptic) { taptic = document.createElement('label'); taptic.setAttribute('aria-hidden', 'true'); taptic.style.display = 'none'; const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1; taptic.appendChild(box); document.head.appendChild(taptic); }
    taptic.click();
  } catch (e) { /* unsupported */ }
}

/* ---- 粒子（最前面の canvas、何も飛んでいないときは描かない） ---- */
let W = 0, H = 0, DPR = 1, dirty = false, last = 0, feverOn = false, ambientAt = 0;
function resize() { DPR = lite() ? 1 : Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cx.setTransform(DPR, 0, 0, DPR, 0, 0); dirty = false; }
addEventListener('resize', resize);
const P = [];
const cap = () => lite() ? 260 : 900;
function applyFx() { document.body.classList.toggle('dopa-lite', lite()); if (P.length > cap()) P.length = cap(); resize(); }
applyFx();
const amount = n => Math.max(1, Math.round(n * (lite() ? .35 : 1)));
const add = p => { if (P.length < cap()) P.push(p); };
const sprites = {};
function sprite(key, size, paint) { if (!sprites[key]) { const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); sprites[key] = c; } return sprites[key]; }
const coinImg = () => sprite('coin', 64, (g, s) => {
  const r = s / 2 - 3, grd = g.createRadialGradient(s * .38, s * .34, 2, s / 2, s / 2, r);
  grd.addColorStop(0, '#fff6c2'); grd.addColorStop(.45, '#ffd23f'); grd.addColorStop(1, '#e09a00');
  g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, r, 0, 6.283); g.fill(); g.lineWidth = 3; g.strokeStyle = '#b87400'; g.stroke();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(184,116,0,.55)'; g.beginPath(); g.arc(s / 2, s / 2, r - 7, 0, 6.283); g.stroke();
  g.fillStyle = '#a86400'; g.font = '900 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', s / 2, s / 2 + 1);
});
const starImg = color => sprite('star' + color, 48, (g, s) => {
  const c = s / 2; g.fillStyle = color; g.beginPath(); g.moveTo(c, 2);
  g.quadraticCurveTo(c + 4, c - 4, s - 2, c); g.quadraticCurveTo(c + 4, c + 4, c, s - 2); g.quadraticCurveTo(c - 4, c + 4, 2, c); g.quadraticCurveTo(c - 4, c - 4, c, 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(c, c, s * .09, 0, 6.283); g.fill();
});
function burst(x, y, color, n = 40, spd = 9) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(spd * .25, spd); add({ t: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, dec: rand(.012, .03), size: rand(2, 5.5), color }); } }
function stars(x, y, n = 10, spd = 8, cols = HUES) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(spd * .3, spd); add({ t: 'st', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, g: .12, rot: rand(0, 6.283), vr: rand(-.18, .18), size: rand(10, 22), life: 1, dec: rand(.014, .026), img: starImg(cols[i % cols.length]) }); } }
// home を渡すと、飛び散ったあと目標（XPゲージ）へ吸い込まれる。到着数でゲージを伸ばすので本数は間引かない。
function coins(x, y, n = 8, home) {
  const homing = !!home && !lite();
  for (let i = homing ? n : amount(n); i > 0; i--) { const a = rand(-2.7, -.45), v = rand(5, 11); add({ t: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: rand(0, 6.283), vs: rand(.16, .3), size: rand(15, 22), life: 1, dec: homing ? .004 : .009, age: 0, delay: homing ? rand(16, 24) + i * 1.4 : 0, home: homing ? home : null }); }
}
function ink(x, y, color = '#d7263d', n = 16) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(1, 6.5); add({ t: 'ink', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rand(1.5, 5), life: 1, dec: rand(.02, .035), color }); } }
function ring(x, y, color, w = 5) { add({ t: 'r', x, y, r: 10, vr: 16, life: 1, dec: .028, color, w }); }
function streaks(x, y, color, n = 16) { for (let i = amount(n); i > 0; i--) add({ t: 'ln', x, y, a: Math.random() * 6.283, d: rand(10, 30), v: rand(12, 22), len: rand(18, 46), w: rand(1.5, 3.5), life: 1, dec: rand(.035, .05), color }); }
function rays(x, y, color, ms = 2000) { if (calm()) return; add({ t: 'ray', x, y, a: rand(0, 6.283), life: 1, dec: 16.7 / ms, color, n: 14 }); }
function confetti(n = 120) {
  if (!W) resize();
  for (let i = 0, m = amount(n); i < m; i++) add({ t: 'c', x: rand(0, W), y: rand(-H * .6, -10), vx: rand(-2, 2), vy: rand(2.5, 6), rot: rand(0, 6), vr: rand(-.2, .2), w: rand(6, 13), h: rand(3, 7), life: 1, dec: rand(.003, .006), color: HUES[i % HUES.length] });
}
function fireworks(n = 3) {
  if (!W) resize();
  for (let i = 0, m = amount(n); i < m; i++) add({ t: 'fw', x: rand(W * .15, W * .85), y: H + 8, vx: rand(-1.2, 1.2), vy: -Math.sqrt(2 * .16 * rand(H * .45, H * .7)), life: 1, dec: .002, age: 0, delay: i * 16, color: HUES[(Math.random() * HUES.length) | 0] });
}
function explode(x, y, color) {
  for (let i = 0, m = amount(44); i < m; i++) { const a = i / m * 6.283, v = rand(3.2, 5.6); add({ t: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: rand(.012, .02), size: rand(1.8, 3.4), color }); }
  stars(x, y, 6, 6); ring(x, y, color, 3); play('boom');
}
function dot(x, y, r, color) { cx.fillStyle = color; cx.beginPath(); cx.arc(x, y, r, 0, 6.283); cx.fill(); }
function blit(img, x, y, size, rot, sx = 1) { const c = Math.cos(rot) * DPR, s = Math.sin(rot) * DPR; cx.setTransform(c * sx, s * sx, -s, c, x * DPR, y * DPR); cx.drawImage(img, -size / 2, -size / 2, size, size); cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
// 1粒を進めて描く。false で消す。k はフレーム時間の補正（60fps=1）。
function step(p, k, t) {
  switch (p.t) {
    case 's': p.x += p.vx * k; p.y += p.vy * k; p.vy += .17 * k; p.vx *= Math.pow(.98, k); if (p.y > H + 20) return false; cx.globalAlpha = p.life; dot(p.x, p.y, p.size * p.life + .5, p.color); return true;
    case 'st': { p.x += p.vx * k; p.y += p.vy * k; p.vy += p.g * k; p.vx *= Math.pow(.97, k); p.rot += p.vr * k; if (p.y > H + 30 || p.y < -80) return false; cx.globalAlpha = Math.min(1, p.life * 1.6) * (.7 + .3 * Math.sin(t / 70 + p.rot * 4)); blit(p.img, p.x, p.y, p.size * (.55 + .45 * p.life), p.rot); return true; }
    case 'r': p.r += p.vr * k; p.vr *= Math.pow(.93, k); cx.globalAlpha = p.life; cx.strokeStyle = p.color; cx.lineWidth = p.w * p.life; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.stroke(); return true;
    case 'c': {
      p.x += (p.vx + Math.sin(p.rot * 1.7) * .7) * k; p.y += p.vy * k; p.rot += p.vr * k; if (p.y > H + 20) return false;
      const c = Math.cos(p.rot) * DPR, s = Math.sin(p.rot) * DPR; cx.globalAlpha = Math.min(1, p.life * 2);
      cx.setTransform(c, s, -s, c, p.x * DPR, p.y * DPR); cx.fillStyle = p.color; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.3)) + .5); cx.setTransform(DPR, 0, 0, DPR, 0, 0); return true;
    }
    case 'coin': {
      p.age += k; p.spin += p.vs * k;
      if (p.home && p.age > p.delay) {
        const dx = p.home.target.x - p.x, dy = p.home.target.y - p.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(30, 7 + (p.age - p.delay) * 1.2), f = Math.min(1, .22 * k);
        p.vx += (dx / d * sp - p.vx) * f; p.vy += (dy / d * sp - p.vy) * f; p.life = Math.max(p.life, .6);
        if (d < 18 || p.age > p.delay + 120) { try { if (p.home.onArrive) p.home.onArrive(); } catch (e) { /* ignore */ } return false; }
      } else { p.vy += .32 * k; p.vx *= Math.pow(.985, k); if (p.y > H + 40) return false; }
      p.x += p.vx * k; p.y += p.vy * k; cx.globalAlpha = Math.min(1, p.life * 2);
      const sx = Math.abs(Math.cos(p.spin)); blit(coinImg(), p.x, p.y, p.size, 0, Math.max(.15, sx)); return true;
    }
    case 'ink': { p.x += p.vx * k; p.y += p.vy * k; const d = Math.pow(.8, k); p.vx *= d; p.vy *= d; cx.globalAlpha = Math.min(1, p.life * 1.5) * .9; dot(p.x, p.y, p.r * (1.25 - .25 * p.life), p.color); return true; }
    case 'ln': { p.d += p.v * k; p.v *= Math.pow(.92, k); const c = Math.cos(p.a), s = Math.sin(p.a), l = p.len * p.life; cx.globalAlpha = p.life; cx.strokeStyle = p.color; cx.lineWidth = p.w; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(p.x + c * p.d, p.y + s * p.d); cx.lineTo(p.x + c * (p.d + l), p.y + s * (p.d + l)); cx.stroke(); return true; }
    case 'ray': {
      p.a += .006 * k; const R = Math.hypot(W, H) * .75, g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.globalAlpha = Math.max(0, Math.min(1, (1 - p.life) * 6, p.life * 1.4)); cx.fillStyle = g; cx.beginPath();
      for (let i = 0; i < p.n; i++) { const a0 = p.a + i * 6.283 / p.n; cx.moveTo(p.x, p.y); cx.arc(p.x, p.y, R, a0, a0 + .17); cx.closePath(); }
      cx.fill(); return true;
    }
    case 'fw': {
      p.age += k; if (p.age < p.delay) return true;
      p.x += p.vx * k; p.y += p.vy * k; p.vy += .16 * k;
      cx.globalAlpha = 1; dot(p.x, p.y, 2.6, p.color); cx.globalAlpha = .45; dot(p.x - p.vx, p.y - p.vy * 1.5, 1.8, p.color);
      if (p.vy > -1.2) { explode(p.x, p.y, p.color); return false; }
      return true;
    }
  }
  return false;
}
function drawFx(t = now()) {
  const k = last ? Math.min(3, Math.max(.3, (t - last) / 16.667)) : 1; last = t;
  // フィーバー中は画面の両端から星がゆっくり昇る。
  if (feverOn && !lite() && t > ambientAt) { ambientAt = t + 180; const left = Math.random() < .5; add({ t: 'st', x: left ? rand(6, W * .12) : rand(W * .88, W - 6), y: H + 14, vx: rand(-.3, .3), vy: -rand(1.6, 3), g: 0, rot: rand(0, 6.283), vr: rand(-.05, .05), size: rand(8, 14), life: 1, dec: .006, img: starImg(HUES[Math.random() * HUES.length | 0]) }); }
  if (!P.length) { if (dirty) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); dirty = false; } return; }
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); dirty = true;
  const len = P.length; let n = 0;
  for (let i = 0; i < len; i++) { const p = P[i]; p.life -= p.dec * k; if (p.life > 0 && step(p, k, t)) P[n++] = p; }
  for (let j = len; j < P.length; j++) P[n++] = P[j]; // 描画中に生まれた粒（花火の破裂）
  P.length = n; cx.globalAlpha = 1; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
(function loop(t) { drawFx(t); requestAnimationFrame(loop); })(now());

/* ---- 画面の文字・揺れ ---- */
function pop(text, x, y, cls = '') { const el = document.createElement('div'); el.className = 'dopa-pop ' + cls; el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); setTimeout(() => el.remove(), 1400); return el; }
const queue = []; let showing = false;
// 同時に起きた節目（クリティカル・フィーバー・レベルアップ等）は重ねず、順番に見せる。溜まり過ぎたら keep の付かない古いものから捨てる。
function banner(html, cls = '', o = {}) {
  if (queue.length >= 3) { const i = queue.findIndex(b => !b.keep); queue.splice(i < 0 ? 0 : i, 1); }
  queue.push({ html, cls, ...o }); if (!showing) nextBanner();
}
function nextBanner() {
  const b = queue.shift(); if (!b) { showing = false; return; }
  showing = true;
  const el = document.createElement('div'); el.className = 'dopa-banner ' + b.cls; el.innerHTML = b.html; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el);
  try { if (b.sfx) b.sfx(); if (b.fx) b.fx(); } catch (e) { /* 演出の失敗で進行を止めない */ }
  const ms = b.ms || 1500; setTimeout(() => el.remove(), ms); setTimeout(nextBanner, b.gap || Math.min(ms * .62, 980));
}
function flash(bg) { if (calm()) return; flashEl.style.background = bg; flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on'); }
function shake(el, big = false, cls) {
  el = el || appRoot(); if (calm() || !el) return;
  const name = cls === 'wobble' ? 'dopa-wobble' : big ? 'dopa-shake2' : 'dopa-shake';
  el.classList.remove('dopa-shake', 'dopa-shake2', 'dopa-wobble'); void el.offsetWidth; el.classList.add(name);
  clearTimeout(el.dopaShakeEnd); el.dopaShakeEnd = setTimeout(() => el.classList.remove('dopa-shake', 'dopa-shake2', 'dopa-wobble'), 720);
}
let marq = null;
// パチスロの電飾: 画面の四辺を光の粒が走る（transform だけで動かす）。
function marquee(mode = '', ms = 1600) {
  if (calm()) return;
  if (!marq) { marq = layer('div', 'dopa-marquee'); marq.innerHTML = '<i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i>'; }
  marq.className = 'dopa-marquee on ' + mode; clearTimeout(marq.off); marq.off = setTimeout(() => { marq.className = 'dopa-marquee'; }, ms);
}
// リールを止める: 目標の数字が真ん中の段に来るまで少し滑らせて弾ませる（帯は0〜9を3周）。
function stopReel(reel, d) {
  if (!reel || !reel.firstElementChild) return;
  const strip = reel.firstElementChild, cell = reel.clientHeight / 3 || 56;
  reel.classList.remove('spin'); strip.style.transition = 'none'; strip.style.transform = `translateY(${-(7 + d) * cell}px)`; void strip.offsetWidth;
  strip.style.transition = 'transform .38s cubic-bezier(.2,1.45,.45,1)'; strip.style.transform = `translateY(${-(9 + d) * cell}px)`; reel.classList.add('stopped');
}
let judgeEl = null;
// 正誤表示: 画面中央に大きな丸印と言葉を一瞬だけ。続けて押したら前のものを差し替える。
function judge(mark, word, sub, kind) {
  if (judgeEl) judgeEl.remove();
  const e = document.createElement('div'); e.className = 'dopa-judge ' + kind; e.setAttribute('aria-hidden', 'true');
  e.innerHTML = '<b>' + escHtml(mark) + '</b><strong>' + escHtml(word) + '</strong><small>' + escHtml(sub) + '</small>';
  document.body.appendChild(e); judgeEl = e; setTimeout(() => { e.remove(); if (judgeEl === e) judgeEl = null; }, 1150);
}
function freezeScreen(ms) {
  if (calm()) return;
  const f = layer('div', 'dopa-freeze');
  setTimeout(() => { f.classList.add('out'); setTimeout(() => f.remove(), 400); }, ms);
}
function bump(el, cls = 'dopa-bump') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function edge(el, kind) { if (!el) return; el.classList.remove('dopa-edge-ok', 'dopa-edge-ng'); el.classList.add('dopa-edge-' + kind); clearTimeout(el.dopaEdge); el.dopaEdge = setTimeout(() => el.classList.remove('dopa-edge-ok', 'dopa-edge-ng'), 900); }
function toast(msg) { const t = document.createElement('div'); t.textContent = msg; toastEl.appendChild(t); setTimeout(() => t.remove(), 2700); }
let aura = null;
function setFever(on) {
  feverOn = !!on; document.body.classList.toggle('dopa-fever', feverOn);
  if (bgm && /^(practice|fever)$/.test(bgm.current() || '')) bgm.play(feverOn ? 'fever' : 'practice');
  if (feverOn && !aura) aura = layer('div', 'dopa-aura');
}
const center = el => { const r = el && el.isConnected ? el.getBoundingClientRect() : null; return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: W / 2, y: H / 2 }; };
let timers = [];
function later(fn, ms) { const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms); timers.push(id); return id; }
// 数字を回して止める。演出オフでは即座に最終値。
function countUp(el, to, o = {}) {
  const { from = 0, ms = 900, fmt = v => String(v), tick = null, step: unit = 1 } = o;
  return new Promise(res => {
    if (!el) return res();
    if (lite() || ms <= 0) { el.textContent = fmt(to); return res(); }
    const t0 = now(); let shown = null, tickAt = 0;
    const frame = () => {
      if (!el.isConnected) return res();
      const p = Math.min(1, (now() - t0) / ms), v = p < 1 ? Math.floor((from + (to - from) * (1 - Math.pow(1 - p, 3))) / unit) * unit : to, text = fmt(v);
      if (text !== shown) { el.textContent = text; shown = text; if (tick && p < 1 && now() - tickAt > 55) { tickAt = now(); tick(p); } }
      if (p < 1) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  });
}
// ハンコ: 正解は朱色の「正解」、不正解はオレンジの「伸びしろ」。押した瞬間に音と飛沫。
const STAMPINK = { ok: '#d7263d', ng: '#ff8a00' };
function stamp(host, ok, text, quiet) {
  if (!host) return null;
  const k = ok ? 'ok' : 'ng', s = document.createElement('span'); s.className = 'dopa-stamp ' + k; s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<b>' + escHtml(text) + '</b>'; host.appendChild(s);
  play('stamp', ok, .19);
  later(() => { if (!s.isConnected) return; const { x, y } = center(s); ink(x, y, STAMPINK[k], quiet ? 8 : 18); if (!quiet) ring(x, y, STAMPINK[k], 3); if (!ok) stars(x, y, 8, 6, PASTEL); }, 190);
  return s;
}

/* ---- XPゲージ ---- */
const xp = { el: null, hide: 0, pay: 0 };
function xpEl() {
  if (xp.el) return xp.el;
  const e = layer('div', 'dopa-xp');
  e.innerHTML = '<div class="dopa-xp-in"><span class="dopa-xp-lv">Lv <b></b></span><i class="dopa-xp-bar"><u></u></i><span class="dopa-xp-gain"></span></div>';
  return (xp.el = e);
}
function xpBar(f, snap) { const e = xpEl(), u = e.querySelector('u'); if (snap) { e.classList.add('snap'); u.style.transform = `scaleX(${f})`; void u.offsetWidth; e.classList.remove('snap'); } else u.style.transform = `scaleX(${f})`; }
function xpHide() { clearTimeout(xp.hide); xp.pay++; if (xp.el) xp.el.classList.remove('show', 'lvup'); }
function levelUp(lv, title, titleUp) {
  banner(`LEVEL UP!<small>Lv.${lv}『${escHtml(title)}』</small>`, 'lv', { keep: true, ms: 1700, sfx: () => play('level'), fx: () => { confetti(110); rays(W / 2, H * .36, 'rgba(20,184,102,.22)'); burst(W / 2, H * .36, '#14b866', 70, 13); stars(W / 2, H * .36, 14, 10); } });
  if (titleUp) banner(`称号獲得<small>『${escHtml(title)}』</small>`, 'record', { keep: true, ms: 1600, sfx: () => play('record'), fx: () => stars(W / 2, H * .36, 24, 11) });
}
// 獲得XPを上部の小さなゲージへ集める。コインが届くたびに数字とゲージが伸び、最後にレジの音で確定。
function payout(info, origin) {
  const e = xpEl(), pay = ++xp.pay, end = info.up ? 1 : info.f1, gainEl = e.querySelector('.dopa-xp-gain'), lvEl = e.querySelector('b'), total = Math.min(12, 3 + Math.round(info.gain / 6));
  clearTimeout(xp.hide); e.classList.remove('lvup'); lvEl.textContent = info.lv0; gainEl.textContent = '+0 XP'; xpBar(info.f0, true); e.classList.add('show');
  let got = 0, done = false;
  const finish = () => {
    if (done || pay !== xp.pay) return; done = true;
    gainEl.textContent = '+' + info.gain + ' XP'; xpBar(end); bump(e, 'bump'); play('register');
    if (info.up) later(() => { if (pay !== xp.pay) return; e.classList.add('lvup'); lvEl.textContent = info.lv1; xpBar(0, true); xpBar(info.f1); levelUp(info.lv1, info.title, info.titleUp); }, 320);
    xp.hide = setTimeout(() => { if (pay === xp.pay) e.classList.remove('show', 'lvup'); }, info.up ? 2800 : 1900);
  };
  const arrive = () => { if (done || pay !== xp.pay) return; got++; const p = Math.min(1, got / total); play('coinTick', got); gainEl.textContent = '+' + Math.round(info.gain * p) + ' XP'; xpBar(info.f0 + (end - info.f0) * p); bump(e, 'bump'); if (got >= total) finish(); };
  if (lite() || !origin) { later(finish, 450); return; }
  const r = e.getBoundingClientRect();
  coins(origin.x, origin.y, total, { target: { x: r.left + r.width * .45, y: r.top + r.height / 2 }, onArrive: arrive });
  later(finish, 1800); // 万一コインが届かなくても締める
}

/* ---- 場面ごとの演出 ---- */
const TIER = c => c >= 10 ? '#ff3d9a' : c >= 5 ? '#ff7a00' : '#7c4dff';
const RANKCOL = { S: '#ff9500', A: '#ff3d9a', B: '#1a7fd6', C: '#15a35c', D: '#ff8a00' };
// 間違えても明るく。赤い警告色は使わず、パステルの光と前向きな言葉にする。
const PASTEL = ['#ffd93d', '#6bcbff', '#ff9ecd', '#9bf6c0', '#c3a6ff'];
const MISSBG = 'radial-gradient(ellipse at center, rgba(255,236,153,0) 40%, rgba(255,214,102,.34) 75%, rgba(107,203,255,.3) 100%)';
const CHEERS = ['ドンマイ!', 'おしい!', '伸びしろ発見!', 'ナイスチャレンジ!', '次は取れる!', '覚えるチャンス!'];
const pick = list => list[Math.random() * list.length | 0];
const moment = {
  start(title = 'QUEST START') {
    play('questStart');
    banner(escHtml(title), 'go', { ms: 1000, fx: () => { burst(W / 2, H * .42, '#7c4dff', 46, 11); ring(W / 2, H * .42, '#ff3d9a'); stars(W / 2, H * .42, 10, 9); } });
  },
  // 答え合わせ。ev: ok, combo, gain, chips, crit, feverStart, revenge, broken, assisted, xp(xpInfo), daily, x, y, host（ハンコの置き場）, panel（光らせる枠）, stage（揺らす要素）。
  answer(ev) {
    const x = ev.x ?? W / 2, y = ev.y ?? H * .6, panel = ev.panel, stage = ev.stage || appRoot();
    // 解答を見た問題は経験値・コンボの演出なしで、正誤だけを見せる。
    if (ev.assisted) {
      play(ev.ok ? 'correct' : 'wrong', 1); stamp(ev.host, ev.ok, ev.ok ? '正解' : '伸びしろ', true);
      if (ev.ok) { burst(x, y, '#7c4dff', 30, 8); stars(x, y, 8); } else stars(x, y, 10, 6, PASTEL);
      return;
    }
    haptic(ev.xp && ev.xp.up ? 'big' : ev.ok ? (ev.combo >= 10 ? 'good' : 'ok') : 'bad');
    if (ev.ok) {
      const c = ev.combo || 1, col = TIER(c);
      play('correct', c); stamp(ev.host, true, '正解');
      burst(x, y, col, 40 + Math.min(c * 5, 80), 9 + Math.min(c, 10) * .5); burst(x, y, '#ffc21a', 18, 7); stars(x, y, 8 + Math.min(c, 14)); ring(x, y, col);
      if (c >= 5) streaks(x, y, col, 10 + Math.min(c, 20));
      if (c >= 10) coins(x, y, 10);
      flash(c >= 10 ? 'rgba(255,61,154,.16)' : 'rgba(124,77,255,.11)'); edge(panel, 'ok');
      if (ev.gain) pop('+' + ev.gain + ' XP', x, y - 48, 'xp' + (ev.gain >= 50 ? ' big' : ''));
      if (ev.revenge) later(() => pop('REVENGE!', x, y - 96, 'revenge'), 220);
      (ev.chips || []).forEach((_, i) => play('chip', i, .3 + i * .08));
      if (ev.crit) banner('CRITICAL!!<small>経験値 3 倍</small>', 'crit', { sfx: () => play('crit'), fx: () => { burst(W / 2, H * .4, '#ffb300', 90, 15); rays(W / 2, H * .4, 'rgba(255,194,26,.24)'); } });
      if (ev.feverStart) banner('FEVER!!<small>XP 2倍モード突入</small>', 'fever', { ms: 1700, sfx: () => play('fever'), fx: () => { confetti(90); rays(W / 2, H * .4, 'rgba(255,61,154,.2)'); } });
      else if ([3, 5, 7].includes(c)) { play('combo', c, .45); later(() => pop(c + ' COMBO!', W / 2, H * .26, 'combo big'), 450); }
      else if (c === 15) banner('UNSTOPPABLE<small>15連続正解!</small>', 'fever', { sfx: () => play('combo', c) });
      else if (c === 20) banner('GODLIKE<small>20連続、合格が見えてきた</small>', 'crit', { sfx: () => play('crit'), fx: () => fireworks(2) });
      else if (c > 20 && c % 10 === 0) banner(c + ' COMBO<small>神正解、降臨</small>', 'crit', { sfx: () => play('fever'), fx: () => { confetti(120); fireworks(2); } });
    } else {
      play('wrong'); stamp(ev.host, false, '伸びしろ');
      shake(stage, true, 'wobble'); edge(panel, 'ng'); flash(MISSBG);
      pop(pick(CHEERS), x, y - 48, 'cheer big'); stars(x, y, 14, 7, PASTEL); burst(x, y, '#6bcbff', 22, 7);
      if (ev.broken >= 5) banner(`NICE ${ev.broken} COMBO!<small>いい流れだった！また積み上げよう</small>`, 'combo', { sfx: () => play('comboBreak'), fx: () => confetti(60) });
    }
    if (ev.xp) payout(ev.xp, { x, y });
    if (ev.daily) banner(`DAILY CLEAR!<small>今日の目標 ${escHtml(ev.goal)}問 達成 · +30 XP</small>`, 'crit', { keep: true, ms: 1700, sfx: () => play('daily'), fx: () => confetti(140) });
  },
  // 練習の結果: ランクを叩きつけ、数字を回し、XPをレジで確定。
  result(o) {
    const T = calm() ? .35 : 1;
    later(() => {
      if (!o.rankEl || !o.rankEl.isConnected) return;
      o.rankEl.classList.add('go'); play('rank'); shake(appRoot(), 'SA'.includes(o.letter));
      const { x, y } = center(o.rankEl), col = RANKCOL[o.letter] || '#7c4dff';
      burst(x, y, col, 80, 14); ring(x, y, col); stars(x, y, 'SA'.includes(o.letter) ? 22 : 8, 10);
      if ('SA'.includes(o.letter)) { streaks(x, y, col, 24); confetti(o.letter === 'S' ? 220 : 120); later(() => play('fanfare', o.letter), 280); if (o.letter === 'S') rays(x, y, 'rgba(255,194,26,.24)'); }
    }, 380 * T);
    later(() => (o.counts || []).forEach((c, i) => countUp(c.el, c.to, { ms: 700 * T, fmt: c.fmt, tick: i === 0 ? p => play('count', p) : null })), 600 * T);
    if (o.xpEl) later(() => countUp(o.xpEl, o.gain, { ms: 900 * T, fmt: n => '+' + n, tick: p => play('coinTick', Math.round(p * 5)) }).then(() => { if (o.xpEl && o.xpEl.isConnected) { play('register'); bump(o.xpEl.parentElement); } }), 900 * T);
    if (o.perfect) later(() => banner('PERFECT!!<small>全問正解</small>', 'crit', { keep: true, sfx: () => play('record'), fx: () => fireworks(3) }), 1500 * T);
    // 低めのランクでも、最後は明るく。
    if ('CD'.includes(o.letter)) later(() => banner(o.letter === 'D' ? '伸びしろMAX!<small>間違えた分だけ、次の正解が近い</small>' : 'ナイスチャレンジ!<small>この調子で積み上げよう</small>', 'praise', { sfx: () => play('comboBreak'), fx: () => { confetti(70); stars(W / 2, H * .4, 14, 8, PASTEL); } }), 1250 * T);
    if (o.newRec) later(() => banner('NEW RECORD!<small>' + escHtml(o.newRec) + '</small>', 'record', { keep: true, sfx: () => play('record'), fx: () => confetti(100) }), 1700 * T);
    if (o.lvUp) later(() => levelUp(o.lvUp.lv, o.lvUp.title, o.lvUp.titleUp), 2100 * T);
  },
  // ---- 模試（パチスロ風） ----
  examStart(sub = '模試スロット、レバーオン!') { play('gameStart'); marquee('', 1500); banner('GAME START<small>' + escHtml(sub) + '</small>', 'slot', { ms: 1300 }); },
  examAnswered(el, n) { play('lampOn', n); if (!el) return; bump(el, 'dopa-lit'); const { x, y } = center(el); stars(x, y, 6, 5, ['#ffd93d', '#ff3d9a', '#6bcbff']); },
  sectionClear(name) { play('complete'); marquee('', 900); banner(`${escHtml(name)}<small>入力コンプリート!</small>`, 'slot small', { ms: 1100 }); },
  allAnswered(el) { play('chance'); marquee('win', 2000); if (el) bump(el, 'dopa-lit'); banner('ALL ANSWERED!<small>提出でボーナス判定</small>', 'slot', { keep: true, ms: 1500 }); },
  // 「次へ進む」で今の問題の正誤を画面中央に一瞬だけ大きく出す。
  examJudge(o) {
    judge(o.ok ? '◎' : o.part ? '△' : '✕', o.ok ? '正解!' : o.part ? '部分点!' : '不正解', o.ok || o.part ? (o.sub || '+' + o.got + '点') : pick(CHEERS), o.ok ? 'ok' : o.part ? 'part' : 'ng');
    if (o.ok) { play('correct', 3); play('coin'); haptic('ok'); burst(W / 2, H * .42, '#ffb300', 50, 11); stars(W / 2, H * .42, 12, 9); ring(W / 2, H * .42, '#ff3d9a'); }
    else if (o.part) { play('chance'); haptic('light'); stars(W / 2, H * .42, 12, 8, ['#ffd93d', '#6bcbff', '#ff9ecd']); }
    else { play('wrong'); haptic('bad'); stars(W / 2, H * .42, 14, 7, PASTEL); burst(W / 2, H * .42, '#6bcbff', 22, 7); }
    if (o.nav) bump(o.nav, 'dopa-lit');
  },
  // 結果発表のスロット: レバー → 3つのリールが百・十・一の位で止まる → GOGO!ランプ → ボーナス → 払い出し。
  slot(o) {
    const q = calm(), k = q ? .25 : 1, frz = o.perfect && !q ? 1000 : 0;
    const t0 = frz, t1 = frz + 1300 * k, t2 = frz + 2000 * k, t3 = frz + (o.passed && !q ? 3200 : 2800) * k, tEnd = t3 + 220;
    if (frz) { play('freeze'); freezeScreen(frz - 80); later(() => { play('premium'); flash('rgba(255,255,255,.85)'); }, frz - 120); }
    later(() => {
      play('lever'); play('reelSpin', (t3 - t0) / 1000 + .05); marquee(frz ? 'rainbow fast' : 'fast', t3 - t0 + 2800);
      if (o.machine) o.machine.classList.add('on'); o.reels.forEach(r => r && r.classList.add('spin'));
    }, t0);
    [t1, t2, t3].forEach((t, i) => later(() => {
      stopReel(o.reels[i], o.digits[i]); play('reelStop', i);
      if (i !== 1) return;
      if (o.passed) { if (o.gogo) o.gogo.classList.add('lit'); play('peka'); const c = center(o.gogo); stars(c.x, c.y, 14, 8, ['#ff3d9a', '#ffd93d', '#6bcbff']); if (!q) play('kyuin', .45); }
      else if (o.chance) { if (o.machine) o.machine.classList.add('chance'); play('chance'); }
    }, t));
    later(() => {
      if (o.scoreEl) { o.scoreEl.textContent = o.scoreText; bump(o.scoreEl.parentElement, 'dopa-scorepop'); }
      if (o.bar) { o.bar.style.transition = 'transform .9s cubic-bezier(.25,1,.35,1)'; o.bar.style.transform = `scaleX(${o.pct})`; }
      (o.sections || []).forEach((s, i) => later(() => { s.el.style.transform = `scaleX(${s.frac})`; play('chip', i); }, 120 + i * 140));
      if (o.verdict) o.verdict.classList.add('show');
      const m = center(o.machine);
      if (o.payout > 0) { coins(m.x, m.y, Math.min(30, 6 + (o.payout / 4 | 0))); later(() => play('payout', Math.min(40, 8 + (o.payout / 5 | 0))), 250); countUp(o.payEl, o.payout, { ms: 1400, fmt: n => '+' + n }); }
      if (o.passed) {
        if (o.machine) o.machine.classList.add('win');
        if (o.seal) { o.seal.classList.add('go'); play('stamp', true, .2); later(() => { const c = center(o.seal); ink(c.x, c.y, '#d7263d', 26); ring(c.x, c.y, 'rgba(215,38,61,.5)', 4); shake(appRoot(), true); }, 210); }
        const B = [null, ['BIG BONUS!', '目標ラインを突破 · 青7'], ['BIG BONUS!!', '80%超え · 赤7'], ['SUPER BIG!!', '90%超え · 金7'], ['PREMIUM BONUS!!!', '満点 · 虹7']][o.tier] || ['BIG BONUS!', 'クリア'];
        later(() => {
          play('bigBonus', o.tier); confetti(o.tier >= 3 ? 240 : 180); fireworks(o.tier >= 3 ? 5 : 3); rays(m.x, m.y, o.tier >= 4 ? 'rgba(255,61,154,.26)' : 'rgba(255,194,26,.26)', 2800);
          banner(`${B[0]}<small>${escHtml(o.bonusText || B[1])}</small>`, 'bonus t' + o.tier, { keep: true, ms: 2100 }); marquee(o.tier >= 4 ? 'rainbow' : 'win', 4200);
        }, 380);
      } else {
        // 届かなくても明るく: チャンス目からの「次回に期待」。
        banner(`あと ${escHtml(o.need)}!<small>${o.chance ? 'チャンス目! 次は当たる!' : '次回ボーナスに期待!'}</small>`, 'go', { keep: true, ms: 1900, sfx: () => play('fail'), fx: () => { confetti(80); stars(m.x, m.y, 16, 8, PASTEL); } });
      }
      if (o.lvUp) later(() => levelUp(o.lvUp.lv, o.lvUp.title, o.lvUp.titleUp), 1700);
    }, tEnd);
  },
  // 提出・採点完了などの節目。
  fanfare(title, sub, letter = 'A') { play('fanfare', letter); banner(escHtml(title) + (sub ? '<small>' + escHtml(sub) + '</small>' : ''), 'record', { keep: true, ms: 1600, fx: () => { confetti(120); stars(W / 2, H * .4, 18, 10); } }); },
  // 設定画面のサウンドテスト。
  preview(name, btn) {
    const { x, y } = center(btn); haptic('ok');
    if (name === 'correct') { play('correct', 3); burst(x, y, '#7c4dff', 46, 9); stars(x, y, 10); ring(x, y, '#7c4dff'); pop('+29 XP', x, y - 44, 'xp'); play('register', .75); }
    else if (name === 'combo') { play('correct', 7); play('combo', 7, .3); streaks(x, y, '#ff7a00', 18); later(() => pop('7 COMBO!', x, y - 50, 'combo big'), 300); }
    else if (name === 'fever') banner('FEVER!!<small>XP 2倍モード突入</small>', 'fever', { ms: 1600, sfx: () => play('fever'), fx: () => { confetti(90); rays(W / 2, H * .4, 'rgba(255,61,154,.2)'); } });
    else if (name === 'level') levelUp(12, opt.sampleTitle || '合格の使者', false);
    else if (name === 'miss') { play('wrong'); shake(appRoot(), true, 'wobble'); flash(MISSBG); pop(pick(CHEERS), x, y - 44, 'cheer big'); stars(x, y, 14, 7, PASTEL); }
    else if (name === 'slot') {
      play('lever'); play('reelSpin', 1.4); marquee('fast', 3800);
      later(() => play('reelStop', 0), 500); later(() => { play('reelStop', 1); play('peka'); }, 900); later(() => { play('reelStop', 2); play('kyuin'); }, 1300);
      later(() => { play('bigBonus', 2); confetti(150); fireworks(3); banner('BIG BONUS!!<small>結果発表はこの演出</small>', 'bonus t2', { ms: 1800 }); }, 1550);
      later(() => play('payout', 24), 2500);
    }
  },
};
// 画面を離れたら、予約中の演出・ゲージ・フィーバーを片付ける。clean で残りの粒子も消す。
function reset(clean = false) { timers.forEach(clearTimeout); timers = []; queue.length = 0; xpHide(); setFever(false); if (clean) P.length = 0; }
// スロットの見た目（結果画面に差し込む）。digits は百・十・一の位、payout は払い出し表示。
function slotHTML(digits, o = {}) {
  const anim = !lite() && !o.static;
  const reel = d => `<div class="dopa-reel"><div class="dopa-strip" style="transform:translateY(calc(var(--cell) * -${9 + (anim ? 7 : d)}))">${Array.from({ length: 30 }, (_, i) => `<span${i % 10 === 7 ? ' class="seven"' : ''}>${i % 10}</span>`).join('')}</div></div>`;
  return `<div class="dopa-slot${anim ? '' : ' on'}${!anim && o.passed ? ' win' : ''}" aria-hidden="true"><div class="dopa-slot-head"><span class="dopa-gogo${!anim && o.passed ? ' lit' : ''}">GOGO!</span><b>${escHtml(o.name || 'QUEST SLOT')}</b><span class="dopa-slot-pay">PAYOUT <b>${anim ? 0 : '+' + (o.payout || 0)}</b></span></div><div class="dopa-reels">${digits.map(reel).join('')}<i class="dopa-payline"></i></div></div>`;
}

/* ---- 2分間操作がないときの一時停止 ---- */
// start({ ms, busy, onIdle }) で見張る。busy() が真の間（読み上げ中など）は待つ。画面を離れたら onIdle('hidden')。
const idle = (() => {
  let o = null, at = now();
  const poke = () => { at = now(); };
  for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'input', 'scroll']) addEventListener(t, poke, { capture: true, passive: true });
  setInterval(() => {
    if (!o) return; const t = now();
    if (o.busy && o.busy()) { at = t; return; }
    if (t - at >= (o.ms || 120000)) { const cur = o; o = null; cur.onIdle('idle'); }
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && o) { const cur = o; o = null; cur.onIdle('hidden'); } });
  return { start(x) { o = x; at = now(); }, stop() { o = null; }, poke, active: () => !!o, idleFor: () => now() - at, age(ms) { at = now() - ms; } }; // age は検証用（無操作の経過を進める）
})();

/* ---- 一時停止画面・設定パネル ---- */
let overlay = null;
function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
function card(html, cls = '') {
  closeOverlay();
  overlay = document.createElement('div'); overlay.className = 'dopa-overlay';
  overlay.innerHTML = `<div class="dopa-card ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}
// 確認・解答表示などのダイアログ。actions: [{ label, primary, onClick }]（押すと閉じてから onClick）。
function modal(p = {}) {
  const ov = card(`${opt.avatar ? `<img class="dopa-avatar" src="${escHtml(opt.avatar)}" alt="">` : ''}<h2>${escHtml(p.title || '一時停止')}</h2><p>${p.text || ''}</p><div class="dopa-actions">${(p.actions || []).map((a, i) => `<button type="button" class="dopa-btn${a.primary ? ' primary' : ''}" data-i="${i}">${escHtml(a.label)}</button>`).join('')}</div>`);
  ov.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { const a = p.actions[+b.dataset.i]; closeOverlay(); play('ok'); if (a && a.onClick) a.onClick(); }));
  const first = ov.querySelector('.dopa-btn.primary') || ov.querySelector('.dopa-btn'); if (first) first.focus();
  return ov;
}
// 一時停止: BGMも止める。
function pauseScreen(p = {}) { if (bgm) bgm.stop(); syncHint(); return modal(p); }
// 設定: 効果音・BGMの音量、派手な演出、振動、サウンドテスト。extra: [{ label, note, get, set }] はアプリ固有のオン・オフ。
function openSettings(x = {}) {
  const extra = x.extra || [];
  const ov = card(`<h2>サウンドと演出</h2>
    <label class="dopa-row">効果音<input type="range" min="0" max="100" step="5" value="${set.vol}" data-k="vol"></label>
    <label class="dopa-row"><span>BGM<small>アプリ内で作った曲（一時停止中は止まります）</small></span><input type="range" min="0" max="100" step="5" value="${set.bgm}" data-k="bgm"></label>
    <label class="dopa-row"><span>派手な演出<small>オフで揺れ・点滅を止め、粒子を減らします</small></span><input type="checkbox" data-k="fx" ${set.fx ? 'checked' : ''}></label>
    <label class="dopa-row"><span>振動<small>対応端末のみ</small></span><input type="checkbox" data-k="rumble" ${set.rumble ? 'checked' : ''}></label>
    ${extra.map((e, i) => `<label class="dopa-row"><span>${escHtml(e.label)}${e.note ? `<small>${escHtml(e.note)}</small>` : ''}</span><input type="checkbox" data-x="${i}" ${e.get() ? 'checked' : ''}></label>`).join('')}
    <p style="margin:14px 0 4px;font-weight:900;font-size:13px">サウンドテスト</p>
    <div class="dopa-test">${[['correct', '正解'], ['combo', 'コンボ'], ['fever', 'フィーバー'], ['level', 'レベルアップ'], ['miss', 'ドンマイ'], ['slot', 'スロット']].map(([k, l]) => `<button type="button" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="dopa-actions"><button type="button" class="dopa-btn primary" data-close>閉じる</button></div>`, 'dopa-settings');
  ov.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
    const k = inp.dataset.k; set[k] = inp.type === 'range' ? +inp.value : inp.checked; saveSet();
    if (k === 'vol') { syn.setLevel(sfxLevel()); play('select', 2); }
    if (k === 'bgm' && bgm) { bgm.setLevel(); if (set.bgm > 0 && x.bgmSong) bgm.play(x.bgmSong()); }
    if (k === 'fx') applyFx();
    syncHint();
  }));
  ov.querySelectorAll('input[data-x]').forEach(inp => inp.addEventListener('change', () => { extra[+inp.dataset.x].set(inp.checked); }));
  ov.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { audioUnlock(); moment.preview(b.dataset.t, b); }));
  ov.querySelector('[data-close]').addEventListener('click', () => { closeOverlay(); play('back'); if (x.onClose) x.onClose(); });
  ov.addEventListener('click', e => { if (e.target === ov) { closeOverlay(); if (x.onClose) x.onClose(); } });
}
function syncHint() { soundHint(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay && overlay.querySelector('[data-close]')) { closeOverlay(); } });

return {
  settings: () => ({ ...set }), play, audioUnlock, haptic, reduced, calm, lite,
  burst, stars, coins, ink, ring, streaks, rays, confetti, fireworks,
  banner, pop, toast, flash, shake, bump, edge, stamp, countUp, setFever, reset, center,
  moment, payout, levelUp, judge, marquee, slotHTML, idle, pauseScreen, modal, openSettings, closeOverlay,
  overlayOpen: () => !!overlay,
  bgm: name => { if (bgm) { bgm.play(name === 'practice' && feverOn ? 'fever' : name); syncHint(); } },
  bgmStop: () => { if (bgm) bgm.stop(); syncHint(); }, bgmHold: on => { if (bgm) bgm.hold(on); },
  debug: { particles: () => P.length, queued: () => queue.length + (showing ? 1 : 0), fever: () => feverOn, bgm: () => bgm ? bgm.current() : null, audio: () => ac ? ac.state : 'none' },
};
}

window.Dopa = { create, level, scoreAnswer, xpInfo, rankLetter, day, createSynth, createBgm };
})();
