import { easeOutExpo } from '../core/tween';

const pad = (n: number, len: number) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** m:ss.s and a signed difference like "−0.9". */
export const splitText = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
export const deltaText = (d: number) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(1)}`;

function missionItems(list: MissionView[]): string {
  return list
    .map((m) => `<li class="${m.done ? 'done' : ''}${m.fresh ? ' fresh' : ''}"><i></i>${esc(m.label)}${m.fresh ? '<b>NEW</b>' : ''}</li>`)
    .join('');
}

export const fmt = {
  score: (n: number) => pad(n, 7),
  sheet: (n: number) => pad(n, 4),
  km: (m: number) => `${(m / 1000).toFixed(2)} km`,
  time: (s: number) => `${pad(s / 60, 2)}:${pad(s % 60, 2)}`,
};

export interface MissionView {
  label: string;
  done: boolean;
  /** Completed during this run (not before). */
  fresh?: boolean;
}

export interface TitleData {
  sheet: number;
  best: number;
  missions: MissionView[];
  medals: number;
}

export interface ResultData {
  cause: 'crash' | 'timeup';
  sectors: number;
  nearMisses: number;
  missions: MissionView[];
  /** Sector times, with the difference to the best before this run (null when none). */
  splits: Array<{ time: number; delta: number | null }>;
  sheet: number;
  score: number;
  best: boolean;
  distance: number;
  time: number;
  maxSpeed: number;
  minAGL: number;
  gatesPassed: number;
  gatesTotal: number;
  bestChain: number;
}

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

/** DOM overlays: title, pause, result, loading, and screen effects. */
export class Screens {
  private readonly title: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly result: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private countRaf = 0;

  constructor(root: HTMLElement) {
    root.appendChild(el('<div class="fx-vignette"></div>'));
    const grain = el('<div class="fx-grain"></div>');
    grain.style.setProperty('--grain-url', `url(${grainTexture()})`);
    root.appendChild(grain);

    this.title = el(`
      <section class="screen title">
        <div class="top">
          <div class="eyebrow rv" style="--d:.1">TOUKOUSEN &nbsp;/&nbsp; SHEET <span data-k="sheet">0000</span></div>
          <div class="eyebrow rv" style="--d:.2">BEST &nbsp;<span data-k="best">0000000</span></div>
        </div>
        <div class="block">
          <div class="eyebrow rv" style="--d:.35">TOPOGRAPHIC FLIGHT</div>
          <h1>
            <span class="jp rv" style="--d:.5">等高線</span>
            <span class="en rv" style="--d:.75">CONTOUR GLIDE</span>
          </h1>
          <div class="rule rv" style="--d:1.0"></div>
          <p class="tag rv" style="--d:1.1">線を読め。低く飛べ。遠くへ。<span>Read the lines. Stay low. Fly far.</span></p>
          <div class="cta rv" style="--d:1.35"><span class="blink"><kbd>SPACE</kbd> / CLICK TO FLY</span></div>
          <div class="missions rv" style="--d:1.5">
            <div class="head"><span>SHEET <span data-k="sheet">0000</span> の課題</span><span class="medals">MEDALS ◆ <span data-k="medals">0</span></span></div>
            <ul data-k="missions"></ul>
            <div class="hint"><kbd>←</kbd><kbd>→</kbd> 地図を変える</div>
          </div>
          <p class="narrow rv" style="--d:1.5">キーボードで操作するゲームです。PC の広い画面で遊んでください。</p>
        </div>
        <div class="rules rv" style="--d:1.5">
          <h2>HOW TO READ</h2>
          <ul>
            <li>白く光る線は、いまの自機と同じ高さの等高線。その内側（斜線）はあなたより高い地形。</li>
            <li>2 km ごとのチェックポイントで残り時間が増える。0 になると TIME UP。</li>
            <li>風上の斜面には上昇風、風下には下降風。気流の筋の傾きと昇降計の音で分かる。</li>
            <li>地面すれすれほどスコア倍率が上がる（最大 ×4）。リングを連続で抜けると CHAIN と加速。</li>
            <li>降下で加速、上昇で減速。速度は高度に、高度は速度に。</li>
          </ul>
          <div class="keys">
            <span><kbd>W</kbd><kbd>S</kbd></span><span>上昇 / 降下（<kbd>↑</kbd><kbd>↓</kbd>）</span>
            <span><kbd>A</kbd><kbd>D</kbd></span><span>旋回（<kbd>←</kbd><kbd>→</kbd>）</span>
            <span><kbd>SHIFT</kbd></span><span>エアブレーキ</span>
            <span><kbd>ESC</kbd></span><span>ポーズ　<kbd>M</kbd> 音　<kbd>T</kbd> 反転　<kbd>Y</kbd> 上下操作反転</span>
          </div>
        </div>
      </section>`);

    this.pause = el(`
      <section class="screen pause">
        <div class="inner">
          <div class="eyebrow">一時停止</div>
          <div class="word">PAUSED</div>
          <div class="keys">
            <span><kbd>ESC</kbd></span><span>再開</span>
            <span><kbd>R</kbd></span><span>同じ地図でやり直す</span>
            <span><kbd>Q</kbd></span><span>タイトルへ</span>
          </div>
        </div>
      </section>`);

    this.result = el(`
      <section class="screen result">
        <div class="panel">
          <div class="eyebrow rv" style="--d:.1"><span class="cause" data-k="cause">CRASH</span> FLIGHT LOG &nbsp;/&nbsp; SHEET <span data-k="sheet">0000</span></div>
          <div class="score rv" style="--d:.2" data-k="score">0000000</div>
          <div class="newbest rv" style="--d:.9" data-k="newbest" hidden>NEW BEST</div>
          <dl class="rv" style="--d:.45">
            <dt>DISTANCE<small>距離</small></dt><dd data-k="distance"></dd>
            <dt>SECTORS<small>通過区間</small></dt><dd data-k="sectors"></dd>
            <dt>TIME<small>飛行時間</small></dt><dd data-k="time"></dd>
            <dt>MAX SPEED<small>最高速度</small></dt><dd data-k="speed"></dd>
            <dt>LOWEST PASS<small>最低対地高度</small></dt><dd data-k="agl"></dd>
            <dt>GATES<small>通過 · 最大連続</small></dt><dd data-k="gates"></dd>
            <dt>NEAR MISS<small>ニアミス</small></dt><dd data-k="near"></dd>
          </dl>
          <div class="missions rv" style="--d:.6">
            <div class="head"><span>課題</span></div>
            <ul data-k="missions"></ul>
          </div>
          <div class="splits rv" style="--d:.7" data-k="splits"></div>
          <div class="cta rv" style="--d:.8">
            <span><kbd>SPACE</kbd> 新しい地図へ</span>
            <span><kbd>R</kbd> 同じ地図で再挑戦</span>
            <span><kbd>Q</kbd> タイトル</span>
          </div>
        </div>
      </section>`);

    this.loading = el('<section class="screen loading show"><div class="rings"><i></i><i></i><i></i></div></section>');
    this.flash = el('<div class="fx-flash"></div>');
    this.toastEl = el('<div class="toast"></div>');
    root.append(this.title, this.pause, this.result, this.loading, this.flash, this.toastEl);
  }

  private set(scope: HTMLElement, key: string, text: string): void {
    scope.querySelectorAll<HTMLElement>(`[data-k="${key}"]`).forEach((n) => (n.textContent = text));
  }

  private toggle(s: HTMLElement, on: boolean): void {
    if (on && !s.classList.contains('show')) {
      // restart CSS reveal animations
      s.classList.remove('show');
      void s.offsetWidth;
    }
    s.classList.toggle('show', on);
  }

  hideLoading(): void {
    this.toggle(this.loading, false);
  }

  showTitle(d: TitleData): void {
    this.set(this.title, 'sheet', fmt.sheet(d.sheet));
    this.set(this.title, 'best', fmt.score(d.best));
    this.set(this.title, 'medals', String(d.medals));
    (this.title.querySelector('[data-k="missions"]') as HTMLElement).innerHTML = missionItems(d.missions);
    this.toggle(this.title, true);
  }

  hideTitle(): void {
    this.toggle(this.title, false);
  }

  showPause(on: boolean): void {
    this.toggle(this.pause, on);
  }

  showResult(d: ResultData): void {
    const r = this.result;
    this.set(r, 'sheet', fmt.sheet(d.sheet));
    this.set(r, 'distance', fmt.km(d.distance));
    this.set(r, 'time', fmt.time(d.time));
    this.set(r, 'speed', `${Math.round(d.maxSpeed * 3.6)} km/h`);
    this.set(r, 'agl', Number.isFinite(d.minAGL) ? `${Math.max(d.minAGL, 0).toFixed(1)} m` : '—');
    this.set(r, 'gates', `${d.gatesPassed} / ${d.gatesTotal}  ·  ×${d.bestChain}`);
    this.set(r, 'cause', d.cause === 'timeup' ? 'TIME UP' : 'CRASH');
    this.set(r, 'sectors', String(d.sectors));
    this.set(r, 'near', String(d.nearMisses));
    (r.querySelector('[data-k="missions"]') as HTMLElement).innerHTML = missionItems(d.missions);
    (r.querySelector('[data-k="splits"]') as HTMLElement).innerHTML = d.splits.length
      ? `<div class="head">SECTOR TIMES<small>区間タイム</small></div><ol>${d.splits
          .map(
            (sp, i) =>
              `<li><span>${String(i + 1).padStart(2, '0')}</span>${splitText(sp.time)}${
                sp.delta === null ? '' : `<em class="${sp.delta < 0 ? 'better' : ''}">${deltaText(sp.delta)}</em>`
              }</li>`,
          )
          .join('')}</ol>`
      : '';
    (r.querySelector('[data-k="newbest"]') as HTMLElement).hidden = !d.best;
    this.set(r, 'score', fmt.score(0));
    this.toggle(r, true);

    cancelAnimationFrame(this.countRaf);
    const t0 = performance.now() + 350;
    const tick = (now: number) => {
      const t = Math.min(Math.max((now - t0) / 1600, 0), 1);
      this.set(r, 'score', fmt.score(d.score * easeOutExpo(t)));
      if (t < 1) this.countRaf = requestAnimationFrame(tick);
    };
    this.countRaf = requestAnimationFrame(tick);
  }

  hideResult(): void {
    cancelAnimationFrame(this.countRaf);
    this.toggle(this.result, false);
  }

  /** Brief screen inversion. */
  invertFlash(): void {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1400);
  }
}

function grainTexture(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
