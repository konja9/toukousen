import { ColorManagement, Fog, LinearSRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import { FLIGHT } from '../config';
import { Audio } from '../core/audio';
import { Input, type Action } from '../core/input';
import { load, save } from '../core/storage';
import { clamp01, damp, easeInOutCubic, easeOutCubic, lerp } from '../core/tween';
import { CameraRig, topDownPose, type Pose } from '../camera/cameraRig';
import { Glider } from '../player/glider';
import { GliderView } from '../player/gliderView';
import { Hud, type MissionLine, type PathPoint } from '../ui/hud';
import { Screens, deltaText, splitText, type MissionView } from '../ui/screens';
import { Airflow } from '../world/airflow';
import { Checkpoints } from '../world/checkpoints';
import { Gates } from '../world/gates';
import { PATTERN_LABEL, Sectors, windName } from '../world/sectors';
import { Wind } from '../world/wind';
import { MapView, type MapFrame } from '../world/mapView';
import { Terrain } from '../world/terrain';
import { TerrainField, seedVector } from '../world/terrainField';
import { Thermals } from '../world/thermals';
import { shared } from '../world/uniforms';
import { MissionTracker, SKIM_AGL, countMedals, missionsFor, type RunStats } from './missions';
import { NearMiss, RunClock, type ClockEvent } from './run';
import { ScoreKeeper } from './score';

ColorManagement.enabled = false;

type State = 'title' | 'intro' | 'play' | 'crash' | 'result';

const THEMES = {
  dark: { bg: 0x0b0b0b, ink: 0xecebe6 },
  paper: { bg: 0xefede6, ink: 0x141414 },
} as const;
type ThemeName = keyof typeof THEMES;

const TITLE_HEIGHT = 2000;
const TITLE_FOV = 34;
const FLIGHT_FOG = 1150;
const NO_FOG = 1e5;
const LIFT_HEIGHT = 1400;
const LIFT_FOV = 40;

const randomSheet = () => 1 + Math.floor(Math.random() * 9999);

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly terrain = new Terrain();
  private readonly map = new MapView();
  private readonly thermals = new Thermals();
  private readonly gates = new Gates();
  private readonly glider = new Glider();
  private readonly view = new GliderView();
  private readonly airflow = new Airflow();
  private readonly checkpoints = new Checkpoints();
  private readonly input = new Input();
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly screens: Screens;

  private field!: TerrainField;
  private sectors!: Sectors;
  private wind!: Wind;
  private sheet = randomSheet();
  private state: State = 'title';
  private paused = false;
  private best = load<number>('best', 0);
  /** Sheet -> bits of the missions completed there. */
  private medals = load<Record<string, number>>('medals', {});
  /** Sheet -> best time of each sector. */
  private bestSplits = load<Record<string, number[]>>('splits', {});
  private theme: ThemeName = load<ThemeName>('theme', 'dark');

  private score = new ScoreKeeper();
  private run = new RunClock();
  private near = new NearMiss();
  private missions = new MissionTracker(missionsFor(1));
  private endCause: 'crash' | 'timeup' = 'crash';
  /** Ridge lift at the glider, and the vertical speed of the air (thermals + ridge). */
  private ridge = 0;
  private air = 0;
  private airShown = 0;
  private ridgeGain = 0;
  private skimRun = 0;
  private skimBest = 0;
  private lastAdded = 0;
  private lastAddedAt = -10;
  /** Sector times of this sheet before this run (for the differences). */
  private splitsBefore: number[] = [];
  private doneAtStart = 0;
  private startZ = 0;
  private acc = 0;
  private time = 0;
  private stateTime = 0;
  private timeScale = 1;
  private hudReveal = 0;
  private titleX = 0;
  private titleZ = 0;
  private revealT = 0;
  private revealCenter = new Vector3();
  private readonly pose: Pose = { pos: new Vector3(), quat: topDownPose(0, 0, 1, 1).quat.clone(), fov: 60 };
  private lift = 0;
  private terrainWarn = false;
  private path: PathPoint[] = [];
  private passedGates: PathPoint[] = [];
  private pathTimer = 0;
  private crashPos = new Vector3();
  private crashEye = new Vector3();
  private mapOpacity = 0;
  private mapFrom = { cx: 0, cz: 0, mpp: 1 };
  private mapTo = { cx: 0, cz: 0, mpp: 1 };
  private newBest = false;
  private mouse: [number, number] | null = null;
  private probeAlpha = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private perfFrames = 0;
  private perfTime = 0;
  private readonly clock = { last: performance.now() };

  constructor(root: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    root.appendChild(this.renderer.domElement);
    this.hud = new Hud(root);
    this.screens = new Screens(document.body);

    this.rig = new CameraRig(1);
    this.scene.fog = new Fog(0x000000, 400, 1700);
    this.scene.add(this.terrain.mesh, this.thermals.group, this.gates.group, this.checkpoints.group, this.view.root);
    this.scene.add(this.airflow.object);

    this.input.invertPitch = load<boolean>('invertPitch', false);
    this.audio.setMuted(load<boolean>('muted', false));
    this.applyTheme(this.theme);

    this.input.onAction((a) => this.onAction(a));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => (this.mouse = [e.clientX, e.clientY]));
    // A click also starts (and gives an embedding frame keyboard focus).
    window.addEventListener('pointerdown', () => {
      if (this.state === 'title' && this.revealT > 0.5) this.onAction('start');
    });
    document.addEventListener('mouseleave', () => (this.mouse = null));
    const autoPause = () => {
      if ((this.state === 'play' || this.state === 'intro') && !this.paused) this.togglePause();
    };
    document.addEventListener('visibilitychange', () => document.hidden && autoPause());
    window.addEventListener('blur', autoPause);
    this.resize();
    this.enterTitle(this.sheet);
  }

  /** Compile shaders behind the loading screen, then start the loop. */
  start(): void {
    this.rig.apply(this.pose, 0);
    this.renderer.compile(this.scene, this.rig.camera);
    requestAnimationFrame(() => {
      this.screens.hideLoading();
      this.showTitle();
      this.clock.last = performance.now();
      this.revealT = 0;
      this.loop();
    });
  }

  // ------------------------------------------------------------------ setup

  private setSheet(sheet: number): void {
    this.sheet = sheet;
    const seed = seedVector(sheet);
    shared.uSeed.value.set(seed[0], seed[1]);
    this.field = new TerrainField(seed);
    this.thermals.reset(this.field, sheet, 0);
    this.setCourse(0);
  }

  /** Sectors (wind, gate layouts) and checkpoints measured from the start at z0. */
  private setCourse(z0: number): void {
    this.sectors = new Sectors(this.field, this.sheet, z0);
    this.wind = new Wind(this.field, this.sectors);
    this.gates.reset(this.field, this.sheet, z0, this.sectors);
    this.checkpoints.reset(this.field, z0);
  }

  private showTitle(): void {
    const done = this.medals[this.sheet] ?? 0;
    this.screens.showTitle({
      sheet: this.sheet,
      best: this.best,
      missions: missionsFor(this.sheet).map((m, i) => ({ label: m.label, done: !!(done & (1 << i)) })),
      medals: countMedals(this.medals),
    });
  }

  private stats(): RunStats {
    const s = this.score;
    return {
      distance: s.distance,
      skimBest: this.skimBest,
      bestChain: s.bestChain,
      ridgeGain: this.ridgeGain,
      maxSpeed: s.maxSpeed,
      sectors: this.run.sector,
      nearMisses: s.nearMisses,
      score: s.score,
    };
  }

  private missionViews(): MissionView[] {
    const t = this.missions;
    return t.missions.map((m, i) => ({ label: m.label, done: !!(t.done & (1 << i)), fresh: !!(t.fresh & (1 << i)) && !(this.doneAtStart & (1 << i)) }));
  }

  private applyTheme(name: ThemeName): void {
    this.theme = name;
    const t = THEMES[name];
    shared.uBg.value.set(t.bg);
    shared.uInk.value.set(t.ink);
    (this.scene.fog as Fog).color.set(t.bg);
    this.renderer.setClearColor(t.bg);
    this.view.setColors();
    this.gates.setColor();
    this.hud.syncColors();
    document.documentElement.dataset.theme = name;
  }

  private resize(): void {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.applySize();
  }

  private applySize(): void {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h);
    this.hud.resize(this.w, this.h, Math.min(window.devicePixelRatio || 1, 2));
    this.rig.resize(this.w / this.h);
  }

  // ------------------------------------------------------------------ states

  private enterTitle(sheet: number): void {
    this.setSheet(sheet);
    this.state = 'title';
    this.stateTime = 0;
    this.titleZ = 0;
    this.titleX = this.field.valleyCenter(0);
    this.view.reset();
    this.view.root.visible = false;
    this.hudReveal = 0;
    this.revealT = 0;
    this.revealCenter.set(this.titleX, 0, this.titleZ);
    shared.uFogDist.value = NO_FOG;
    const p = topDownPose(this.titleX, this.titleZ, TITLE_HEIGHT, TITLE_FOV);
    this.pose.pos.copy(p.pos);
    this.pose.quat.copy(p.quat);
    this.pose.fov = p.fov;
    this.rig.apply(this.pose, 0);
  }

  /** Start a run on `sheet` from wherever the camera currently is. */
  private beginRun(sheet: number, fromMap: boolean): void {
    this.audio.init();
    this.audio.ui();
    if (sheet !== this.sheet || fromMap) {
      this.setSheet(sheet);
      this.titleZ = 0;
      this.titleX = this.field.valleyCenter(0);
      // Jump to the top-down view of the new sheet and replay the draw-in.
      const p = topDownPose(this.titleX, this.titleZ, TITLE_HEIGHT, TITLE_FOV);
      this.pose.pos.copy(p.pos);
      this.pose.quat.copy(p.quat);
      this.pose.fov = p.fov;
      this.rig.apply(this.pose, 0);
      shared.uFogDist.value = NO_FOG;
      this.revealT = 0;
      this.revealCenter.set(this.titleX, 0, this.titleZ);
    }
    const z0 = this.titleZ;
    const x0 = this.field.valleyCenter(z0);
    const y0 = this.field.heightAt(x0, z0) + FLIGHT.startAGL;
    this.glider.reset(x0, y0, z0, this.field.valleyHeading(z0));
    this.startZ = z0;
    this.setCourse(z0);
    this.score = new ScoreKeeper();
    this.run = new RunClock();
    this.near = new NearMiss();
    this.doneAtStart = this.medals[sheet] ?? 0;
    this.missions = new MissionTracker(missionsFor(sheet), this.doneAtStart);
    this.splitsBefore = [...(this.bestSplits[sheet] ?? [])];
    this.endCause = 'crash';
    this.ridge = 0;
    this.air = 0;
    this.airShown = 0;
    this.ridgeGain = 0;
    this.skimRun = 0;
    this.skimBest = 0;
    this.lastAdded = 0;
    this.lastAddedAt = -10;
    this.hud.clearNotices();
    this.path = [{ x: x0, z: z0 }];
    this.passedGates = [];
    this.pathTimer = 0;
    this.acc = 0;
    this.timeScale = 1;
    this.hudReveal = 0;
    this.newBest = false;
    this.view.reset();
    this.view.root.visible = true;
    this.rig.resetChase();
    this.rig.blend(2.8);
    this.state = 'intro';
    this.stateTime = 0;
    this.screens.hideTitle();
    this.screens.hideResult();
  }

  /** The run is over: hit the ground, or the clock ran out. */
  private endRun(cause: 'crash' | 'timeup'): void {
    this.state = 'crash';
    this.endCause = cause;
    this.stateTime = 0;
    this.timeScale = 0.12;
    this.crashPos.set(this.glider.x, this.glider.y, this.glider.z);
    this.crashEye.copy(this.rig.camera.position);
    this.mapOpacity = 0;
    this.audio.flight(0, 0, 0);
    if (cause === 'crash') {
      this.view.shatter(this.glider);
      this.audio.crash();
      this.screens.invertFlash();
    } else {
      this.audio.timeUp();
      this.hud.clearNotices();
    }
    this.path.push({ x: this.glider.x, z: this.glider.z });
    const final = Math.floor(this.score.score);
    if (final > this.best) {
      this.best = final;
      this.newBest = true;
      save('best', final);
    }
  }

  private enterResult(): void {
    this.state = 'result';
    this.stateTime = 0;
    const s = this.score;
    const before = this.splitsBefore;
    this.screens.showResult({
      cause: this.endCause,
      sectors: this.run.sector,
      nearMisses: s.nearMisses,
      missions: this.missionViews(),
      splits: this.run.splits.map((t, i) => ({ time: t, delta: before[i] !== undefined ? t - before[i] : null })),
      sheet: this.sheet,
      score: Math.floor(s.score),
      best: this.newBest,
      distance: s.distance,
      time: s.time,
      maxSpeed: s.maxSpeed,
      minAGL: s.minAGL,
      gatesPassed: s.gatesPassed,
      gatesTotal: s.gatesTotal,
      bestChain: s.bestChain,
    });

    // Map zoom: from the 3D lift view scale to a frame that fits the whole path.
    const ground = this.field.heightAt(this.crashPos.x, this.crashPos.z);
    const mppStart = ((LIFT_HEIGHT - ground) * Math.tan(((LIFT_FOV / 2) * Math.PI) / 180)) / (this.h / 2);
    this.mapFrom = { cx: this.crashPos.x, cz: this.crashPos.z, mpp: mppStart };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const wide = this.w > 760;
    const regionL = wide ? Math.min(this.w * 0.42, 560) : 0;
    const regionW = this.w - regionL;
    const mpp = Math.max((maxX - minX + 400) / (regionW * 0.8), (maxZ - minZ + 400) / (this.h * 0.8), 1.2);
    const regionCx = regionL + regionW / 2;
    this.mapTo = { cx: (minX + maxX) / 2 - (regionCx - this.w / 2) * mpp, cz: (minZ + maxZ) / 2, mpp };
  }

  private togglePause(): void {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.paused = !this.paused;
    this.screens.showPause(this.paused);
    if (this.paused) this.audio.suspend();
    else {
      this.audio.resume();
      this.clock.last = performance.now();
    }
  }

  private onAction(a: Action): void {
    switch (a) {
      case 'start':
        if (this.state === 'title') this.beginRun(this.sheet, false);
        else if (this.state === 'result' && this.stateTime > 0.8) this.beginRun(randomSheet(), true);
        break;
      case 'retry':
        if (this.state === 'result' && this.stateTime > 0.8) this.beginRun(this.sheet, true);
        else if (this.paused) {
          this.paused = false;
          this.screens.showPause(false);
          this.audio.resume();
          this.beginRun(this.sheet, true);
        }
        break;
      case 'pause':
        if (this.state === 'play' || this.state === 'intro') this.togglePause();
        else if (this.state === 'result') this.toTitle();
        break;
      case 'title':
        if (this.paused || this.state === 'result') this.toTitle();
        break;
      case 'mute':
        this.audio.setMuted(!this.audio.isMuted);
        save('muted', this.audio.isMuted);
        this.screens.toast(this.audio.isMuted ? 'SOUND OFF' : 'SOUND ON');
        break;
      case 'theme':
        this.applyTheme(this.theme === 'dark' ? 'paper' : 'dark');
        save('theme', this.theme);
        this.screens.toast(this.theme === 'dark' ? 'NIGHT' : 'PAPER');
        break;
      case 'prev':
      case 'next':
        if (this.state === 'title' && this.revealT > 0.4) {
          const n = this.sheet + (a === 'next' ? 1 : -1);
          this.audio.init();
          this.audio.ui();
          this.enterTitle(((n - 1 + 9999) % 9999) + 1);
          this.showTitle();
        }
        break;
      case 'invert':
        this.input.invertPitch = !this.input.invertPitch;
        save('invertPitch', this.input.invertPitch);
        this.screens.toast(this.input.invertPitch ? 'PITCH: INVERTED (↑ = DIVE)' : 'PITCH: NORMAL (↑ = CLIMB)');
        break;
    }
  }

  private toTitle(): void {
    if (this.paused) {
      this.paused = false;
      this.screens.showPause(false);
      this.audio.resume();
    }
    this.audio.flight(0, 0, 0);
    this.screens.hideResult();
    this.mapOpacity = 0;
    this.enterTitle(this.sheet);
    this.showTitle();
  }

  // ------------------------------------------------------------------ loop

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const realDt = Math.min((now - this.clock.last) / 1000, 1 / 20);
    this.clock.last = now;
    if (!this.paused) this.update(realDt);
    this.render();
  };

  /** Drop render resolution in steps while the frame rate is poor (the terrain shader is fill-bound). */
  private adaptResolution(realDt: number): void {
    this.perfFrames++;
    this.perfTime += realDt;
    if (this.perfTime < 2) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfFrames = 0;
    this.perfTime = 0;
    if (fps < 45 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.applySize();
    }
  }

  private update(realDt: number): void {
    this.adaptResolution(realDt);
    if (this.state === 'crash') this.timeScale = lerp(this.timeScale, 1, damp(1.1, realDt));
    const dt = realDt * this.timeScale;
    this.time += dt;
    this.stateTime += realDt;
    shared.uTime.value = this.time;
    this.revealT += realDt;
    this.hud.updatePops(realDt);

    // draw-in wipe of the contour lines
    shared.uRevealCenter.value.set(this.revealCenter.x, this.revealCenter.z);
    shared.uReveal.value = this.revealT < 3.2 ? easeOutCubic(this.revealT / 3.2) * 3200 : 1e6;

    switch (this.state) {
      case 'title':
        this.updateTitle(realDt);
        break;
      case 'intro':
      case 'play':
        this.updateFlight(dt, realDt);
        break;
      case 'crash':
        this.updateCrash(dt, realDt);
        break;
      case 'result':
        this.updateResult(realDt);
        break;
    }
  }

  private updateTitle(dt: number): void {
    this.titleZ -= 9 * dt;
    const p = topDownPose(this.titleX, this.titleZ, TITLE_HEIGHT, TITLE_FOV);
    this.pose.pos.copy(p.pos);
    this.pose.quat.copy(p.quat);
    this.pose.fov = p.fov;
    this.rig.apply(this.pose, dt);
    this.terrain.follow(this.titleX, this.titleZ);
    this.thermals.update(this.titleZ);
    // A sweeping altitude line demonstrates how the contours are read.
    shared.uAlt.value = 45 + 190 * (0.5 - 0.5 * Math.cos(this.stateTime * 0.42));
    shared.uAltLine.value = 0.9 * clamp01((this.revealT - 1.5) / 1.5);
    shared.uInkGain.value = 0.58;
    shared.uHatch.value = 0.4;
    this.audio.flight(0, 0, 0);
    this.airflow.update(this.rig.camera.position, 0, 0, 0);
  }

  private updateFlight(dt: number, realDt: number): void {
    const g = this.glider;
    const f = this.field;
    const controls = this.state === 'play' || this.rig.blendProgress > 0.7;
    const input = controls
      ? { pitch: this.input.pitch, roll: this.input.roll, brake: this.input.brake }
      : { pitch: 0, roll: 0, brake: false };

    // fixed-step simulation
    const h = 1 / FLIGHT.stepHz;
    this.acc += dt;
    let crashed = false;
    const live = this.state === 'play';
    const x0 = g.x;
    const z0 = g.z;
    while (this.acc >= h && !crashed) {
      this.acc -= h;
      const ax = g.x, ay = g.y, az = g.z;
      this.lift = this.thermals.liftAt(g);
      this.ridge = this.wind.verticalAt(g.x, g.y, g.z);
      g.step(h, input, this.lift + this.ridge);
      if (live) {
        if (this.ridge > 0) this.ridgeGain += this.ridge * h;
        const side = this.near.update(h, g, this.heightAt);
        if (side) {
          const pts = this.score.nearMiss();
          this.hud.pop(`+${pts}`, 'NEAR MISS');
          this.audio.nearMiss(side);
          this.rig.impulse(0.9);
        }
      }
      for (const { gate, passed } of this.gates.cross(ax, ay, az, g.x, g.y, g.z)) {
        const bonus = this.score.gate(passed);
        if (passed) {
          g.addSpeed(6);
          this.rig.kick(7);
          this.audio.gate(this.score.chain);
          this.hud.pop(`+${bonus}`, `GATE · CHAIN ×${this.score.chain}`);
          this.passedGates.push({ x: gate.x, z: gate.z });
        } else {
          this.audio.miss();
          if (this.score.gatesPassed > 0 || this.score.gatesTotal > 1) this.hud.pop('MISS', 'CHAIN RESET');
        }
      }
      if (g.y < f.heightAt(g.x, g.z) + FLIGHT.crashClearance) crashed = true;
    }

    const ground = f.heightAt(g.x, g.z);
    const agl = g.y - ground;
    this.air = this.lift + this.ridge;
    this.airShown = lerp(this.airShown, this.air, damp(6, realDt));
    if (live) {
      this.score.update(dt, this.startZ - g.z, agl, g.speed);
      // longest unbroken stretch below the skim height
      this.skimRun = agl < SKIM_AGL ? this.skimRun + Math.hypot(g.x - x0, g.z - z0) : 0;
      this.skimBest = Math.max(this.skimBest, this.skimRun);
      for (const e of this.run.update(dt, this.score.distance, (p) => f.difficulty(this.startZ - p))) this.onClock(e);
      for (const i of this.missions.update(this.stats())) this.onMission(i);
    }

    // look-ahead terrain warning
    this.terrainWarn = false;
    for (const t of [0.4, 0.8, 1.2]) {
      const px = g.x + g.vx * t;
      const pz = g.z + g.vz * t;
      const py = g.y + g.vy * t;
      if (py < f.heightAt(px, pz) + 0.5) {
        this.terrainWarn = true;
        break;
      }
    }
    if (this.terrainWarn && this.state === 'play') this.audio.warn();

    // path log
    this.pathTimer += dt;
    if (this.pathTimer > 0.25) {
      this.pathTimer = 0;
      this.path.push({ x: g.x, z: g.z });
    }

    // world streaming + shared uniforms
    this.terrain.follow(g.x, g.z);
    this.thermals.update(g.z);
    this.gates.update(g.z, dt, this.time);
    this.checkpoints.update(this.run.sector, dt);
    shared.uAlt.value = g.y;
    const introT = this.rig.blendProgress;
    shared.uAltLine.value = this.state === 'intro' ? lerp(0.9, 1, introT) : 1;
    shared.uInkGain.value = this.state === 'intro' ? lerp(0.58, 1, introT) : 1;
    shared.uHatch.value = this.state === 'intro' ? lerp(0.4, 1, introT) : 1;
    shared.uFogDist.value = this.state === 'intro' ? Math.exp(lerp(Math.log(NO_FOG), Math.log(FLIGHT_FOG), introT)) : FLIGHT_FOG;

    this.view.update(g, dt);
    this.rig.setShake(agl < 12 ? (12 - agl) * 0.012 * (g.speed / 50) : 0);
    this.rig.chasePose(g, f, realDt, this.pose);
    this.rig.apply(this.pose, realDt);
    const wind = this.wind.at(g.z);
    this.airflow.update(this.rig.camera.position, wind.x, wind.z, this.state === 'intro' ? introT : 1);

    const lowness = clamp01((30 - agl) / 30);
    this.audio.flight(this.state === 'intro' ? g.speed * introT : g.speed, lowness, this.lift, live ? this.air : 0);

    if (this.state === 'intro') {
      this.hudReveal = 0;
      if (!this.rig.blending) {
        this.state = 'play';
        this.stateTime = 0;
      }
    } else {
      this.hudReveal = Math.min(1, this.hudReveal + realDt / 1.6);
    }

    if (crashed) this.endRun('crash');
    else if (this.run.timeUp && this.state === 'play') this.endRun('timeup');
  }

  private readonly heightAt = (x: number, z: number): number => this.field.heightAt(x, z);

  private onClock(e: ClockEvent): void {
    if (e.type === 'tick') {
      this.audio.tick(e.seconds);
      return;
    }
    if (e.type === 'timeup') return; // handled at the end of the frame
    // checkpoint: compare with this sheet's best sector time, then say what comes next
    const i = e.sector - 1;
    const before = this.splitsBefore[i];
    const best = this.bestSplits[this.sheet] ?? [];
    if (best[i] === undefined || e.split < best[i]) {
      best[i] = e.split;
      this.bestSplits[this.sheet] = best;
      save('splits', this.bestSplits);
    }
    this.lastAdded = e.added;
    this.lastAddedAt = this.time;
    const next = this.sectors.info(e.sector);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    this.hud.banner(`CHECKPOINT ${pad2(e.sector)}`, [
      `${splitText(e.split)}${before !== undefined ? `  (${deltaText(e.split - before)})` : ''}   +${e.added.toFixed(1)} s`,
      `SECTOR ${pad2(e.sector + 1)} · ${windName(next.dirX, next.dirZ)} ${Math.round(next.speed)} m/s · ${PATTERN_LABEL[next.pattern]}`,
    ]);
    this.audio.checkpoint();
  }

  private onMission(i: number): void {
    this.medals[this.sheet] = this.missions.done;
    save('medals', this.medals);
    this.hud.banner('課題達成', [this.missions.missions[i].label, `MEDALS ◆ ${countMedals(this.medals)}`]);
    this.audio.mission();
  }

  private updateCrash(dt: number, realDt: number): void {
    this.view.updateShards(dt);
    this.hudReveal = Math.max(0, this.hudReveal - realDt * 2.5);
    const t = this.stateTime;
    if (t < 1.6) {
      // hold position, keep looking at the impact
      this.crashEye.y += realDt * 3;
      this.rig.lookPose(this.crashEye, this.crashPos, this.rig.camera.fov, this.pose);
      this.rig.apply(this.pose, realDt);
    } else {
      if (t - realDt < 1.6) this.rig.blend(2.4);
      const p = topDownPose(this.crashPos.x, this.crashPos.z, LIFT_HEIGHT, LIFT_FOV);
      this.pose.pos.copy(p.pos);
      this.pose.quat.copy(p.quat);
      this.pose.fov = p.fov;
      this.rig.apply(this.pose, realDt);
      const k = this.rig.blendProgress;
      shared.uFogDist.value = Math.exp(lerp(Math.log(FLIGHT_FOG), Math.log(NO_FOG), k));
      shared.uAltLine.value = 1 - k;
      if (!this.rig.blending) this.enterResult();
    }
    const wind = this.wind.at(this.crashPos.z);
    this.airflow.update(this.rig.camera.position, wind.x, wind.z, Math.max(0, 1 - t * 0.6));
  }

  private updateResult(dt: number): void {
    shared.uInkGain.value = 0.85;
    this.mapOpacity = Math.min(1, this.mapOpacity + dt / 0.6);
    this.view.updateShards(dt);
  }

  private resultFrame(): MapFrame {
    const k = easeInOutCubic(clamp01((this.stateTime - 0.3) / 1.8));
    const from = this.mapFrom;
    const to = this.mapTo;
    return {
      cx: lerp(from.cx, to.cx, k),
      cz: lerp(from.cz, to.cz, k),
      mpp: Math.exp(lerp(Math.log(from.mpp), Math.log(to.mpp), k)),
      heading: 0,
      x: 0,
      y: 0,
      w: this.w,
      h: this.h,
      circle: false,
      opacity: this.mapOpacity,
      altLine: 0,
    };
  }

  private radarFrame(): MapFrame {
    const size = Math.round(Math.min(168, this.h * 0.24));
    return {
      cx: this.glider.x,
      cz: this.glider.z,
      mpp: 900 / (size / 2),
      heading: this.glider.yaw,
      x: this.w - size - 44,
      y: this.h - size - 52,
      w: size,
      h: size,
      circle: true,
      opacity: clamp01(this.hudReveal * 3 - 1.2),
      altLine: 1,
    };
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    const r = this.renderer;
    r.setViewport(0, 0, this.w, this.h);
    r.clear();

    if (this.state !== 'result' || this.mapOpacity < 1) r.render(this.scene, this.rig.camera);

    this.hud.begin();
    const now = this.time;

    if (this.state === 'result') {
      const frame = this.resultFrame();
      this.map.render(r, frame, this.h);
      const prog = clamp01((this.stateTime - 0.6) / 2.2);
      this.hud.path(frame, this.path, easeInOutCubic(prog), this.passedGates, this.mapOpacity);
      this.hud.corners(this.mapOpacity);
      this.hud.mapLegend(frame.mpp, this.mapOpacity, this.w - 60, 64);
      return;
    }

    if (this.state === 'title') {
      const a = clamp01((this.revealT - 0.6) / 1.2);
      this.hud.corners(a);
      const mpp = ((TITLE_HEIGHT - 60) * Math.tan(((TITLE_FOV / 2) * Math.PI) / 180)) / (this.h / 2);
      this.hud.mapLegend(mpp, a, this.w - 60, this.h - 70);
      this.drawProbe(a);
      return;
    }

    if (this.state === 'intro' || this.state === 'play' || this.state === 'crash') {
      if (this.hudReveal > 0) {
        const radar = this.radarFrame();
        if (radar.opacity > 0) this.map.render(r, radar, this.h);
        this.hud.flight(this.flightInfo(radar), this.hudReveal, now);
      }
      if (this.state === 'crash' && this.endCause === 'timeup') this.hud.timeUp(this.stateTime < 2.2 ? 1 : 0, this.stateTime);
      if (this.state === 'intro') {
        const a = 1 - this.rig.blendProgress * 3;
        const mpp = ((TITLE_HEIGHT - 60) * Math.tan(((TITLE_FOV / 2) * Math.PI) / 180)) / (this.h / 2);
        this.hud.mapLegend(mpp, a, this.w - 60, this.h - 70);
      }
    }
  }

  private drawProbe(alpha: number): void {
    if (!this.mouse) {
      this.probeAlpha = 0;
      return;
    }
    this.probeAlpha = Math.min(1, this.probeAlpha + 0.08);
    const [mx, my] = this.mouse;
    const cam = this.rig.camera;
    // ray from camera through the cursor, intersected with the terrain by iteration
    const ndc = new Vector3((mx / this.w) * 2 - 1, -(my / this.h) * 2 + 1, 0.5).unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    let y = 60;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 4; i++) {
      const t = (y - cam.position.y) / dir.y;
      x = cam.position.x + dir.x * t;
      z = cam.position.z + dir.z * t;
      y = this.field.heightAt(x, z);
    }
    this.hud.probe(mx, my, y, alpha * this.probeAlpha);
  }

  private flightInfo(radar: MapFrame) {
    const g = this.glider;
    const ground = this.field.heightAt(g.x, g.z);
    // flight-path marker: where the velocity vector points, 2 s ahead
    const p = new Vector3(g.x + g.vx * 2, g.y + g.vy * 2, g.z + g.vz * 2).project(this.rig.camera);
    const fpm: [number, number] | null =
      p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 ? [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h] : null;
    const pending = this.gates.list.filter((gt) => gt.state === 'pending');
    return {
      alt: g.y,
      ground,
      agl: g.y - ground,
      vy: g.vy,
      speed: g.speed,
      yaw: g.yaw,
      score: this.score.score,
      distance: this.score.distance,
      time: this.score.time,
      best: this.best,
      sheet: this.sheet,
      mult: this.state === 'play' ? this.score.mult : 1,
      chain: this.score.chain,
      lift: this.lift,
      air: this.state === 'play' ? this.airShown : 0,
      stall: g.stalled,
      terrain: this.terrainWarn && this.state === 'play',
      fpm,
      radar,
      thermals: [...this.thermals.all()].map((t) => ({ x: t.x, z: t.z, radius: t.radius })),
      gates: pending.map((gt, i) => ({ x: gt.x, z: gt.z, nx: gt.nx, nz: gt.nz, next: i === 0 })),
      x: g.x,
      z: g.z,
      clock: {
        remaining: this.run.remaining,
        sector: this.run.sector + 1,
        toNext: Math.max(0, this.run.nextCheckpoint - this.score.distance),
        added: this.lastAdded,
        addedAge: this.time - this.lastAddedAt,
      },
      wind: this.wind.at(g.z),
      cpZ: this.checkpoints.zOf(this.run.sector + 1),
      missions: this.missionLines(),
      rush: clamp01((g.speed * 3.6 - 250) / 140) + clamp01((10 - (g.y - ground)) / 10) * clamp01((g.speed - 40) / 20) * 0.5,
    };
  }

  private missionLines(): MissionLine[] {
    const t = this.missions;
    const st = this.stats();
    return t.missions.map((m, i) => ({ label: m.label, progress: t.progress(i, st), done: !!(t.done & (1 << i)) }));
  }
}
