export type Action =
  | 'confirm'
  | 'back'
  | 'undo'
  | 'reset'
  | 'rotateLeft'
  | 'rotateRight'
  | 'view'
  | 'mute'
  | 'theme'
  | 'brushUp'
  | 'brushDown'
  | 'next'
  | 'prev'
  | 'up'
  | 'down'
  | { stage: number };

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Keyboard actions plus mouse state for sculpting. */
export class Input {
  private readonly listeners: Array<(a: Action) => void> = [];
  private readonly down = new Set<string>();
  /** CSS px */
  mouseX = -1;
  mouseY = -1;
  hover = false;
  /** 0 = none, 1 = raise (left), 2 = cut (right or shift+left) */
  pressed: 0 | 1 | 2 = 0;
  wheel = 0;
  onPress: ((mode: 1 | 2) => void) | null = null;
  onRelease: (() => void) | null = null;
  onClick: ((x: number, y: number) => void) | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      if (e.repeat && !['BracketLeft', 'BracketRight'].includes(e.code)) return;
      const a = this.actionFor(e);
      if (a) this.listeners.forEach((l) => l(a));
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.release();
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.hover = true;
    });
    target.addEventListener('pointerleave', () => (this.hover = false));
    target.addEventListener('pointerdown', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.hover = true;
      this.onClick?.(e.clientX, e.clientY);
      if (e.button !== 0 && e.button !== 2) return;
      target.setPointerCapture?.(e.pointerId);
      this.pressed = e.button === 2 || e.shiftKey ? 2 : 1;
      this.onPress?.(this.pressed);
    });
    const up = () => this.release();
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  private release(): void {
    if (this.pressed) {
      this.pressed = 0;
      this.onRelease?.();
    }
  }

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  private actionFor(e: KeyboardEvent): Action | null {
    if (/^Digit[0-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      return { stage: n === 0 ? 10 : n };
    }
    switch (e.code) {
      case 'Space':
      case 'Enter':
        return 'confirm';
      case 'Escape':
        return 'back';
      case 'KeyZ':
        return 'undo';
      case 'KeyR':
        return 'reset';
      case 'KeyQ':
        return 'rotateLeft';
      case 'KeyE':
        return 'rotateRight';
      case 'KeyV':
      case 'Tab':
        return 'view';
      case 'KeyM':
        return 'mute';
      case 'KeyT':
        return 'theme';
      case 'BracketRight':
        return 'brushUp';
      case 'BracketLeft':
        return 'brushDown';
      case 'ArrowRight':
        return 'next';
      case 'ArrowLeft':
        return 'prev';
      case 'ArrowUp':
        return 'up';
      case 'ArrowDown':
        return 'down';
      default:
        return null;
    }
  }
}
