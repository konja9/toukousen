/**
 * Synthesized sound (no assets): wind, footsteps, a heartbeat that quickens as
 * the alert rises, the electronic punch beep, and cues for being spotted and
 * finishing.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private beatT = 0;

  get isMuted(): boolean {
    return this.muted;
  }

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
      b = 0.96 * b + 0.04 * (Math.random() * 2 - 1);
      d[i] = b * 5;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(lp).connect(this.windGain).connect(this.master);
    wind.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private burst(freq: number, q: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, slide = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  step(kind: 'run' | 'sprint' | 'crouch'): void {
    const gain = kind === 'sprint' ? 0.16 : kind === 'crouch' ? 0.04 : 0.09;
    this.burst(kind === 'crouch' ? 500 : 800 + Math.random() * 300, 1.4, 0.09, gain);
  }

  /** Call every frame with the alert level (0..1). */
  heartbeat(alert: number, dt: number): void {
    if (!this.ctx || alert < 0.12) {
      this.beatT = 0;
      return;
    }
    const bpm = 70 + alert * 90;
    this.beatT += dt;
    if (this.beatT > 60 / bpm) {
      this.beatT = 0;
      this.tone(58, 0.16, 0.22 * alert + 0.05, 'sine', 0, 0.7);
      this.tone(52, 0.14, 0.14 * alert + 0.03, 'sine', 0.14, 0.7);
    }
  }

  punch(): void {
    this.tone(2900, 0.09, 0.07, 'square');
    this.tone(2900, 0.09, 0.07, 'square', 0.13);
  }

  spotted(): void {
    this.tone(880, 0.5, 0.12, 'sawtooth', 0, 0.5);
    this.burst(300, 0.8, 0.8, 0.2);
  }

  finish(): void {
    [0, 5, 9, 12, 17].forEach((n, i) => this.tone(523.25 * Math.pow(2, n / 12), 1.2, 0.1, 'sine', i * 0.08));
  }

  ui(): void {
    this.tone(1760, 0.14, 0.05);
  }
}
