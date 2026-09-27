import {
  ColorManagement,
  Fog,
  LinearSRGBColorSpace,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FLIGHT } from '../config';
import { Audio } from '../core/audio';
import { Input, type Action } from '../core/input';
import { load, save } from '../core/storage';
import { clamp01, damp, easeInOutCubic, easeOutCubic, lerp } from '../core/tween';
import { CameraRig, topDownPose, type Pose } from '../camera/cameraRig';
import { Glider } from '../player/glider';
import { GliderView } from '../player/gliderView';
import { Hud, type PathPoint } from '../ui/hud';
import { Screens } from '../ui/screens';
import { Gates } from '../world/gates';
import { MapView, type MapFrame } from '../world/mapView';
import { Terrain } from '../world/terrain';
import { TerrainField, seedVector } from '../world/terrainField';
import { Thermals } from '../world/thermals';
import { shared } from '../world/uniforms';
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
  private readonly dust: Points;
  private readonly input = new Input();
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly screens: Screens;

  private field!: TerrainField;
  private sheet = randomSheet();
  private state: State = 'title';
  private paused = false;
  private best = load<number>('best', 0);
  private theme: ThemeName = load<ThemeName>('theme', 'dark');

  private score = new ScoreKeeper();
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
    this.scene.add(this.terrain.mesh, this.thermals.group, this.gates.group, this.view.root);
    this.dust = this.makeDust();
    this.scene.add(this.dust);

    this.input.invertPitch = load<boolean>('invertPitch', false);
    this.audio.setMuted(load<boolean>('muted', false));
    this.applyTheme(this.theme);

    this.input.onAction((a) => this.onAction(a));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => (this.mouse = [e.clientX, e.clientY]));
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
      this.screens.showTitle(this.sheet, this.best);
      this.clock.last = performance.now();
      this.revealT = 0;
      this.loop();
    });
  }

  // ------------------------------------------------------------------ setup

  private makeDust(): Points {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = Math.random() * 160;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mat = new PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCam = { value: new Vector3() };
      mat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCam;')
        .replace(
          '#include <begin_vertex>',
          'vec3 transformed = mod(position - uCam + 80.0, 160.0) - 80.0 + uCam;',
        );
    };
    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private setSheet(sheet: number): void {
    this.sheet = sheet;
    const seed = seedVector(sheet);
    shared.uSeed.value.set(seed[0], seed[1]);
    this.field = new TerrainField(seed);
    this.thermals.reset(this.field, sheet, 0);
  }

  private applyTheme(name: ThemeName): void {
    this.theme = name;
    const t = THEMES[name];
    shared.uBg.value.set(t.bg);
    shared.uInk.value.set(t.ink);
    (this.scene.fog as Fog).color.set(t.bg);
    this.renderer.setClearColor(t.bg);
    (this.dust.material as PointsMaterial).color.set(t.ink);
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
    this.gates.reset(this.field, sheet, 0);
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
    this.gates.reset(this.field, sheet, z0);
    this.score = new ScoreKeeper();
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

  private crash(): void {
    this.state = 'crash';
    this.stateTime = 0;
    this.timeScale = 0.12;
    this.crashPos.set(this.glider.x, this.glider.y, this.glider.z);
    this.crashEye.copy(this.rig.camera.position);
    this.mapOpacity = 0;
    this.view.shatter(this.glider);
    this.audio.crash();
    this.audio.flight(0, 0, 0);
    this.screens.invertFlash();
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
    this.screens.showResult({
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
    this.screens.showTitle(this.sheet, this.best);
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
    while (this.acc >= h && !crashed) {
      this.acc -= h;
      const ax = g.x, ay = g.y, az = g.z;
      this.lift = this.thermals.liftAt(g);
      g.step(h, input, this.lift);
      for (const { gate, passed } of this.gates.cross(ax, ay, az, g.x, g.y, g.z)) {
        const bonus = this.score.gate(passed);
        if (passed) {
          g.addSpeed(6);
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
    if (this.state === 'play') this.score.update(dt, this.startZ - g.z, agl, g.speed);

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
    this.updateDust(this.state === 'intro' ? introT * 0.5 : 0.5);

    const lowness = clamp01((30 - agl) / 30);
    this.audio.flight(this.state === 'intro' ? g.speed * introT : g.speed, lowness, this.lift);

    if (this.state === 'intro') {
      this.hudReveal = 0;
      if (!this.rig.blending) {
        this.state = 'play';
        this.stateTime = 0;
      }
    } else {
      this.hudReveal = Math.min(1, this.hudReveal + realDt / 1.6);
    }

    if (crashed) this.crash();
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
    this.updateDust(Math.max(0, 0.5 - t * 0.3));
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

  private updateDust(opacity: number): void {
    const mat = this.dust.material as PointsMaterial;
    mat.opacity = opacity;
    const shader = mat.userData.shader as { uniforms: { uCam: { value: Vector3 } } } | undefined;
    shader?.uniforms.uCam.value.copy(this.rig.camera.position);
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
      stall: g.stalled,
      terrain: this.terrainWarn && this.state === 'play',
      fpm,
      radar,
      thermals: [...this.thermals.all()].map((t) => ({ x: t.x, z: t.z, radius: t.radius })),
      gates: pending.map((gt, i) => ({ x: gt.x, z: gt.z, nx: gt.nx, nz: gt.nz, next: i === 0 })),
      x: g.x,
      z: g.z,
    };
  }
}
