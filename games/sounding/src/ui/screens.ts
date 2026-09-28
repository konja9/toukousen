import type { SectorLog, DiveTotals } from '../sim/run';
import type { Upgrade } from '../sim/upgrades';
import { diveNo, fmtTime } from './hud';
import { drawLog } from './thumbs';

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const two = (n: number) => String(n).padStart(2, '0');

export interface Best {
  sectors: number;
  depth: number;
  surveys: number;
}

/** DOM overlays: title, pause, sector clear, refit choice, dive log. */
export class Screens {
  private readonly title: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly clear: HTMLElement;
  private readonly refit: HTMLElement;
  private readonly over: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private cards: HTMLButtonElement[] = [];
  private toastTimer = 0;
  onPick: ((i: number) => void) | null = null;

  constructor(root: HTMLElement) {
    root.appendChild(el('<div class="fx-vignette"></div>'));
    const grain = el('<div class="fx-grain"></div>');
    grain.style.setProperty('--grain-url', `url(${grainTexture()})`);
    root.appendChild(grain);

    this.title = el(`
      <section class="screen title">
        <div class="top">
          <div class="eyebrow rv" style="--d:.1">TOUKOUSEN &nbsp;/&nbsp; SERIES 04</div>
          <div class="eyebrow rv" style="--d:.2" data-k="best">NO DIVES YET</div>
        </div>
        <div class="block">
          <div class="eyebrow rv" style="--d:.35">SONAR ROGUELIKE</div>
          <h1>
            <span class="jp rv" style="--d:.5">等高線</span>
            <span class="en rv" style="--d:.75">SOUNDING</span>
          </h1>
          <div class="rule rv" style="--d:1.0"></div>
          <p class="tag rv" style="--d:1.1">音で測れ。聞かれる前に。<span>Sound it out. Before they hear you.</span></p>
          <div class="cta rv" style="--d:1.35"><span class="blink"><kbd>SPACE</kbd> / CLICK TO DIVE</span></div>
          <p class="narrow rv" style="--d:1.5">マウスとキーボードで遊ぶゲームです。PC の広い画面で開いてください。</p>
        </div>
        <div class="rules rv" style="--d:1.6">
          <h2>HOW TO PLAY</h2>
          <ul>
            <li>暗い海では何も見えない。<kbd>SPACE</kbd> でソナーを打つと、音が届いた海底に等深線が浮かぶ。</li>
            <li>ソナーの音は遠くまで聞こえる。哨戒艦に聞かれると捜索が始まり、相手のソナーに捉えられると爆雷が降ってくる。</li>
            <li>破線の等深線が「躍層」の深さ。その下にいると、上の音は届きにくい。深い谷筋が隠れ道。</li>
            <li>区画ごとに「降下口」（海溝）を探して潜る。潜るたびに改装を 1 つ選ぶ。船体が尽きたら終わり。</li>
          </ul>
          <div class="keys">
            <span><kbd>W</kbd><kbd>S</kbd></span><span>速力（停止・微速・半速・全速）</span>
            <span><kbd>A</kbd><kbd>D</kbd></span><span>転舵</span>
            <span><kbd>Q</kbd><kbd>E</kbd></span><span>浮上 / 潜航（押している間）</span>
            <span><kbd>SPACE</kbd></span><span>ソナー</span>
            <span><kbd>M</kbd></span><span>海図を広げる（時間は止まらない）</span>
            <span><kbd>ESC</kbd></span><span>一時停止 &nbsp; <kbd>T</kbd> 夜/紙 &nbsp; <kbd>N</kbd> 音</span>
          </div>
        </div>
      </section>`);

    this.pause = el(`
      <section class="screen pausebox">
        <div>
          <div class="eyebrow" style="text-align:center">PAUSED</div>
          <div class="word">一時停止</div>
          <div class="cta" style="display:flex;gap:18px;justify-content:center;font-family:var(--jp);letter-spacing:.06em;color:var(--ink-2)">
            <span><kbd>ESC</kbd> 再開</span><span><kbd>R</kbd> 潜航をやめてタイトルへ</span>
          </div>
        </div>
      </section>`);

    this.clear = el(`
      <section class="screen clearbox">
        <div class="inner">
          <div class="eyebrow">SECTOR <span data-k="n">01</span> CLEAR · 区画通過</div>
          <div class="depth"><span data-k="depth">0</span><small>m</small></div>
          <div class="eyebrow">DESCENDING · 降下中</div>
        </div>
      </section>`);

    this.refit = el(`
      <section class="screen refit">
        <div class="inner">
          <div class="eyebrow">REFIT · 改装 — SECTOR <span data-k="next">02</span> へ</div>
          <h2>改装を 1 つ選ぶ</h2>
          <p class="state" data-k="state"></p>
          <div class="cards"></div>
          <p class="hint"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> または <kbd>←</kbd><kbd>→</kbd> と <kbd>SPACE</kbd>、クリックでも選べます</p>
        </div>
      </section>`);
    this.cardsEl = this.refit.querySelector('.cards')!;

    this.over = el(`
      <section class="screen over">
        <div class="panel">
          <div class="eyebrow">DIVE <span data-k="dive">#0000</span> · LOG 航海記録</div>
          <div class="word">圧壊</div>
          <p class="sub">船体が水圧に耐えられなかった。</p>
          <dl>
            <dt>SECTORS 通過区画</dt><dd data-k="sectors">0</dd>
            <dt>MAX DEPTH 最大深度</dt><dd data-k="depth">0 m</dd>
            <dt>SURVEYS 測点</dt><dd data-k="surveys">0</dd>
            <dt>PINGS ソナー</dt><dd data-k="pings">0</dd>
            <dt>DETECTED 探知された</dt><dd data-k="det">0</dd>
            <dt>TIME 潜航時間</dt><dd data-k="time">00:00</dd>
            <dt>BEST 記録</dt><dd data-k="best">—</dd>
          </dl>
          <div class="cta"><span><kbd>SPACE</kbd> 新しい海へ</span><span><kbd>R</kbd> 同じ海でもう一度</span><span><kbd>ESC</kbd> タイトル</span></div>
        </div>
        <div class="logs"></div>
      </section>`);

    this.loading = el('<section class="screen loading show"><div class="rings"><i></i><i></i><i></i></div></section>');
    this.toastEl = el('<div class="toast"></div>');
    this.flash = el('<div class="fx-flash" style="position:fixed;inset:0;pointer-events:none;background:#fff;mix-blend-mode:difference;opacity:0"></div>');
    root.append(this.title, this.pause, this.clear, this.refit, this.over, this.loading, this.toastEl, this.flash);
  }

  private set(scope: HTMLElement, key: string, text: string): void {
    scope.querySelectorAll<HTMLElement>(`[data-k="${key}"]`).forEach((n) => (n.textContent = text));
  }

  private toggle(s: HTMLElement, on: boolean): void {
    if (on && !s.classList.contains('show')) void s.offsetWidth;
    s.classList.toggle('show', on);
  }

  hideLoading(): void {
    this.toggle(this.loading, false);
  }

  showTitle(on: boolean, best?: Best | null): void {
    if (best) this.set(this.title, 'best', `BEST · ${two(best.sectors)} SECTORS · ${best.depth.toFixed(0)} m`);
    this.toggle(this.title, on);
  }

  showPause(on: boolean): void {
    this.toggle(this.pause, on);
  }

  showClear(on: boolean, sector = 1): void {
    if (on) this.set(this.clear, 'n', two(sector));
    this.toggle(this.clear, on);
  }

  setClearDepth(d: number): void {
    this.set(this.clear, 'depth', d.toFixed(0));
  }

  showRefit(on: boolean, offers: Upgrade[] = [], next = 2, state = ''): void {
    if (on) {
      this.set(this.refit, 'next', two(next));
      this.set(this.refit, 'state', state);
      this.cardsEl.innerHTML = '';
      this.cards = offers.map((u, i) => {
        const b = el<HTMLButtonElement>(`
          <button class="card" type="button">
            <span class="no">${i + 1}</span>
            <span class="name">${u.name}</span>
            <span class="ja">${u.ja}</span>
            <span class="desc">${u.desc}</span>
          </button>`);
        b.addEventListener('click', () => this.onPick?.(i));
        this.cardsEl.appendChild(b);
        return b;
      });
      this.focusRefit(0);
    }
    this.toggle(this.refit, on);
  }

  focusRefit(i: number): void {
    this.cards.forEach((c, k) => c.classList.toggle('focus', k === i));
  }

  showOver(on: boolean, d?: { seed: number; totals: DiveTotals; logs: SectorLog[]; best: Best; newBest: boolean; ink: string; bg: string }): void {
    if (on && d) {
      const o = this.over;
      this.set(o, 'dive', diveNo(d.seed));
      this.set(o, 'sectors', String(d.totals.sectors));
      this.set(o, 'depth', `${d.totals.maxDepth.toFixed(0)} m`);
      this.set(o, 'surveys', String(d.totals.surveys));
      this.set(o, 'pings', String(d.totals.pings));
      this.set(o, 'det', String(d.totals.detections));
      this.set(o, 'time', fmtTime(d.totals.time));
      this.set(o, 'best', `${two(d.best.sectors)} · ${d.best.depth.toFixed(0)} m${d.newBest ? '  NEW' : ''}`);
      const logs = o.querySelector('.logs')!;
      logs.innerHTML = '';
      d.logs.forEach((l, i) => {
        const fig = el(`<figure class="rv" style="--d:${0.3 + i * 0.12}"><canvas></canvas><figcaption>SECTOR ${two(l.index)} · ${l.cleared ? '通過' : '圧壊'}</figcaption></figure>`);
        drawLog(fig.querySelector('canvas')!, l, d.ink, d.bg);
        logs.appendChild(fig);
      });
    }
    this.toggle(this.over, on);
  }

  invertFlash(): void {
    const f = this.flash;
    f.style.animation = 'none';
    void f.offsetWidth;
    f.style.animation = 'flash 0.9s steps(1) forwards';
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 2200);
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
