/**
 * Synthesized sound (no assets): the hum of the sea and the engine, our
 * ping with its long ringing tail, their pings (panned to where they are),
 * charges, blasts, the hull scraping, and cues for surveys and sectors.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineGain!: GainNode;
  private engineOsc!: OscillatorNode;
  private flowGain!: GainNode;
  private echoIn!: GainNode;
  private muted = false;
  private tickT = 0;

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
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 6;
    }
    // deep-water rumble
    const sea = ctx.createBufferSource();
    sea.buffer = this.noise;
    sea.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    const seaGain = ctx.createGain();
    seaGain.gain.value = 0.16;
    sea.connect(lp).connect(seaGain).connect(this.master);
    sea.start();
    // engine: a low buzz, and water flowing past the hull
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 34;
    const elp = ctx.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 140;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(elp).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    const flow = ctx.createBufferSource();
    flow.buffer = this.noise;
    flow.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    this.flowGain = ctx.createGain();
    this.flowGain.gain.value = 0;
    flow.connect(bp).connect(this.flowGain).connect(this.master);
    flow.start(0, 0.7);
    // a feedback delay: the ringing of the sea after a ping
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 1800;
    this.echoIn.connect(delay);
    delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(this.master);
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

  /** Call every frame with the throttle step (0..3) and speed; 0 silences it. */
  engine(level: number, speed: number, on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? [0.0, 0.05, 0.09, 0.14][level] : 0, t, 0.3);
    this.engineOsc.frequency.setTargetAtTime(30 + level * 9, t, 0.5);
    this.flowGain.gain.setTargetAtTime(on ? Math.min(0.12, Math.abs(speed) * 0.014) : 0, t, 0.3);
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', delay = 0, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private tone(freq: number, dur: number, gain: number, o: { type?: OscillatorType; delay?: number; slide?: number; pan?: number; echo?: boolean; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide && o.slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * o.slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    osc.connect(g).connect(p).connect(this.master);
    if (o.echo) p.connect(this.echoIn);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Our active sonar: a clean ping that rings on. */
  ping(cone = false): void {
    this.tone(cone ? 1760 : 1320, 1.6, 0.2, { echo: true });
    this.tone(cone ? 1765 : 1326, 1.2, 0.05, { echo: true, delay: 0.002 });
  }

  /** The faint return of our ping from the floor. */
  ret(delay: number): void {
    this.tone(1300, 0.9, 0.035, { delay, echo: true });
  }

  /** Someone else's ping; pan -1..1, closeness 0..1. */
  enemyPing(pan: number, close: number): void {
    this.tone(2240, 0.8, 0.03 + 0.12 * close, { pan, slide: 0.97, echo: true });
  }

  heard(): void {
    this.tone(220, 0.5, 0.06, { type: 'triangle', slide: 1.5 });
  }

  detected(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(988, 0.16, 0.08, { type: 'square', delay: i * 0.26 });
      this.tone(740, 0.16, 0.08, { type: 'square', delay: i * 0.26 + 0.13 });
    }
  }

  splash(pan: number): void {
    this.burst(2400, 0.7, 0.35, 0.12, 'highpass', 0, pan);
  }

  blast(close: number, pan: number): void {
    const g = 0.12 + close * 0.6;
    this.tone(55, 1.6, g, { slide: 0.5, pan, attack: 0.01 });
    this.burst(260, 0.6, 1.4 + close, g * 0.8, 'lowpass', 0, pan);
    this.burst(90, 1.2, 2.5, g * 0.5, 'lowpass', 0.25, pan);
  }

  impact(v: number): void {
    const g = Math.min(0.5, 0.1 + v * 0.05);
    this.burst(180, 0.8, 0.6, g, 'lowpass');
    this.tone(90, 0.9, g * 0.5, { type: 'triangle', slide: 0.7 });
  }

  /** Close to the floor: ticks that quicken. Call every frame with clearance (m). */
  proximity(clear: number, dt: number): void {
    if (!this.ctx || clear > 12) {
      this.tickT = 0;
      return;
    }
    this.tickT += dt;
    const every = 0.12 + (clear / 12) * 0.6;
    if (this.tickT > every) {
      this.tickT = 0;
      this.tone(3200, 0.03, 0.03, { type: 'square' });
    }
  }

  creak(): void {
    this.tone(70 + Math.random() * 30, 1.4, 0.05, { type: 'sawtooth', slide: 0.8, attack: 0.3 });
  }

  survey(): void {
    [0, 7, 12].forEach((n, i) => this.tone(880 * Math.pow(2, n / 12), 1.1, 0.07, { delay: i * 0.09, echo: true }));
  }

  cleared(): void {
    [12, 7, 3, 0, -5].forEach((n, i) => this.tone(440 * Math.pow(2, n / 12), 2.2, 0.08, { delay: i * 0.18, echo: true }));
  }

  crushed(): void {
    this.tone(60, 3.5, 0.3, { type: 'sawtooth', slide: 0.4, attack: 0.05 });
    this.burst(120, 0.5, 3.5, 0.4, 'lowpass');
  }

  ui(): void {
    this.tone(1760, 0.14, 0.05);
  }
}
