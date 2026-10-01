/**
 * Minimal synthesized sound (no assets): wind that follows airspeed, a shimmer
 * inside thermals, a variometer for rising and sinking air, pings for gates and
 * checkpoints, the clock's last seconds, a near-miss whoosh and an impact.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rushGain!: GainNode;
  private shimmerGain!: GainNode;
  private noise!: AudioBuffer;
  private sinkGain!: GainNode;
  private muted = false;
  private lastTick = 0;
  private nextBeep = 0;

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
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a speed-controlled low-pass.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Ground rush: band-passed noise that grows when flying low.
    const rush = ctx.createBufferSource();
    rush.buffer = this.noise;
    rush.loop = true;
    rush.playbackRate.value = 0.8;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0;
    rush.connect(bp).connect(this.rushGain).connect(this.master);
    rush.start();

    // Thermal shimmer: two slightly detuned sines with tremolo.
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.5;
    lfo.connect(lfoAmt).connect(trem.gain);
    lfo.start();
    for (const f of [659.25, 663.1, 987.8]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(trem);
      o.start();
    }
    trem.connect(this.shimmerGain).connect(this.master);

    // Variometer sink tone: a low, slightly buzzing hum that swells in sinking air.
    this.sinkGain = ctx.createGain();
    this.sinkGain.gain.value = 0;
    const sinkFilter = ctx.createBiquadFilter();
    sinkFilter.type = 'lowpass';
    sinkFilter.frequency.value = 600;
    for (const f of [196, 197.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(sinkFilter);
      o.start();
    }
    sinkFilter.connect(this.sinkGain).connect(this.master);
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

  /**
   * Continuous parameters, called every frame while flying (or with zeros to fade out).
   * `air` is the vertical speed of the air mass (thermals + ridge lift) for the variometer.
   */
  flight(speed: number, lowness: number, lift: number, air = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = Math.min(Math.max((speed - 15) / 110, 0), 1);
    this.windFilter.frequency.setTargetAtTime(250 + s * s * 2600, t, 0.1);
    this.windGain.gain.setTargetAtTime(speed > 0 ? 0.05 + s * 0.22 : 0, t, 0.15);
    this.rushGain.gain.setTargetAtTime(lowness * 0.12 * (0.4 + s), t, 0.1);
    this.shimmerGain.gain.setTargetAtTime(Math.min(lift / 15, 1) * 0.035, t, 0.2);
    this.vario(speed > 0 ? air : 0);
  }

  /** Beeps that get higher and quicker in rising air; a low hum in sinking air. */
  private vario(air: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.sinkGain.gain.setTargetAtTime(air < -1.2 ? Math.min((-air - 1.2) / 4, 1) * 0.03 : 0, t, 0.15);
    if (air < 0.5) {
      this.nextBeep = Math.min(this.nextBeep, t + 0.05);
      return;
    }
    if (t < this.nextBeep) return;
    const period = Math.max(0.11, 0.42 - air * 0.035);
    this.tone(560 + Math.min(air, 12) * 70, period * 0.55, 0.035, 'triangle');
    this.nextBeep = t + period;
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
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  gate(chain: number): void {
    const f = 880 * Math.pow(2, (Math.min(chain, 12) * 2) / 12);
    this.tone(f, 0.7, 0.16);
    this.tone(f * 1.5, 0.5, 0.06, 'sine', 0.06);
  }

  miss(): void {
    this.tone(220, 0.35, 0.08, 'triangle');
  }

  warn(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastTick < 0.22) return;
    this.lastTick = ctx.currentTime;
    this.tone(1320, 0.06, 0.05, 'square');
  }

  /** Crossing a checkpoint: a rising pair. */
  checkpoint(): void {
    this.tone(1046.5, 0.5, 0.12);
    this.tone(1568, 0.7, 0.1, 'sine', 0.09);
    this.tone(2093, 0.6, 0.04, 'sine', 0.18);
  }

  /** One of the clock's last seconds. */
  tick(seconds: number): void {
    this.tone(seconds <= 3 ? 1975 : 1480, 0.07, 0.07, 'square');
  }

  timeUp(): void {
    [880, 659.25, 440, 329.6].forEach((f, i) => this.tone(f, 0.45, 0.1, 'triangle', i * 0.13));
  }

  /** A mission completed: a bright major arpeggio. */
  mission(): void {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(f, 0.6, 0.07, 'sine', i * 0.07));
  }

  /** Air rushing past terrain on one side (-1 left, 1 right). */
  nearMiss(side: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.8;
    src.connect(bp).connect(g).connect(pan).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.55);
  }

  ui(): void {
    this.tone(1760, 0.18, 0.06);
  }

  crash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.7);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.9);
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 1.1);
  }
}
