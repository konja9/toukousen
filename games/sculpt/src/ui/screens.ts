import type { Stage } from '../sim/stages';
import { drawThumb } from './thumbs';

const pad = (n: number, len: number) => String(Math.max(0, Math.floor(n))).padStart(len, '0');
export const sheetNo = (id: number) => pad(id, 2);

export function starsFor(strokes: number, par: number): number {
  if (strokes <= par) return 3;
  if (strokes <= par + 2) return 2;
  return 1;
}

const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export type FailReason = 'stuck' | 'sunk' | 'out' | 'timeout' | 'unsurveyed';

const FAIL_TEXT: Record<FailReason, [string, string]> = {
  stuck: ['STUCK', '球が止まった'],
  timeout: ['STUCK', '球が止まった'],
  sunk: ['SUNK', '水に沈んだ'],
  out: ['OUT', '模型の外へ落ちた'],
  unsurveyed: ['UNSURVEYED', '水準点を通っていない'],
};

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

/** DOM overlays: title, stage select, clear/fail, loading and screen effects. */
export class Screens {
  private readonly title: HTMLElement;
  private readonly select: HTMLElement;
  private readonly result: HTMLElement;
  private readonly fail: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly cards: HTMLButtonElement[] = [];
  private toastTimer = 0;
  onPick: ((id: number) => void) | null = null;

  constructor(root: HTMLElement, private readonly stages: Stage[]) {
    root.appendChild(el('<div class="fx-vignette"></div>'));
    const grain = el('<div class="fx-grain"></div>');
    grain.style.setProperty('--grain-url', `url(${grainTexture()})`);
    root.appendChild(grain);

    this.title = el(`
      <section class="screen title">
        <div class="top">
          <div class="eyebrow rv" style="--d:.1">TOUKOUSEN &nbsp;/&nbsp; SERIES 02</div>
          <div class="eyebrow rv" style="--d:.2"><span data-k="cleared">0</span> / ${stages.length} SHEETS</div>
        </div>
        <div class="block">
          <div class="eyebrow rv" style="--d:.35">CUT &amp; FILL PUZZLE</div>
          <h1>
            <span class="jp rv" style="--d:.5">等高線</span>
            <span class="en rv" style="--d:.75">SCULPT</span>
          </h1>
          <div class="rule rv" style="--d:1.0"></div>
          <p class="tag rv" style="--d:1.1">盛って、削って、転がす。<span>Cut, fill, and let it roll.</span></p>
          <div class="cta rv" style="--d:1.35"><span class="blink"><kbd>SPACE</kbd> / CLICK TO START</span></div>
          <p class="narrow rv" style="--d:1.5">マウスとキーボードで遊ぶゲームです。PC の広い画面で開いてください。</p>
        </div>
        <div class="rules rv" style="--d:1.5">
          <h2>HOW TO PLAY</h2>
          <ul>
            <li>地形をいじって斜面をつくり、球をゴールの穴へ転がす。</li>
            <li>土は増えも減りもしない。盛るには、どこかを削って土を得る。</li>
            <li>白く光る線は球と同じ高さの等高線。水に入ると沈み、点描の岩盤は動かせない。</li>
            <li>少ない手数（ドラッグ回数）ほど ★ が増える。</li>
          </ul>
          <div class="keys">
            <span>左ドラッグ</span><span>盛土（土を積む）</span>
            <span>右ドラッグ</span><span>切土（土を削る）<kbd>SHIFT</kbd>+左でも</span>
            <span>ホイール</span><span>ブラシの大きさ</span>
            <span><kbd>SPACE</kbd></span><span>球を放す / 止める　<kbd>F</kbd> 早送り</span>
            <span><kbd>Z</kbd> <kbd>R</kbd></span><span>ひとつ戻す / 最初から</span>
            <span><kbd>Q</kbd> <kbd>E</kbd> <kbd>V</kbd></span><span>回転 / 真上から</span>
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
          <div class="eyebrow"><span data-k="cleared">0</span> / ${stages.length} CLEARED</div>
        </header>
        <div class="grid"></div>
        <footer>
          <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
          <span><kbd>ENTER</kbd> 開く</span>
          <span><kbd>1</kbd>–<kbd>0</kbd> 番号で開く</span>
          <span><kbd>ESC</kbd> タイトル</span>
          <span><kbd>T</kbd> 夜 / 紙</span>
        </footer>
      </section>`);
    const grid = this.select.querySelector('.grid')!;
    for (const st of stages) {
      const card = el<HTMLButtonElement>(`
        <button class="card" type="button" data-id="${st.id}">
          <canvas width="220" height="220"></canvas>
          <div class="meta"><span class="no">SHEET ${sheetNo(st.id)}</span><span class="stars" data-k="stars">☆☆☆</span></div>
          <div class="name">${st.name}</div>
          <div class="meta"><span class="ja">${st.nameJa}</span><span class="best" data-k="best">PAR ${st.par}</span></div>
        </button>`);
      card.addEventListener('click', () => this.onPick?.(st.id));
      this.cards.push(card);
      grid.appendChild(card);
    }

    this.result = el(`
      <section class="screen result">
        <div class="inner">
          <div class="eyebrow">SHEET <span data-k="sheet">00</span> &nbsp;/&nbsp; <span data-k="name"></span></div>
          <div class="word">HOLE OUT</div>
          <div class="stars"><i style="--i:0">☆</i><i style="--i:1">☆</i><i style="--i:2">☆</i></div>
          <div class="line">STROKES <span data-k="strokes">0</span> &nbsp;/&nbsp; PAR <span data-k="par">0</span> &nbsp;·&nbsp; SOIL MOVED <span data-k="soil">0</span> m³</div>
          <div class="cta">
            <span><kbd>SPACE</kbd> 次の図葉へ</span>
            <span><kbd>R</kbd> もう一度</span>
            <span><kbd>ESC</kbd> 一覧</span>
          </div>
        </div>
      </section>`);

    this.fail = el(`
      <section class="screen fail">
        <div class="pill"><b data-k="word">STUCK</b><span data-k="ja">球が止まった</span></div>
      </section>`);

    this.loading = el('<section class="screen loading show"><div class="rings"><i></i><i></i><i></i></div></section>');
    this.toastEl = el('<div class="toast"></div>');
    root.append(this.title, this.select, this.result, this.fail, this.loading, this.toastEl);
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

  showTitle(on: boolean, cleared = 0): void {
    this.set(this.title, 'cleared', String(cleared));
    this.toggle(this.title, on);
  }

  /** Redraw thumbnails (theme changes) and progress. */
  refreshSelect(best: Record<number, number>, ink: string, bg: string): void {
    let cleared = 0;
    this.stages.forEach((st, i) => {
      const card = this.cards[i];
      drawThumb(card.querySelector('canvas')!, st, ink, bg);
      const b = best[st.id];
      if (b !== undefined) {
        cleared++;
        this.set(card, 'stars', starText(starsFor(b, st.par)));
        this.set(card, 'best', `BEST ${b} / PAR ${st.par}`);
      } else {
        this.set(card, 'stars', '☆☆☆');
        this.set(card, 'best', `PAR ${st.par}`);
      }
    });
    this.set(this.select, 'cleared', String(cleared));
    this.set(this.title, 'cleared', String(cleared));
  }

  showSelect(on: boolean, focus = 0): void {
    this.toggle(this.select, on);
    if (on) this.focusCard(focus);
  }

  focusCard(i: number): void {
    this.cards.forEach((c, k) => c.classList.toggle('focus', k === i));
    this.cards[i]?.scrollIntoView({ block: 'nearest' });
  }

  showResult(stage: Stage, strokes: number, soilMoved: number): void {
    const r = this.result;
    this.set(r, 'sheet', sheetNo(stage.id));
    this.set(r, 'name', `${stage.name} ${stage.nameJa}`);
    this.set(r, 'strokes', String(strokes));
    this.set(r, 'par', String(stage.par));
    this.set(r, 'soil', String(Math.round(soilMoved)));
    const n = starsFor(strokes, stage.par);
    r.querySelectorAll('.stars i').forEach((s, i) => (s.textContent = i < n ? '★' : '☆'));
    this.toggle(r, true);
  }

  hideResult(): void {
    this.toggle(this.result, false);
  }

  showFail(reason: FailReason | null): void {
    if (reason) {
      const [w, ja] = FAIL_TEXT[reason];
      this.set(this.fail, 'word', w);
      this.set(this.fail, 'ja', ja);
    }
    this.toggle(this.fail, reason !== null);
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
