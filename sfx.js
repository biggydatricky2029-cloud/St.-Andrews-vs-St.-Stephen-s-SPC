// sfx.js — procedural crowd audio (Web Audio API).
// Generates crowd murmur, a rhythmic pulse chant, and a TD cheer swell
// without shipping any audio files.
(function (FB) {
  'use strict';

  const sfx = {
    ctx: null,
    master: null,
    crowdGain: null,
    chantGain: null,
    noiseNode: null,
    started: false,
    enabled: true,
    _chantTimer: null,
  };

  function makePinkNoise(ctx) {
    // 2s pink-ish noise buffer, looped. Pink = 1/f falloff approximation.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    return node;
  }

  // One vocal "hey" — a quick noise burst + formant-ish bandpass sweep.
  function vocalHit(when, semitone, dur, gain) {
    const ctx = sfx.ctx;
    const src = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    src.buffer = buf;

    const base = 220 * Math.pow(2, semitone / 12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(base, when);
    bp.frequency.exponentialRampToValueAtTime(base * 1.6, when + dur * 0.7);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    src.connect(bp); bp.connect(g); g.connect(sfx.chantGain);
    src.start(when); src.stop(when + dur + 0.05);
  }

  function scheduleChant(when) {
    // Call-and-response pulse: "HIGH — LAND — ERS!" three beats then break.
    const beat = 0.45;
    vocalHit(when + 0 * beat, 0, 0.28, 0.6);
    vocalHit(when + 1 * beat, -2, 0.28, 0.55);
    vocalHit(when + 2 * beat, 4, 0.55, 0.9);
  }

  FB.sfx = sfx;

  // User gesture is required on iOS to unlock audio. Call from any tap.
  sfx.start = function () {
    if (sfx.started || !sfx.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { sfx.enabled = false; return; }
      const ctx = new AC();
      sfx.ctx = ctx;

      sfx.master = ctx.createGain();
      sfx.master.gain.value = 0.55;
      sfx.master.connect(ctx.destination);

      // Rumbly crowd bed (low-passed pink noise).
      const noise = makePinkNoise(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 60;
      sfx.crowdGain = ctx.createGain();
      sfx.crowdGain.gain.value = 0.18;
      noise.connect(hp); hp.connect(lp); lp.connect(sfx.crowdGain);
      sfx.crowdGain.connect(sfx.master);
      noise.start();
      sfx.noiseNode = noise;

      // Chant bus (vocal hits are louder and routed through a shared gain).
      sfx.chantGain = ctx.createGain();
      sfx.chantGain.gain.value = 0.9;
      sfx.chantGain.connect(sfx.master);

      sfx.started = true;

      // Kick off a repeating chant every ~14s with a slow pulse in-between.
      const loop = () => {
        if (!sfx.enabled || !sfx.ctx) return;
        const t = sfx.ctx.currentTime + 0.05;
        scheduleChant(t);
        // Subtle crowd swell along with the chant.
        sfx.crowdGain.gain.cancelScheduledValues(t);
        sfx.crowdGain.gain.setValueAtTime(0.18, t);
        sfx.crowdGain.gain.linearRampToValueAtTime(0.34, t + 0.9);
        sfx.crowdGain.gain.linearRampToValueAtTime(0.18, t + 2.4);
        sfx._chantTimer = setTimeout(loop, 12000 + Math.random() * 4000);
      };
      loop();
    } catch (e) {
      sfx.enabled = false;
    }
  };

  sfx.cheerBurst = function (intensity) {
    if (!sfx.started || !sfx.ctx) return;
    const amp = Math.max(0.3, Math.min(1.2, intensity || 0.8));
    const t = sfx.ctx.currentTime;
    sfx.crowdGain.gain.cancelScheduledValues(t);
    sfx.crowdGain.gain.setValueAtTime(sfx.crowdGain.gain.value, t);
    sfx.crowdGain.gain.linearRampToValueAtTime(0.55 * amp, t + 0.2);
    sfx.crowdGain.gain.linearRampToValueAtTime(0.18, t + 2.0);
    // Quick vocal stack to sell the cheer.
    for (let i = 0; i < 4; i++) vocalHit(t + i * 0.06, i - 2, 0.35, 0.5 * amp);
  };

  sfx.setEnabled = function (on) {
    sfx.enabled = !!on;
    if (!sfx.enabled && sfx.master) sfx.master.gain.value = 0;
    else if (sfx.master) sfx.master.gain.value = 0.55;
  };
})(window.FB);
