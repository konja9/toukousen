import { ColorManagement, LinearSRGBColorSpace, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import { BALL, BRUSH, FIELD } from '../config';
import { Audio } from '../core/audio';
import { Input, type Action } from '../core/input';
import { load, save } from '../core/storage';
import { clamp01, easeOutCubic } from '../core/tween';
import { HeightField } from '../field/heightfield';
import { pickTerrain } from '../field/raycast';
import { OrbitRig } from '../render/camera';
import { Markers } from '../render/markers';
import { Model } from '../render/model';
import { fieldData, fieldTexture, shared } from '../render/uniforms';
import { Ball, simulate } from '../sim/ball';
import { STAGES, type Stage } from '../sim/stages';
import { Hud } from '../ui/hud';
import { Screens, type FailReason } from '../ui/screens';

ColorManagement.enabled = false;

type State = 'title' | 'select' | 'intro' | 'edit' | 'roll' | 'clear' | 'fail';

const THEMES = {
  dark: { bg: 0x0b0b0b, ink: 0xecebe6, css: ['#ecebe6', '#0b0b0b'] },
  paper: { bg: 0xefede6, ink: 0x141414, css: ['#141414', '#efede6'] },
} as const;
type ThemeName = keyof typeof THEMES;

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new OrbitRig();
  private readonly model = new Model();
  private readonly markers = new Markers();
  private readonly field = new HeightField();
  /**
   * While a stroke is in progress the cursor is picked against the terrain as it
   * was when the stroke began. Picking the live surface would make a stationary
   * brush creep toward the camera as the ground rises (and away as it is cut).
   */
  private readonly strokeSurface = new HeightField();
  private pickSurface: HeightField = this.field;
  private readonly ball = new Ball();
  private readonly input: Input;
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly raycaster = new Raycaster();

  private state: State = 'title';
  private stage: Stage = STAGES[0];
  private selectIndex = 0;
  private best: Record<number, number> = load('best', {});
  private theme: ThemeName = load<ThemeName>('theme', 'dark');

  private strokes = 0;
  private soilMax = 1;
  private soilMoved = 0;
  private radius: number = BRUSH.radiusDefault;
  private strokeVersion = -1;
  private uploadedVersion = -1;
  private previewVersion = -1;
  private previewTimer = 0;
  private cursor: [number, number, number] | null = null;
  private trail: Array<[number, number]> = [];
  private trailTimer = 0;
  private acc = 0;
  private time = 0;
  private stateTime = 0;
  private revealT = 0;
  private hudAlpha = 0;
  private holedT = 0;
  private resetArmed = 0;
  private failReason: FailReason | null = null;
  private w = 1;
  private h = 1;
  private last = performance.now();

  constructor(root: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.domElement.classList.add('gl');
    root.appendChild(this.renderer.domElement);
    this.hud = new Hud(root);
    this.screens = new Screens(document.body, STAGES);
    this.screens.onPick = (id) => this.openStage(id);

    this.scene.add(this.model.group, this.markers.group);
    this.input = new Input(this.renderer.domElement);
    this.input.onAction((a) => this.onAction(a));
    this.input.onPress = () => this.beginStroke();
    this.input.onRelease = () => this.endStroke();
    this.input.onClick = () => {
      this.audio.init();
      if (this.state === 'title' && this.revealT > 0.5) this.toSelect();
    };
    this.audio.setMuted(load<boolean>('muted', false));

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyTheme(this.theme);
    this.loadStage(STAGES[4], true);
  }

  start(): void {
    this.renderer.compile(this.scene, this.rig.camera);
    requestAnimationFrame(() => {
      this.screens.hideLoading();
      this.screens.showTitle(true, Object.keys(this.best).length);
      this.last = performance.now();
      this.loop();
    });
  }

  // ------------------------------------------------------------ setup

  private resize(): void {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h);
    this.hud.resize(this.w, this.h, dpr);
    this.rig.resize(this.w / this.h, this.w, this.h);
  }

  private applyTheme(name: ThemeName): void {
    this.theme = name;
    const t = THEMES[name];
    shared.uBg.value.set(t.bg);
    shared.uInk.value.set(t.ink);
    this.renderer.setClearColor(t.bg);
    this.markers.syncColors();
    this.hud.syncColors();
    document.documentElement.dataset.theme = name;
    this.screens.refreshSelect(this.best, t.css[0], t.css[1]);
  }

  /** Reset the field to a stage's initial terrain. `decor` = shown behind menus. */
  private loadStage(stage: Stage, decor = false): void {
    this.stage = stage;
    this.field.fill(stage.terrain, stage.rock);
    this.field.soil = stage.soil;
    this.soilMax = Math.max(stage.soil, 400);
    this.soilMoved = 0;
    this.strokes = 0;
    this.model.setWater(stage.water);
    this.markers.setCourse(stage.goal, stage.checkpoints, this.field);
    this.ball.reset(stage, this.field);
    this.trail = [];
    this.markers.setTrail([], this.field);
    this.previewVersion = -1;
    this.revealT = 0;
    shared.uRevealCenter.value.set(stage.start[0], stage.start[1]);
    shared.uBallLine.value = decor ? 0 : 1;
    this.holedT = 0;
    this.syncField();
  }

  private syncField(): void {
    if (this.uploadedVersion === this.field.version) return;
    const n = FIELD.N * FIELD.N;
    for (let k = 0; k < n; k++) {
      fieldData[k * 2] = this.field.h[k];
      fieldData[k * 2 + 1] = this.field.rock[k];
    }
    fieldTexture.needsUpdate = true;
    this.uploadedVersion = this.field.version;
  }

  // ------------------------------------------------------------ states

  private toSelect(): void {
    this.audio.ui();
    this.state = 'select';
    this.stateTime = 0;
    this.screens.showTitle(false);
    this.screens.hideResult();
    this.screens.showFail(null);
    this.selectIndex = Math.max(0, STAGES.indexOf(this.stage));
    this.screens.showSelect(true, this.selectIndex);
    this.loadStage(STAGES[this.selectIndex], true);
  }

  private openStage(id: number): void {
    const st = STAGES.find((s) => s.id === id);
    if (!st) return;
    this.audio.init();
    this.audio.ui();
    this.screens.showSelect(false);
    this.screens.showTitle(false);
    this.screens.hideResult();
    this.loadStage(st);
    this.state = 'intro';
    this.stateTime = 0;
    this.rig.targetFocus.set(0, 6, 0);
  }

  private release(): void {
    if (this.state !== 'edit') return;
    this.ball.reset(this.stage, this.field);
    this.ball.release();
    this.trail = [[this.ball.x, this.ball.z]];
    this.trailTimer = 0;
    this.acc = 0;
    this.state = 'roll';
    this.stateTime = 0;
    this.markers.setPreview([], this.field, false);
  }

  private backToEdit(): void {
    this.ball.reset(this.stage, this.field);
    this.state = 'edit';
    this.stateTime = 0;
    this.previewVersion = -1;
    this.audio.roll(0);
    this.screens.showFail(null);
    this.rig.targetFocus.set(0, 6, 0);
  }

  private finishRoll(): void {
    const s = this.ball.state;
    this.audio.roll(0);
    if (s === 'holed') {
      this.state = 'clear';
      this.stateTime = 0;
      this.holedT = 0.001;
      this.audio.holed();
      const prev = this.best[this.stage.id];
      if (prev === undefined || this.strokes < prev) {
        this.best[this.stage.id] = this.strokes;
        save('best', this.best);
      }
      const t = THEMES[this.theme];
      this.screens.refreshSelect(this.best, t.css[0], t.css[1]);
      window.setTimeout(() => {
        if (this.state === 'clear') this.screens.showResult(this.stage, this.strokes, this.soilMoved);
      }, 1100);
    } else {
      this.state = 'fail';
      this.stateTime = 0;
      this.failReason = s as FailReason;
      this.audio.fail();
      this.screens.showFail(this.failReason);
    }
  }

  // ------------------------------------------------------------ sculpting

  private beginStroke(): void {
    if (this.state === 'fail') this.backToEdit();
    if (this.state !== 'edit' || !this.cursor) return;
    this.field.pushUndo();
    this.strokeVersion = this.field.version;
    this.strokeSurface.copyFrom(this.field);
    this.pickSurface = this.strokeSurface;
  }

  private endStroke(): void {
    this.audio.brush(0);
    this.pickSurface = this.field;
    if (this.strokeVersion < 0) return;
    if (this.field.version !== this.strokeVersion) this.strokes++;
    else this.field.discardUndo();
    this.strokeVersion = -1;
  }

  private updateCursor(): void {
    if (!this.input.hover || this.input.mouseX < 0) {
      this.cursor = null;
      return;
    }
    const ndc = new Vector2((this.input.mouseX / this.w) * 2 - 1, -(this.input.mouseY / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    this.cursor = pickTerrain(this.raycaster.ray, this.pickSurface);
  }

  private get brushMode(): 'raise' | 'cut' {
    if (this.input.pressed) return this.input.pressed === 2 ? 'cut' : 'raise';
    return this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 'cut' : 'raise';
  }

  // ------------------------------------------------------------ input

  private onAction(a: Action): void {
    this.audio.init();
    if (typeof a === 'object') {
      if (this.state === 'select' || this.state === 'title') this.openStage(a.stage);
      return;
    }
    switch (a) {
      case 'mute':
        this.audio.setMuted(!this.audio.isMuted);
        save('muted', this.audio.isMuted);
        this.screens.toast(this.audio.isMuted ? 'SOUND OFF' : 'SOUND ON');
        return;
      case 'theme':
        this.applyTheme(this.theme === 'dark' ? 'paper' : 'dark');
        save('theme', this.theme);
        this.screens.toast(this.theme === 'dark' ? 'NIGHT' : 'PAPER');
        return;
      case 'rotateLeft':
        this.rig.rotate(-1);
        return;
      case 'rotateRight':
        this.rig.rotate(1);
        return;
      case 'view':
        this.rig.togglePlan();
        return;
      case 'brushUp':
        this.radius = Math.min(BRUSH.radiusMax, this.radius + 1);
        return;
      case 'brushDown':
        this.radius = Math.max(BRUSH.radiusMin, this.radius - 1);
        return;
    }
    switch (this.state) {
      case 'title':
        if (a === 'confirm') this.toSelect();
        break;
      case 'select':
        if (a === 'confirm') this.openStage(STAGES[this.selectIndex].id);
        else if (a === 'back') {
          this.state = 'title';
          this.screens.showSelect(false);
          this.screens.showTitle(true, Object.keys(this.best).length);
        } else if (a === 'next' || a === 'prev' || a === 'up' || a === 'down') {
          const cols = Math.max(1, Math.round((Math.min(this.w, 1180) - 40) / 208));
          const d = a === 'next' ? 1 : a === 'prev' ? -1 : a === 'down' ? cols : -cols;
          this.selectIndex = Math.min(STAGES.length - 1, Math.max(0, this.selectIndex + d));
          this.screens.focusCard(this.selectIndex);
          this.loadStage(STAGES[this.selectIndex], true);
        }
        break;
      case 'edit':
        if (a === 'confirm') this.release();
        else if (a === 'undo') {
          if (this.field.undo()) this.strokes = Math.max(0, this.strokes - 1);
        } else if (a === 'reset') {
          if (this.time - this.resetArmed < 1.5) {
            this.loadStage(this.stage);
            this.state = 'edit';
            this.screens.toast('RESET');
          } else {
            this.resetArmed = this.time;
            this.screens.toast('もう一度 R で最初から');
          }
        } else if (a === 'back') this.toSelect();
        break;
      case 'roll':
        if (a === 'confirm') this.backToEdit();
        else if (a === 'back') this.toSelect();
        break;
      case 'fail':
        if (a === 'confirm' || a === 'undo') {
          this.backToEdit();
          if (a === 'undo' && this.field.undo()) this.strokes = Math.max(0, this.strokes - 1);
        } else if (a === 'back') this.toSelect();
        break;
      case 'clear':
        if (this.stateTime < 1.2) break;
        if (a === 'confirm') {
          const next = STAGES[STAGES.indexOf(this.stage) + 1];
          if (next) this.openStage(next.id);
          else this.toSelect();
        } else if (a === 'reset') this.openStage(this.stage.id);
        else if (a === 'back') this.toSelect();
        break;
      case 'intro':
        break;
    }
  }

  // ------------------------------------------------------------ loop

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.update(dt);
    this.render();
  };

  private update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    this.revealT += dt;
    shared.uTime.value = this.time;
    shared.uReveal.value = this.revealT < 1.8 ? easeOutCubic(this.revealT / 1.8) * 130 : 1e4;

    const wheel = this.input.takeWheel();
    if (wheel) this.radius = Math.min(BRUSH.radiusMax, Math.max(BRUSH.radiusMin, this.radius - wheel));

    const menu = this.state === 'title' || this.state === 'select';
    if (menu) this.rig.targetAzimuth += dt * 0.12;
    this.rig.targetShift = this.state === 'title' && this.w > 760 ? 1 : 0;
    this.rig.update(dt);
    this.updateCursor();

    switch (this.state) {
      case 'intro':
        if (this.stateTime > 0.9) {
          this.state = 'edit';
          this.stateTime = 0;
        }
        break;
      case 'edit':
        this.updateEdit(dt);
        break;
      case 'roll':
        this.updateRoll(dt);
        break;
      case 'fail':
        if (this.stateTime > 1.8) this.backToEdit();
        break;
      case 'clear':
        this.holedT += dt;
        break;
    }

    this.syncField();
    if (this.state !== 'roll') this.markers.setBall(this.ball.x, this.field.heightAt(this.ball.x, this.ball.z), this.ball.z);
    shared.uBallH.value = this.field.heightAt(this.ball.x, this.ball.z);
    this.markers.update(this.time, this.ball.reached, this.holedT);

    const showHud = this.state === 'edit' || this.state === 'roll' || this.state === 'fail' || this.state === 'intro';
    this.hudAlpha = clamp01(this.hudAlpha + (showHud ? dt : -dt) * 2.5);
  }

  private updateEdit(dt: number): void {
    const f = this.field;
    const mode = this.brushMode;
    const sculpting = this.input.pressed !== 0 && this.strokeVersion >= 0 && this.cursor !== null;
    if (sculpting && this.cursor) {
      const moved = f.brush(this.cursor[0], this.cursor[2], this.radius, BRUSH.rate * dt, mode);
      this.soilMoved += moved;
      this.soilMax = Math.max(this.soilMax, f.soil);
      this.audio.brush(moved > 0 ? (mode === 'raise' ? 1 : 2) : 0);
    }
    this.markers.setBrush(this.cursor?.[0] ?? 0, this.cursor?.[2] ?? 0, this.radius, mode, f, this.cursor !== null, this.time);

    // preview of the first seconds of the roll, refreshed while the terrain changes
    this.previewTimer -= dt;
    if (this.previewVersion !== f.version && this.previewTimer <= 0) {
      this.previewTimer = 0.08;
      this.previewVersion = f.version;
      const sim = simulate(f, this.stage, BALL.previewSeconds, 0.04);
      this.markers.setPreview(sim.path, f, true);
    }
    this.ball.reset(this.stage, f);
  }

  private updateRoll(dt: number): void {
    const fast = this.input.isDown('KeyF');
    const steps = fast ? 4 : 1;
    const h = 1 / BALL.stepHz;
    this.acc += dt * steps;
    const before = this.ball.reached.filter(Boolean).length;
    let px = this.ball.x;
    let pz = this.ball.z;
    while (this.acc >= h && this.ball.state === 'rolling') {
      this.acc -= h;
      this.ball.step(h, this.field, this.stage);
      this.trailTimer += h;
      if (this.trailTimer > 0.05) {
        this.trailTimer = 0;
        this.trail.push([this.ball.x, this.ball.z]);
      }
    }
    if (this.ball.reached.filter(Boolean).length > before) {
      this.audio.checkpoint();
      this.screens.toast('△ BENCHMARK');
    }
    this.markers.setTrail([...this.trail, [this.ball.x, this.ball.z]], this.field);
    const vx = (this.ball.x - px) / Math.max(dt, 1e-6);
    const vz = (this.ball.z - pz) / Math.max(dt, 1e-6);
    px = this.ball.x;
    pz = this.ball.z;
    this.markers.setBall(this.ball.x, this.ball.y, this.ball.z, vx, vz, dt);
    this.markers.setBrush(0, 0, 0, 'raise', this.field, false, 0);
    this.audio.roll(this.ball.speed);
    // follow the ball a little
    this.rig.targetFocus.set(this.ball.x * 0.25, 6, this.ball.z * 0.25);
    if (this.ball.state !== 'rolling') this.finishRoll();
  }

  // ------------------------------------------------------------ render

  private render(): void {
    this.renderer.render(this.scene, this.rig.camera);
    this.hud.begin();
    const inStage = this.state !== 'title' && this.state !== 'select';
    if (inStage) {
      const c = this.cursor;
      let cursor: { x: number; y: number; h: number } | null = null;
      if (c && this.state === 'edit') cursor = { x: this.input.mouseX, y: this.input.mouseY, h: this.field.heightAt(c[0], c[2]) };
      this.hud.stage(
        {
          stage: this.stage,
          strokes: this.strokes,
          soil: this.field.soil,
          soilMax: this.soilMax,
          radius: this.radius,
          mode: this.brushMode,
          phase: this.state === 'edit' ? 'edit' : this.state === 'roll' ? 'roll' : 'other',
          fast: this.input.isDown('KeyF'),
          reached: this.ball.reached,
          cursor,
        },
        this.hudAlpha,
        this.time,
      );
    } else {
      this.hud.corners(clamp01(this.revealT - 0.4));
    }
  }
}
