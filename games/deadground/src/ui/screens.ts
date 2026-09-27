import type { Course } from '../sim/course';
import { fmtTime } from './hud';
import { drawThumb } from './thumbs';

export type Mode = 'normal' | 'orienteering';

export interface Best {
  time: number;
  unseen: boolean;
}

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const sheetNo = (id: number) => String(id).padStart(2, '0');
const fmtPar = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** DOM overlays: title, sheet index, briefing bar, pause, caught label, result. */
export class Screens {
  private readonly title: HTMLElement;
  private readonly select: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly caught: HTMLElement;
  private readonly result: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly cards: HTMLButtonElement[] = [];
  private readonly modeButtons: HTMLButtonElement[] = [];
  private toastTimer = 0;
  onPick: ((id: number) => void) | null = null;
  onMode: ((m: Mode) => void) | null = null;

  constructor(root: HTMLElement, private readonly courses: Course[]) {
    root.appendChild(el('<div class="fx-vignette"></div>'));
    const grain = el('<div class="fx-grain"></div>');
    grain.style.setProperty('--grain-url', `url(${grainTexture()})`);
    root.appendChild(grain);

    this.title = el(`
      <section class="screen title">
        <div class="top">
          <div class="eyebrow rv" style="--d:.1">TOUKOUSEN &nbsp;/&nbsp; SERIES 03</div>
          <div class="eyebrow rv" style="--d:.2"><span data-k="cleared">0</span> / ${courses.length} SHEETS</div>
        </div>
        <div class="block">
          <div class="eyebrow rv" style="--d:.35">STEALTH ORIENTEERING</div>
          <h1>
            <span class="jp rv" style="--d:.5">等高線</span>
            <span class="en rv" style="--d:.75">DEAD GROUND</span>
          </h1>
          <div class="rule rv" style="--d:1.0"></div>
          <p class="tag rv" style="--d:1.1">見られずに、読んで、走れ。<span>Read the ground. Stay unseen. Run.</span></p>
          <div class="cta rv" style="--d:1.35"><span class="blink"><kbd>SPACE</kbd> / CLICK TO START</span></div>
          <p class="narrow rv" style="--d:1.5">マウスとキーボードで遊ぶゲームです。PC の広い画面で開いてください。</p>
        </div>
        <div class="rules rv" style="--d:1.5">
          <h2>HOW TO PLAY</h2>
          <ul>
            <li>地図の番号順にコントロール（旗）を回り、◎ のフィニッシュへ。タイムを競う。</li>
            <li>見張り塔の光が当たる斜線の地面に入ると見つかる。尾根の陰、谷の底が死角。</li>
            <li>立っていると頭が出る。伏せれば陰の中は安全。走ると足音が聞こえる。</li>
            <li>読図モードでは地図に現在地が出ない。方位と地形の形で位置を読む。</li>
          </ul>
          <div class="keys">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>移動（マウスで視点）</span>
            <span><kbd>SHIFT</kbd> <kbd>C</kbd></span><span>疾走 / 伏せ（切り替え）</span>
            <span><kbd>M</kbd></span><span>地図を開く・閉じる（時間は止まらない）</span>
            <span><kbd>ESC</kbd></span><span>一時停止　<kbd>T</kbd> 夜/紙　<kbd>N</kbd> 音</span>
          </div>
        </div>
      </section>`);

    this.select = el(`
      <section class="screen select">
        <header>
          <div>
            <div class="eyebrow">SHEET INDEX</div>
            <h2>SHEETS<small>図葉一覧</small></h2>
          </div>
          <div class="modes" role="group" aria-label="モード">
            <button type="button" data-mode="normal" aria-pressed="true">通常 · 現在地あり</button>
            <button type="button" data-mode="orienteering" aria-pressed="false">読図 · 現在地なし</button>
          </div>
        </header>
        <div class="grid"></div>
        <footer>
          <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
          <span><kbd>ENTER</kbd> 開く</span>
          <span><kbd>1</kbd>–<kbd>8</kbd> 番号で開く</span>
          <span><kbd>G</kbd> モード切替</span>
          <span><kbd>ESC</kbd> タイトル</span>
        </footer>
      </section>`);
    this.select.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => {
      this.modeButtons.push(b);
      b.addEventListener('click', () => this.onMode?.(b.dataset.mode as Mode));
    });
    const grid = this.select.querySelector('.grid')!;
    for (const c of courses) {
      const card = el<HTMLButtonElement>(`
        <button class="card" type="button">
          <canvas width="220" height="220"></canvas>
          <div class="meta"><span class="no">SHEET ${sheetNo(c.id)}</span><span class="stars" data-k="mark"></span></div>
          <div class="name">${c.name}</div>
          <div class="meta"><span class="ja">${c.nameJa}</span><span class="best" data-k="best">PAR ${fmtPar(c.par)}</span></div>
        </button>`);
      card.addEventListener('click', () => this.onPick?.(c.id));
      this.cards.push(card);
      grid.appendChild(card);
    }

    this.brief = el(`
      <section class="screen brief">
        <div class="bar">
          <span data-k="brief"></span>
          <span><kbd>SPACE</kbd> スタート</span>
          <span><kbd>ESC</kbd> 一覧へ</span>
        </div>
      </section>`);

    this.pause = el(`
      <section class="screen pausebox">
        <div>
          <div class="eyebrow" style="text-align:center">一時停止</div>
          <div class="word">PAUSED</div>
          <div class="keys">
            <span><kbd>ESC</kbd></span><span>再開</span>
            <span><kbd>R</kbd></span><span>スタートからやり直す</span>
            <span><kbd>Q</kbd></span><span>一覧へ戻る</span>
          </div>
        </div>
      </section>`);

    this.caught = el(`
      <section class="screen fail">
        <div class="pill"><b>SPOTTED</b><span data-k="ja">見つかった — 直前のコントロールへ戻る（+30 秒）</span></div>
      </section>`);

    this.result = el(`
      <section class="screen result side">
        <div class="inner left">
          <div class="eyebrow">FINISH &nbsp;/&nbsp; SHEET <span data-k="sheet">00</span></div>
          <div class="word" style="margin-left:0;letter-spacing:.2em;font-size:clamp(34px,4vw,50px)" data-k="time">00:00.0</div>
          <div class="unseen" data-k="unseen" hidden>UNSEEN · 一度も見つからなかった</div>
          <dl>
            <dt>RUN TIME</dt><dd data-k="raw"></dd>
            <dt>PENALTY</dt><dd data-k="pen"></dd>
            <dt>PAR</dt><dd data-k="par"></dd>
            <dt>BEST</dt><dd data-k="best"></dd>
            <dt>MODE</dt><dd data-k="mode"></dd>
          </dl>
          <div class="cta" style="justify-content:flex-start">
            <span><kbd>SPACE</kbd> 次の図葉へ</span>
            <span><kbd>R</kbd> もう一度</span>
            <span><kbd>ESC</kbd> 一覧</span>
          </div>
        </div>
      </section>`);

    this.loading = el('<section class="screen loading show"><div class="rings"><i></i><i></i><i></i></div></section>');
    this.toastEl = el('<div class="toast"></div>');
    this.flash = el('<div class="fx-flash" style="position:fixed;inset:0;pointer-events:none;background:#fff;mix-blend-mode:difference;opacity:0"></div>');
    root.append(this.title, this.select, this.brief, this.pause, this.caught, this.result, this.loading, this.toastEl, this.flash);
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

  showTitle(on: boolean): void {
    this.toggle(this.title, on);
  }

  refresh(best: Record<string, Best>, mode: Mode, ink: string, bg: string): void {
    let cleared = 0;
    this.courses.forEach((c, i) => {
      const card = this.cards[i];
      drawThumb(card.querySelector('canvas')!, c, ink, bg);
      const b = best[`${c.id}:${mode}`];
      if (b) cleared++;
      this.set(card, 'mark', b ? (b.unseen ? 'UNSEEN' : 'CLEAR') : '');
      this.set(card, 'best', b ? `BEST ${fmtTime(b.time)}` : `PAR ${fmtPar(c.par)}`);
    });
    this.modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    this.set(this.title, 'cleared', String(cleared));
  }

  showSelect(on: boolean, focus = 0): void {
    this.toggle(this.select, on);
    if (on) this.focusCard(focus);
  }

  /** Cards per row as laid out by the CSS grid. */
  get columns(): number {
    const top = this.cards[0]?.offsetTop ?? 0;
    return Math.max(1, this.cards.filter((c) => c.offsetTop === top).length);
  }

  focusCard(i: number): void {
    this.cards.forEach((c, k) => c.classList.toggle('focus', k === i));
    this.cards[i]?.scrollIntoView({ block: 'nearest' });
  }

  showBrief(on: boolean, text = ''): void {
    if (on) this.set(this.brief, 'brief', text);
    this.toggle(this.brief, on);
  }

  showPause(on: boolean): void {
    this.toggle(this.pause, on);
  }

  showCaught(on: boolean): void {
    this.toggle(this.caught, on);
  }

  showResult(on: boolean, d?: { course: Course; time: number; raw: number; penalties: number; best: number; unseen: boolean; mode: Mode; newBest: boolean }): void {
    if (on && d) {
      const r = this.result;
      this.set(r, 'sheet', sheetNo(d.course.id));
      this.set(r, 'time', fmtTime(d.time));
      this.set(r, 'raw', fmtTime(d.raw));
      this.set(r, 'pen', d.penalties ? `${d.penalties} × 30 s` : '—');
      this.set(r, 'par', fmtPar(d.course.par));
      this.set(r, 'best', fmtTime(d.best) + (d.newBest ? '  NEW' : ''));
      this.set(r, 'mode', d.mode === 'orienteering' ? '読図' : '通常');
      (r.querySelector('[data-k="unseen"]') as HTMLElement).hidden = !d.unseen;
    }
    this.toggle(this.result, on);
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
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1500);
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
