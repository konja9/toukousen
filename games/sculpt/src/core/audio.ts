/**
 * Synthesized sound (no assets): earth moving under the brush, the ball
 * rolling, a chime for holing out and a low tone for failures.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private brushGain!: GainNode;
  private brushFilter!: BiquadFilterNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private muted = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // slightly brown noise: softer, more like soil than hiss
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 6;
    }

    const loop = (filter: BiquadFilterNode, gain: GainNode, rate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
    };
    this.brushFilter = ctx.createBiquadFilter();
    this.brushFilter.type = 'bandpass';
    this.brushFilter.Q.value = 0.8;
    this.brushGain = ctx.createGain();
    this.brushGain.gain.value = 0;
    loop(this.brushFilter, this.brushGain, 1);

    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 300;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    loop(this.rollFilter, this.rollGain, 0.7);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** mode: 0 idle, 1 raise, 2 cut */
  brush(mode: 0 | 1 | 2): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.brushGain.gain.setTargetAtTime(mode ? 0.22 : 0, t, 0.04);
    this.brushFilter.frequency.setTargetAtTime(mode === 2 ? 1400 : 520, t, 0.05);
  }

  roll(speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed / 8, 1);
    this.rollGain.gain.setTargetAtTime(s * 0.35, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(180 + s * 700, t, 0.08);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  holed(): void {
    [0, 4, 7, 12].forEach((n, i) => this.tone(659.25 * Math.pow(2, n / 12), 1.1, 0.12, 'sine', i * 0.09));
  }

  checkpoint(): void {
    this.tone(1318.5, 0.5, 0.08);
  }

  fail(): void {
    this.tone(196, 0.6, 0.12, 'triangle');
    this.tone(146.8, 0.9, 0.1, 'triangle', 0.12);
  }

  ui(): void {
    this.tone(1760, 0.15, 0.05);
  }
}
