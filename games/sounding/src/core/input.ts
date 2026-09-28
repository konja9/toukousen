export type Action = 'confirm' | 'back' | 'chart' | 'cone' | 'decoy' | 'mute' | 'theme' | 'retry' | 'faster' | 'slower' | 'next' | 'prev' | { pick: number };

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Keyboard state, one-shot actions, and mouse dragging for the camera. */
export class Input {
  private readonly down = new Set<string>();
  private readonly listeners: Array<(a: Action) => void> = [];
  lookX = 0;
  lookY = 0;
  dragging = false;
  onClick: (() => void) | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      if (e.repeat) return;
      const a = this.actionFor(e.code);
      if (a) this.listeners.forEach((l) => l(a));
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.dragging = false;
    });
    target.addEventListener('pointerdown', (e) => {
      this.onClick?.();
      this.dragging = true;
      target.setPointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointerup', () => (this.dragging = false));
    target.addEventListener('pointercancel', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  takeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  /** Rudder: -1 port .. 1 starboard. */
  get turn(): number {
    return (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
  }

  /** Planes: 1 rise .. -1 dive. */
  get climb(): number {
    return (this.isDown('KeyQ', 'PageUp') ? 1 : 0) - (this.isDown('KeyE', 'PageDown') ? 1 : 0);
  }

  private actionFor(code: string): Action | null {
    if (/^Digit[1-3]$/.test(code)) return { pick: Number(code.slice(5)) - 1 };
    switch (code) {
      case 'Space':
      case 'Enter':
        return 'confirm';
      case 'Escape':
        return 'back';
      case 'KeyM':
      case 'Tab':
        return 'chart';
      case 'KeyF':
        return 'cone';
      case 'KeyX':
        return 'decoy';
      case 'KeyN':
        return 'mute';
      case 'KeyT':
        return 'theme';
      case 'KeyR':
        return 'retry';
      case 'KeyW':
      case 'ArrowUp':
        return 'faster';
      case 'KeyS':
      case 'ArrowDown':
        return 'slower';
      case 'ArrowRight':
        return 'next';
      case 'ArrowLeft':
        return 'prev';
      default:
        return null;
    }
  }
}
