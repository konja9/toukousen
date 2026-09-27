import { BufferAttribute, BufferGeometry, ColorManagement, Line, LineBasicMaterial, LinearSRGBColorSpace, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { FIELD, PLAYER, WATCH } from '../config';
import { Audio } from '../core/audio';
import { Input, type Action } from '../core/input';
import { load, save } from '../core/storage';
import { clamp01, damp, easeInOutCubic, easeOutCubic } from '../core/tween';
import { FEATURE_TEXT } from '../field/features';
import { generate } from '../field/generate';
import type { HeightField } from '../field/heightfield';
import { Actors } from '../render/actors';
import { FollowCam } from '../render/camera';
import { MapView, type MapFrame } from '../render/mapview';
import { Terrain, terrainGeometry } from '../render/terrain';
import { fieldData, fieldTexture, shared } from '../render/uniforms';
import { Viewshed } from '../render/viewshed';
import { COURSES } from '../sim/courses';
import type { Course } from '../sim/course';
import { Player } from '../sim/player';
import { alertRate, sees, watcherAt, type WatcherState } from '../sim/watchers';
import { Hud } from '../ui/hud';
import { Screens, type Best, type Mode } from '../ui/screens';

ColorManagement.enabled = false;

type State = 'title' | 'select' | 'brief' | 'run' | 'caught' | 'finish';

const THEMES = {
  dark: { bg: 0x0b0b0b, ink: 0xecebe6, css: ['#ecebe6', '#0b0b0b'] },
  paper: { bg: 0xefede6, ink: 0x141414, css: ['#141414', '#efede6'] },
} as const;
type ThemeName = keyof typeof THEMES;

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly follow = new FollowCam();
  private readonly overview = new PerspectiveCamera(42, 1, 1, 3000);
  private readonly geometry = terrainGeometry();
  private readonly terrain = new Terrain(this.geometry);
  private readonly viewshed = new Viewshed(this.geometry);
  private readonly actors = new Actors();
  private readonly mapView = new MapView();
  private readonly input: Input;
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly player = new Player();
  private readonly sightLine: Line;

  private field!: HeightField;
  private course: Course = COURSES[0];
  private state: State = 'title';
  private paused = false;
  private mode: Mode = load<Mode>('mode', 'normal');
  private theme: ThemeName = load<ThemeName>('theme', 'dark');
  private best: Record<string, Best> = load('best', {});
  private selectIndex = 0;

  private states: WatcherState[] = [];
  private simTime = 0;
  private runTime = 0;
  private penalties = 0;
  private next = 0;
  private punched: boolean[] = [];
  private checkpoint: [number, number] = [0, 0];
  private alert = 0;
  private seen = false;
  private heard = false;
  private everSeen = false;
  private spotter = -1;
  private trail: Array<[number, number, number]> = [];
  private trailT = 0;
  private stepAcc = 0;
  private mapOpen = false;
  private mapT = 0;
  private stateTime = 0;
  private revealT = 0;
  private hudAlpha = 0;
  private orbit = 0;
  private w = 1;
  private h = 1;
  private last = performance.now();

  constructor(root: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.domElement.classList.add('gl');
    root.appendChild(this.renderer.domElement);
    this.hud = new Hud(root);
    this.screens = new Screens(document.body, COURSES);
    this.screens.onPick = (id) => this.openBrief(id);
    this.screens.onMode = (m) => this.setMode(m);

    this.sightLine = new Line(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)), new LineBasicMaterial({ transparent: true }));
    this.sightLine.frustumCulled = false;
    this.sightLine.visible = false;
    this.scene.add(this.terrain.mesh, this.actors.group, this.sightLine);

    this.input = new Input(this.renderer.domElement);
    this.input.onAction((a) => this.onAction(a));
    this.input.onClick = () => {
      this.audio.init();
      if (this.state === 'title' && this.revealT > 0.5) this.toSelect();
      else if (this.state === 'run' && !this.paused && !this.input.locked) this.input.requestLock();
    };
    this.audio.setMuted(load<boolean>('muted', false));

    window.addEventListener('resize', () => this.resize());
    const autoPause = () => {
      if (this.state === 'run' && !this.paused) this.setPaused(true);
    };
    document.addEventListener('visibilitychange', () => document.hidden && autoPause());
    window.addEventListener('blur', autoPause);
    this.resize();
    this.applyTheme(this.theme);
    this.loadCourse(COURSES[3]);
  }

  start(): void {
    this.renderer.compile(this.scene, this.overview);
    requestAnimationFrame(() => {
      this.screens.hideLoading();
      this.screens.showTitle(true);
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
    this.follow.resize(this.w / this.h);
    this.overview.aspect = this.w / this.h;
    this.overview.updateProjectionMatrix();
  }

  private applyTheme(name: ThemeName): void {
    this.theme = name;
    const t = THEMES[name];
    shared.uBg.value.set(t.bg);
    shared.uInk.value.set(t.ink);
    this.renderer.setClearColor(t.bg);
    (this.sightLine.material as LineBasicMaterial).color.set(t.ink);
    this.actors.syncColors();
    this.hud.syncColors();
    document.documentElement.dataset.theme = name;
    this.screens.refresh(this.best, this.mode, t.css[0], t.css[1]);
    this.actors.setCourse(this.course, this.field ?? generate(this.course.terrain), t.css[0]);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    save('mode', m);
    const t = THEMES[this.theme];
    this.screens.refresh(this.best, this.mode, t.css[0], t.css[1]);
    this.screens.toast(m === 'orienteering' ? '読図モード：地図に現在地を出さない' : '通常モード：地図に現在地を出す');
  }

  private loadCourse(c: Course): void {
    this.course = c;
    this.field = generate(c.terrain);
    fieldData.set(this.field.h);
    fieldTexture.needsUpdate = true;
    this.actors.setCourse(c, this.field, THEMES[this.theme].css[0]);
    this.simTime = 0;
    this.revealT = 0;
    shared.uRevealCenter.value.set(c.start[0], c.start[1]);
    this.player.place(c.start[0], c.start[1], this.field, this.headingToward(c.start, [c.controls[0].x, c.controls[0].z]));
    this.punched = c.controls.map(() => false);
    this.next = 0;
  }

  private headingToward(a: readonly [number, number], b: readonly [number, number]): number {
    return Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  }

  // ------------------------------------------------------------ states

  private toSelect(): void {
    this.audio.ui();
    this.input.releaseLock();
    this.state = 'select';
    this.stateTime = 0;
    this.mapOpen = false;
    this.screens.showTitle(false);
    this.screens.showResult(false);
    this.screens.showBrief(false);
    this.screens.showPause(false);
    this.selectIndex = Math.max(0, COURSES.indexOf(this.course));
    this.screens.showSelect(true, this.selectIndex);
    this.loadCourse(COURSES[this.selectIndex]);
  }

  private openBrief(id: number): void {
    const c = COURSES.find((k) => k.id === id);
    if (!c) return;
    this.audio.init();
    this.audio.ui();
    this.screens.showSelect(false);
    this.screens.showTitle(false);
    this.screens.showResult(false);
    this.loadCourse(c);
    this.state = 'brief';
    this.stateTime = 0;
    this.mapOpen = true;
    this.screens.showBrief(true, `SHEET ${String(c.id).padStart(2, '0')} ${c.nameJa} — ${c.brief}`);
  }

  private startRun(): void {
    const c = this.course;
    this.state = 'run';
    this.stateTime = 0;
    this.runTime = 0;
    this.penalties = 0;
    this.alert = 0;
    this.everSeen = false;
    this.next = 0;
    this.punched = c.controls.map(() => false);
    this.checkpoint = [c.start[0], c.start[1]];
    this.player.place(c.start[0], c.start[1], this.field, this.headingToward(c.start, [c.controls[0].x, c.controls[0].z]));
    this.follow.yaw = this.player.facing;
    this.follow.snap();
    this.trail = [[c.start[0], c.start[1], 0]];
    this.mapOpen = false;
    this.screens.showBrief(false);
    this.input.requestLock();
    this.audio.ui();
  }

  private caught(): void {
    this.state = 'caught';
    this.stateTime = 0;
    this.penalties++;
    this.everSeen = true;
    this.audio.spotted();
    this.screens.invertFlash();
    this.screens.showCaught(true);
    this.input.releaseLock();
    const s = this.states[this.spotter];
    if (s) {
      const arr = this.sightLine.geometry.attributes.position.array as Float32Array;
      arr.set([s.eye.x, s.eye.y, s.eye.z, this.player.x, this.player.eyeY, this.player.z]);
      this.sightLine.geometry.attributes.position.needsUpdate = true;
      this.sightLine.visible = true;
    }
  }

  private respawn(): void {
    this.screens.showCaught(false);
    this.sightLine.visible = false;
    this.alert = 0;
    const [x, z] = this.checkpoint;
    const target = this.next < this.course.controls.length ? [this.course.controls[this.next].x, this.course.controls[this.next].z] : this.course.finish;
    this.player.place(x, z, this.field, this.headingToward([x, z], target as [number, number]));
    this.follow.yaw = this.player.facing;
    this.follow.snap();
    this.state = 'run';
    this.stateTime = 0;
    this.input.requestLock();
  }

  private finish(): void {
    this.state = 'finish';
    this.stateTime = 0;
    this.input.releaseLock();
    this.audio.finish();
    const total = this.runTime + this.penalties * WATCH.caughtPenalty;
    const key = `${this.course.id}:${this.mode}`;
    const prev = this.best[key];
    const newBest = !prev || total < prev.time;
    if (newBest) this.best[key] = { time: total, unseen: !this.everSeen };
    else if (!this.everSeen && prev) prev.unseen = true;
    save('best', this.best);
    const t = THEMES[this.theme];
    this.screens.refresh(this.best, this.mode, t.css[0], t.css[1]);
    this.screens.showResult(true, {
      course: this.course,
      time: total,
      raw: this.runTime,
      penalties: this.penalties,
      best: this.best[key].time,
      unseen: !this.everSeen,
      mode: this.mode,
      newBest,
    });
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.screens.showPause(p);
    if (p) {
      this.input.releaseLock();
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.last = performance.now();
    }
  }

  // ------------------------------------------------------------ input

  private onAction(a: Action): void {
    this.audio.init();
    if (typeof a === 'object') {
      if (this.state === 'select' || this.state === 'title') this.openBrief(a.sheet);
      return;
    }
    if (a === 'mute') {
      this.audio.setMuted(!this.audio.isMuted);
      save('muted', this.audio.isMuted);
      this.screens.toast(this.audio.isMuted ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    if (a === 'theme') {
      this.applyTheme(this.theme === 'dark' ? 'paper' : 'dark');
      save('theme', this.theme);
      this.screens.toast(this.theme === 'dark' ? 'NIGHT' : 'PAPER');
      return;
    }
    if (this.paused) {
      if (a === 'back') this.setPaused(false);
      else if (a === 'retry') {
        this.setPaused(false);
        this.startRun();
      } else if (a === 'confirm') this.setPaused(false);
      return;
    }
    switch (this.state) {
      case 'title':
        if (a === 'confirm') this.toSelect();
        break;
      case 'select': {
        if (a === 'confirm') this.openBrief(COURSES[this.selectIndex].id);
        else if (a === 'mode') this.setMode(this.mode === 'normal' ? 'orienteering' : 'normal');
        else if (a === 'back') {
          this.state = 'title';
          this.screens.showSelect(false);
          this.screens.showTitle(true);
        } else if (a === 'next' || a === 'prev' || a === 'up' || a === 'down') {
          const cols = this.screens.columns;
          const d = a === 'next' ? 1 : a === 'prev' ? -1 : a === 'down' ? cols : -cols;
          this.selectIndex = Math.min(COURSES.length - 1, Math.max(0, this.selectIndex + d));
          this.screens.focusCard(this.selectIndex);
          this.loadCourse(COURSES[this.selectIndex]);
        }
        break;
      }
      case 'brief':
        if (a === 'confirm') this.startRun();
        else if (a === 'back') this.toSelect();
        break;
      case 'run':
        if (a === 'map') this.mapOpen = !this.mapOpen;
        else if (a === 'back') this.setPaused(true);
        break;
      case 'caught':
        if (a === 'confirm' && this.stateTime > 0.6) this.respawn();
        break;
      case 'finish':
        if (this.stateTime < 1) break;
        if (a === 'confirm') {
          const nextCourse = COURSES[COURSES.indexOf(this.course) + 1];
          this.screens.showResult(false);
          if (nextCourse) this.openBrief(nextCourse.id);
          else this.toSelect();
        } else if (a === 'retry') {
          this.screens.showResult(false);
          this.openBrief(this.course.id);
        } else if (a === 'back') this.toSelect();
        break;
    }
    if (a === 'retry' && this.state === 'run') this.startRun();
  }

  // ------------------------------------------------------------ loop

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
  };

  private update(dt: number): void {
    this.stateTime += dt;
    this.revealT += dt;
    this.simTime += dt;
    shared.uTime.value = this.simTime;
    shared.uReveal.value = this.revealT < 2.2 ? easeOutCubic(this.revealT / 2.2) * 700 : 1e5;
    this.states = this.course.watchers.map((w, i) => watcherAt(w, this.simTime, this.field, this.states[i]));

    const inRun = this.state === 'run';
    if (inRun) this.updateRun(dt);
    if (this.state === 'caught') {
      if (this.stateTime > WATCH.caughtScreen) this.respawn();
    }
    this.mapT += ((this.mapOpen || this.state === 'brief' || this.state === 'finish' ? 1 : 0) - this.mapT) * damp(9, dt);
    const showHud = inRun || this.state === 'caught';
    this.hudAlpha = clamp01(this.hudAlpha + (showHud ? dt : -dt) * 2.5);
    this.audio.heartbeat(inRun ? this.alert : 0, dt);

    const followCam = inRun || this.state === 'caught';
    if (followCam) {
      const [lx, ly] = this.input.takeLook();
      if (inRun) this.follow.look(lx, ly);
      if (this.state === 'caught') {
        // pull up and back so the line of sight is visible
        this.follow.pitch += (0.9 - this.follow.pitch) * damp(2, dt);
        this.follow.distance += (40 - this.follow.distance) * damp(2, dt);
      } else this.follow.distance += (8.5 - this.follow.distance) * damp(4, dt);
      this.follow.update(this.player.x, this.player.y, this.player.z, this.field, dt);
      shared.uFogDist.value = 230;
    } else {
      this.input.takeLook();
      this.orbit += dt * 0.05;
      const r = 330;
      this.overview.position.set(Math.sin(this.orbit) * r, 270, Math.cos(this.orbit) * r);
      this.overview.lookAt(0, 30, 0);
      shared.uFogDist.value = 1e5;
    }
    this.actors.update(this.player, this.states, this.field, this.next, this.simTime, this.punched);
  }

  private updateRun(dt: number): void {
    const [f, r] = this.input.axes;
    const [fx, fz] = this.follow.forward;
    const rx = -fz;
    const rz = fx;
    this.player.step(dt, { dx: fx * f + rx * r, dz: fz * f + rz * r, sprint: this.input.sprint, crouch: this.input.crouchToggle }, this.field);
    this.runTime += dt;

    // footsteps
    const stride = this.player.posture === 'crouch' ? 0.9 : this.player.sprinting ? 1.8 : 1.35;
    this.stepAcc += this.player.speed * dt;
    if (this.stepAcc > stride) {
      this.stepAcc = 0;
      this.audio.step(this.player.posture === 'crouch' ? 'crouch' : this.player.sprinting ? 'sprint' : 'run');
    }

    // punching
    const c = this.course;
    if (this.next < c.controls.length) {
      const k = c.controls[this.next];
      if (Math.hypot(this.player.x - k.x, this.player.z - k.z) < PLAYER.punchRadius) {
        this.punched[this.next] = true;
        this.checkpoint = [k.x, k.z];
        this.audio.punch();
        this.screens.toast(`${this.next + 1}  ${FEATURE_TEXT[k.kind].ja} · PUNCH`);
        this.next++;
      }
    } else if (Math.hypot(this.player.x - c.finish[0], this.player.z - c.finish[1]) < PLAYER.punchRadius) {
      this.finish();
      return;
    }

    // being watched
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    this.seen = false;
    this.heard = false;
    let gain = 0;
    this.states.forEach((s, i) => {
      const d = Math.hypot(eye.x - s.eye.x, eye.z - s.eye.z);
      if (sees(s, eye, this.field)) {
        this.seen = true;
        this.spotter = i;
        gain += alertRate(d, s.range);
      } else if (this.player.sprinting && d < WATCH.hearRadius) {
        this.heard = true;
        this.spotter = i;
        gain += WATCH.hearRate;
      }
    });
    // a moment to react after (re)spawning
    if (this.stateTime < WATCH.respawnGrace) gain = 0;
    if (gain > 0) this.alert = Math.min(1, this.alert + gain * dt);
    else this.alert = Math.max(0, this.alert - WATCH.alertDecay * dt);

    this.trailT += dt;
    if (this.trailT > 0.4) {
      this.trailT = 0;
      this.trail.push([this.player.x, this.player.z, this.seen ? 1 : 0]);
    }
    if (this.alert >= 1) this.caught();
  }

  // ------------------------------------------------------------ render

  private mapFrame(): MapFrame {
    const t = easeInOutCubic(this.mapT);
    const brief = this.state === 'brief' || this.state === 'finish';
    const size = Math.min(this.h * (this.state === 'brief' ? 0.8 : 0.86), this.w * (brief ? 0.62 : 0.56));
    const x = this.state === 'brief' ? (this.w - size) / 2 : this.w - size - 36;
    const y = (this.h - size) / 2 - (this.state === 'brief' ? 30 : 0) + (1 - t) * this.h * 0.6;
    return { cx: 0, cz: 0, mpp: (2 * FIELD.half + 30) / size, x, y, w: size, h: size, opacity: t };
  }

  private render(): void {
    const r = this.renderer;
    if (this.states.length) this.viewshed.update(r, this.states);
    r.setViewport(0, 0, this.w, this.h);
    r.clear();
    const cam = this.state === 'run' || this.state === 'caught' ? this.follow.camera : this.overview;
    r.render(this.scene, cam);

    this.hud.begin();
    if (this.state === 'run' || this.state === 'caught') {
      this.hud.run(
        {
          course: this.course,
          next: this.next,
          time: this.runTime + this.penalties * WATCH.caughtPenalty,
          penalties: this.penalties,
          alert: this.alert,
          seen: this.seen,
          heard: this.heard,
          heading: this.follow.yaw,
          posture: this.player.posture,
          sprinting: this.player.sprinting,
          orienteering: this.mode === 'orienteering',
          locked: this.input.locked,
          mapT: this.mapT,
        },
        this.hudAlpha,
        this.simTime,
      );
    } else if (this.state === 'title' || this.state === 'select') {
      this.hud.corners(clamp01(this.revealT - 0.3));
    }

    const showMap = this.mapT > 0.01 || this.state === 'finish';
    if (showMap) {
      const f = this.mapFrame();
      this.mapView.render(r, f, this.h);
      const showMe = this.mode === 'normal' || this.state === 'finish';
      this.hud.mapOverlay(f, this.course, {
        next: this.next,
        punched: this.punched,
        player: showMe && this.state !== 'brief' ? { x: this.player.x, z: this.player.z, facing: this.player.facing } : undefined,
        trail: this.state === 'finish' ? this.trail : undefined,
        alpha: 1,
      });
      this.hud.mapFrame(f, this.course, 1, this.mode === 'orienteering');
    }
  }
}
