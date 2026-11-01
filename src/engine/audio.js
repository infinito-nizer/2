// ============================================================
// Fully procedural WebAudio SFX — zero audio assets
// ============================================================
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuf = null;
    this._ambient = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // pre-baked noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.startAmbient();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  _t() {
    return this.ctx.currentTime;
  }

  _noise(dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  _env(node, t0, attack, decay, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  /** Gunshot: filtered noise crack + low body thump. */
  shot(kind = 'rifle', dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const vol = Math.max(0.05, 1 - dist / 220) * (kind === 'sniper' ? 1.15 : 1);

    const src = this._noise(0.3);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const cut = kind === 'sniper' ? 2400 : kind === 'shotgun' ? 1700 : 4200;
    lp.frequency.setValueAtTime(cut, t0);
    lp.frequency.exponentialRampToValueAtTime(320, t0 + 0.16);
    src.connect(lp);
    this._env(lp, t0, 0.002, kind === 'sniper' ? 0.34 : 0.16, 0.55 * vol);
    src.start(t0);
    src.stop(t0 + 0.5);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kind === 'sniper' ? 150 : 190, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.14);
    this._env(osc, t0, 0.002, 0.16, 0.5 * vol);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }

  hitmarker(crit = false) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(crit ? 1500 : 1150, t0);
    osc.frequency.exponentialRampToValueAtTime(crit ? 900 : 700, t0 + 0.05);
    this._env(osc, t0, 0.001, 0.06, 0.09);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  impact() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const src = this._noise(0.1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 900;
    bp.Q.value = 1.2;
    src.connect(bp);
    this._env(bp, t0, 0.001, 0.09, 0.16);
    src.start(t0);
    src.stop(t0 + 0.15);
  }

  click(freq = 420, vol = 0.14, dur = 0.05) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    this._env(osc, t0, 0.001, dur, vol);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  reload() {
    if (!this.ctx || !this.enabled) return;
    this.click(320, 0.16, 0.04);
    setTimeout(() => this.click(220, 0.14, 0.05), 220);
    setTimeout(() => this.click(520, 0.13, 0.04), 520);
  }

  pickup() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, t0);
    osc.frequency.linearRampToValueAtTime(980, t0 + 0.09);
    this._env(osc, t0, 0.004, 0.14, 0.1);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  }

  heal() {
    if (!this.ctx || !this.enabled) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.click(500 + i * 180, 0.09, 0.08), i * 110);
    }
  }

  hurt() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.2);
    this._env(osc, t0, 0.004, 0.22, 0.16);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  }

  footstep() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const src = this._noise(0.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + Math.random() * 300;
    src.connect(lp);
    this._env(lp, t0, 0.002, 0.09, 0.07);
    src.start(t0);
    src.stop(t0 + 0.14);
  }

  explosion(dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._t();
    const v = Math.max(0.08, 1 - dist / 300);
    const src = this._noise(1.2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + 0.9);
    src.connect(lp);
    this._env(lp, t0, 0.005, 1.1, 0.6 * v);
    src.start(t0);
    src.stop(t0 + 1.3);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.6);
    this._env(osc, t0, 0.004, 0.7, 0.55 * v);
    osc.start(t0);
    osc.stop(t0 + 0.9);
  }

  startAmbient() {
    if (!this.ctx || this._ambient) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    src.connect(lp).connect(hp).connect(g).connect(this.master);
    src.start();
    this._ambient = { src, g };
  }
}

export const audio = new AudioEngine();
