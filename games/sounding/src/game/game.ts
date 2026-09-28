import { LinearSRGBColorSpace, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { SUB } from '../config';
import { Audio } from '../core/audio';
import { Input, type Action } from '../core/input';
import { load, save } from '../core/storage';
import { clamp01, damp, easeInOutCubic } from '../core/tween';
import { floorAt } from '../field/grid';
import { Actors } from '../render/actors';
import { ChaseCam } from '../render/camera';
import { ChartView } from '../render/chart';
import { Pings } from '../render/pings';
import { Terrain, terrainGeometry } from '../render/terrain';
import { bindEcho, chartTexture, echoEnemyTexture, echoOwnTexture, fieldData, fieldTexture, shared } from '../render/uniforms';
import { Bot } from '../sim/bot';
import { Dive } from '../sim/run';
import { buildSector } from '../sim/sector';
import { applyAll, upgradeById, type UpgradeId } from '../sim/upgrades';
import { World, type WorldEvent } from '../sim/world';
import { diveNo, Hud, type Known } from '../ui/hud';
import { Screens, type Best } from '../ui/screens';

type State = 'title' | 'dive' | 'clear' | 'refit' | 'over';
type ThemeName = 'dark' | 'paper';

const THEMES: Record<ThemeName, { bg: number; ink: number; css: [string, string] }> = {
  dark: { bg: 0x060708, ink: 0xe9ecea, css: ['#e9ecea', '#060708'] },
  paper: { bg: 0xefede6, ink: 0x141414, css: ['#141414', '#efede6'] },
};

const KIND_JA = { ship: '哨戒艦', buoy: '聴音ブイ', hunter: '潜水艦' } as const;
const newSeed = () => 1000 + Math.floor(Math.random() * 9000);

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly chase = new ChaseCam();
  private readonly overview = new PerspectiveCamera(46, 1, 1, 2000);
  private readonly terrain = new Terrain(terrainGeometry());
  private readonly actors = new Actors();
  private readonly pingFx = new Pings();
  private readonly chart = new ChartView();
  private readonly input: Input;
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly screens: Screens;

  private state: State = 'title';
  private paused = false;
  private theme: ThemeName = load<ThemeName>('theme', 'dark');
  private best: Best | null = load<Best | null>('best', null);
  private dive: Dive | null = null;
  private world!: World;
  private demoBot = new Bot();
  private demoPing = 0;
  private known = new Map<number, Known>();
  private level = 1;
  private pendingPing: 'omni' | 'cone' | null = null;
  private pendingDecoy = false;
  private chartOpen = false;
  private chartT = 0;
  private stateTime = 0;
  private time = 0;
  private hudAlpha = 0;
  private orbit = 0.6;
  private echoVersion = -1;
  private clearFrom = 0;
  private offers: UpgradeId[] = [];
  private refitFocus = 0;
  private overShown = false;
  private creakT = 0;
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
    this.screens = new Screens(document.body);
    this.screens.onPick = (i) => this.pick(i);
    this.scene.add(this.terrain.mesh, this.actors.group, this.pingFx.group);

    this.input = new Input(this.renderer.domElement);
    this.input.onAction((a) => this.onAction(a));
    this.input.onClick = () => {
      this.audio.init();
      if (this.state === 'title' && this.stateTime > 0.6) this.startDive(newSeed());
    };
    this.audio.setMuted(load<boolean>('muted', false));

    window.addEventListener('resize', () => this.resize());
    const autoPause = () => {
      if (this.state === 'dive' && !this.paused) this.setPaused(true);
    };
    document.addEventListener('visibilitychange', () => document.hidden && autoPause());
    window.addEventListener('blur', autoPause);
    this.resize();
    this.applyTheme(this.theme);
    this.demo();
  }

  start(): void {
    this.renderer.compile(this.scene, this.overview);
    requestAnimationFrame(() => {
      this.screens.hideLoading();
      this.screens.showTitle(true, this.best);
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
    this.chase.resize(this.w / this.h);
    this.overview.aspect = this.w / this.h;
    this.overview.updateProjectionMatrix();
  }

  private applyTheme(name: ThemeName): void {
    this.theme = name;
    const t = THEMES[name];
    shared.uBg.value.set(t.bg);
    shared.uInk.value.set(t.ink);
    this.renderer.setClearColor(t.bg);
    this.actors.syncColors();
    this.pingFx.syncColors();
    this.hud.syncColors();
    document.documentElement.dataset.theme = name;
  }

  /** Make `w` the world on screen: upload its seafloor and bind its echo arrays. */
  private setWorld(w: World): void {
    this.world = w;
    fieldData.set(w.sector.field.h);
    fieldTexture.needsUpdate = true;
    bindEcho(w.echo.own, w.echo.enemy, w.echo.charted);
    this.echoVersion = w.echo.version;
    shared.uLayer.value = w.layerY;
    shared.uFade.value = w.fade;
    this.known.clear();
    this.chase.snap();
    this.chase.yawOffset = 0;
  }

  /** Title background: a sub feeling its way along a sector, pinging as it goes. */
  private demo(): void {
    const w = new World(buildSector(7, 2), applyAll([]), { hull: 100, battery: 100, decoys: 0 });
    this.demoBot = new Bot();
    this.demoPing = 0.8;
    this.setWorld(w);
  }

  private startDive(seed: number): void {
    this.audio.init();
    this.audio.ui();
    this.dive = new Dive(seed);
    this.level = 1;
    this.chartOpen = false;
    this.overShown = false;
    this.setWorld(this.dive.world());
    this.state = 'dive';
    this.stateTime = 0;
    this.screens.showTitle(false);
    this.screens.showOver(false);
    this.screens.toast(`DIVE ${diveNo(seed)} · SECTOR 01`);
  }

  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.screens.showPause(p);
    if (p) this.audio.suspend();
    else {
      this.audio.resume();
      this.last = performance.now();
    }
  }

  private toTitle(): void {
    this.setPaused(false);
    this.state = 'title';
    this.stateTime = 0;
    this.dive = null;
    this.screens.showOver(false);
    this.screens.showRefit(false);
    this.screens.showClear(false);
    this.screens.showTitle(true, this.best);
    this.audio.engine(0, 0, false);
    this.demo();
  }

  // ------------------------------------------------------------ input

  private onAction(a: Action): void {
    if (a === 'mute') {
      this.audio.init();
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
      if (a === 'back' || a === 'confirm') this.setPaused(false);
      else if (a === 'retry') this.toTitle();
      return;
    }
    switch (this.state) {
      case 'title':
        if (a === 'confirm' && this.stateTime > 0.6) this.startDive(newSeed());
        break;
      case 'dive':
        if (a === 'confirm') this.pendingPing = 'omni';
        else if (a === 'cone') this.pendingPing = this.world.mods.cone ? 'cone' : 'omni';
        else if (a === 'decoy') this.pendingDecoy = true;
        else if (a === 'faster') this.level = Math.min(3, this.level + 1);
        else if (a === 'slower') this.level = Math.max(0, this.level - 1);
        else if (a === 'chart') this.chartOpen = !this.chartOpen;
        else if (a === 'back') this.setPaused(true);
        break;
      case 'refit':
        if (typeof a === 'object' && 'pick' in a) this.pick(a.pick);
        else if (a === 'next' || a === 'prev') {
          this.refitFocus = (this.refitFocus + (a === 'next' ? 1 : this.offers.length - 1)) % this.offers.length;
          this.screens.focusRefit(this.refitFocus);
        } else if (a === 'confirm' && this.stateTime > 0.4) this.pick(this.refitFocus);
        break;
      case 'over':
        if (this.stateTime < 1.2) break;
        if (a === 'confirm') this.startDive(newSeed());
        else if (a === 'retry' && this.dive) this.startDive(this.dive.seed);
        else if (a === 'back') this.toTitle();
        break;
    }
  }

  private pick(i: number): void {
    if (this.state !== 'refit' || !this.dive || i < 0 || i >= this.offers.length) return;
    const id = this.offers[i];
    this.audio.ui();
    this.dive.choose(id);
    this.screens.showRefit(false);
    this.setWorld(this.dive.world());
    this.state = 'dive';
    this.stateTime = 0;
    this.screens.toast(`${upgradeById(id).ja} · SECTOR ${String(this.dive.index).padStart(2, '0')}`);
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
    this.time += dt;
    shared.uTime.value = this.time;
    const w = this.world;

    if (this.state === 'title') {
      // the demo boat follows its route and pings every few seconds
      this.demoPing -= dt;
      const c = this.demoBot.controls(w, dt);
      c.level = 1;
      if (this.demoPing <= 0) {
        c.ping = 'omni';
        this.demoPing = 3.4;
      }
      w.step(dt, c);
      if (w.status !== 'running' || w.t > 240) this.demo();
    } else if (this.state === 'dive') {
      const ev = w.step(dt, {
        level: this.level,
        turn: this.input.turn,
        climb: this.input.climb,
        ping: this.pendingPing,
        decoy: this.pendingDecoy,
      });
      this.pendingPing = null;
      this.pendingDecoy = false;
      this.handle(ev);
      const sub = w.sub;
      const clear = sub.y - floorAt(w.floor, sub.x, sub.z) - SUB.radius;
      this.audio.proximity(clear, dt);
      this.audio.engine(Math.min(sub.level, sub.maxLevel), sub.speed, true);
      this.creakT -= dt;
      if (this.creakT <= 0) {
        this.creakT = 6 + Math.random() * 10;
        if (sub.hull < 50 || -sub.y > 220) this.audio.creak();
      }
    } else if (this.state === 'clear') {
      const k = easeInOutCubic(clamp01(this.stateTime / 2.2));
      this.screens.setClearDepth(this.clearFrom + k * 140);
      if (this.stateTime > 2.6 && this.dive) {
        this.dive.close(w);
        this.offers = this.dive.offers();
        this.refitFocus = 0;
        const d = this.dive;
        this.screens.showClear(false);
        this.screens.showRefit(
          true,
          this.offers.map(upgradeById),
          d.index + 1,
          `HULL ${Math.ceil(d.hull)} / ${d.mods.hullMax} · BATTERY ${Math.floor(d.battery)} / ${Math.round(d.mods.batteryMax)} · ${d.totals.sectors} SECTORS`,
        );
        this.state = 'refit';
        this.stateTime = 0;
      }
    } else if (this.state === 'over') {
      if (!this.overShown && this.stateTime > 2.2 && this.dive) {
        this.overShown = true;
        const d = this.dive;
        const prev = this.best;
        const better = !prev || d.totals.sectors > prev.sectors || (d.totals.sectors === prev.sectors && d.totals.maxDepth > prev.depth);
        if (better) {
          this.best = { sectors: d.totals.sectors, depth: d.totals.maxDepth, surveys: d.totals.surveys };
          save('best', this.best);
        }
        const t = THEMES[this.theme];
        this.screens.showOver(true, { seed: d.seed, totals: d.totals, logs: d.logs, best: this.best!, newBest: better, ink: t.css[0], bg: t.css[1] });
      }
    }

    // echo textures only re-upload when the echo grid changed
    if (w.echo.version !== this.echoVersion) {
      this.echoVersion = w.echo.version;
      echoOwnTexture.needsUpdate = true;
      echoEnemyTexture.needsUpdate = true;
      chartTexture.needsUpdate = true;
    }
    shared.uNow.value = w.t;
    shared.uSub.value.set(w.sub.x, w.sub.y, w.sub.z);
    shared.uMemory.value = this.state === 'title' ? 0 : 1;
    shared.uProx.value = this.state === 'title' ? 0 : 26;
    this.chartT += ((this.chartOpen && this.state === 'dive' ? 1 : 0) - this.chartT) * damp(9, dt);
    const showHud = this.state === 'dive';
    this.hudAlpha = clamp01(this.hudAlpha + (showHud ? dt : -dt) * 2.5);
    if (this.state !== 'dive') this.audio.engine(0, 0, false);

    // cameras
    if (this.state === 'title') {
      this.orbit += dt * 0.07;
      const s = w.sub;
      const r = 150;
      this.overview.position.set(s.x + Math.sin(this.orbit) * r, s.y + 95, s.z + Math.cos(this.orbit) * r);
      this.overview.lookAt(s.x, s.y - 10, s.z);
      shared.uFogDist.value = 420;
    } else {
      this.chase.dragging = this.input.dragging;
      const [lx, ly] = this.input.takeLook();
      if (this.input.dragging) this.chase.look(lx, ly);
      const s = w.sub;
      this.chase.update(s.x, s.y, s.z, s.heading, w.floor, dt, this.time);
      shared.uFogDist.value = 240;
    }
    this.actors.update(w, this.state === 'title' ? this.overview.position : this.chase.camera.position, true);
    this.pingFx.update(w);
  }

  /** Turn world events into sound, effects and messages. */
  private handle(events: WorldEvent[]): void {
    const w = this.world;
    const sub = w.sub;
    const panOf = (x: number, z: number) => {
      const brg = Math.atan2(x - sub.x, -(z - sub.z));
      return Math.max(-1, Math.min(1, Math.sin(brg - sub.heading)));
    };
    let splashed = false;
    for (const e of events) {
      switch (e.type) {
        case 'ping':
          if (e.ping.kind === 'own') {
            this.audio.ping(!!e.ping.dir);
            this.audio.ret(0.7);
          } else if (e.contact) {
            const k = e.contact;
            const d = Math.hypot(k.x - sub.x, k.y - sub.y, k.z - sub.z);
            this.audio.enemyPing(panOf(k.x, k.z), clamp01(1 - d / 400));
            if (!this.known.has(k.id)) this.screens.toast(`${KIND_JA[k.kind]}のソナー — 位置を海図に記録`);
            this.known.set(k.id, { x: k.x, z: k.z, t: w.t, kind: k.kind });
          }
          break;
        case 'heard':
          this.audio.heard();
          if (w.threat !== 'hunt') this.screens.toast(`${KIND_JA[e.contact.kind]}が音を聞きつけた — 捜索が始まる`);
          break;
        case 'relay':
          this.audio.heard();
          this.screens.toast('聴音ブイが音を拾った');
          break;
        case 'detected':
          this.audio.detected();
          this.screens.toast(`${KIND_JA[e.contact.kind]}に探知された — 動け`);
          break;
        case 'lost':
          if (w.threat === 'none') this.screens.toast('相手はこちらを見失った');
          break;
        case 'launch':
          if (e.weapon.kind === 'charge' && !splashed) {
            splashed = true;
            this.audio.splash(panOf(e.weapon.x, e.weapon.z));
            this.screens.toast('爆雷投下 — 深さを変えろ');
          } else if (e.weapon.kind === 'torpedo') this.screens.toast('魚雷 — 地形の陰へ');
          break;
        case 'blast': {
          const close = clamp01(1 - e.dist / 160);
          this.audio.blast(close, panOf(e.x, e.z));
          this.chase.shake = Math.max(this.chase.shake, close * 1.6);
          if (e.damage > 0) {
            this.screens.invertFlash();
            this.screens.toast(`被弾 −${Math.round(e.damage)}`);
          }
          break;
        }
        case 'impact':
          this.audio.impact(e.speed);
          this.chase.shake = Math.max(this.chase.shake, Math.min(1.2, e.speed * 0.15));
          this.screens.toast(`衝突 −${Math.round(e.speed * SUB.impactDamage)}`);
          break;
        case 'survey':
          this.audio.survey();
          this.screens.toast(`測点を記録 · ${e.survey.kind === 'wreck' ? '沈没船' : e.survey.kind === 'vent' ? '熱水噴出孔' : '海山頂'} · 電池 +`);
          break;
        case 'spot':
          if (e.what === 'exit') this.screens.toast('降下口を確認 — 海溝へ潜れ');
          else if (e.what === 'mine') this.screens.toast('機雷を探知');
          break;
        case 'decoy':
          this.screens.toast('囮を放った');
          break;
        case 'cleared':
          this.audio.cleared();
          this.clearFrom = -sub.y;
          this.state = 'clear';
          this.stateTime = 0;
          this.chartOpen = false;
          this.screens.showClear(true, this.dive?.index ?? 1);
          this.screens.setClearDepth(this.clearFrom);
          break;
        case 'crushed':
          this.audio.crushed();
          this.screens.invertFlash();
          this.chase.shake = 2;
          this.dive?.close(w);
          this.state = 'over';
          this.stateTime = 0;
          this.chartOpen = false;
          break;
      }
    }
  }

  // ------------------------------------------------------------ render

  private render(): void {
    const r = this.renderer;
    r.setViewport(0, 0, this.w, this.h);
    r.clear();
    const cam = this.state === 'title' ? this.overview : this.chase.camera;
    const clearCovers = this.state === 'clear' && this.stateTime > 0.6;
    if (!clearCovers) r.render(this.scene, cam);

    this.hud.begin();
    if (this.state === 'title') this.hud.corners(clamp01(this.stateTime - 0.3));
    if (this.hudAlpha > 0 && this.dive) {
      const info = { world: this.world, dive: this.dive, known: this.known, chartT: this.chartT };
      this.hud.dive(info, this.hudAlpha, this.time, cam, this.actors.labels);
      const f = this.hud.chartFrame(this.world, this.chartT);
      f.opacity = this.hudAlpha;
      this.chart.render(r, f, this.h);
      this.hud.chartOverlay(f, info, 1, this.time);
    }
  }
}
