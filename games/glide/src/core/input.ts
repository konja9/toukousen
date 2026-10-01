export type Action = 'start' | 'retry' | 'pause' | 'mute' | 'theme' | 'invert' | 'title' | 'prev' | 'next';

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Keyboard state + one-shot action events. */
export class Input {
  private readonly down = new Set<string>();
  private readonly listeners: Array<(a: Action) => void> = [];
  invertPitch = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      const action = this.actionFor(e.code);
      if (action) this.listeners.forEach((l) => l(action));
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  private actionFor(code: string): Action | null {
    switch (code) {
      case 'Space':
      case 'Enter':
        return 'start';
      case 'KeyR':
        return 'retry';
      case 'Escape':
      case 'KeyP':
        return 'pause';
      case 'KeyM':
        return 'mute';
      case 'KeyT':
        return 'theme';
      case 'KeyY':
        return 'invert';
      case 'KeyQ':
        return 'title';
      // these also steer; the game only takes them as actions on the title screen
      case 'ArrowLeft':
      case 'KeyA':
        return 'prev';
      case 'ArrowRight':
      case 'KeyD':
        return 'next';
      default:
        return null;
    }
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  get pitch(): number {
    const up = this.any('KeyW', 'ArrowUp') ? 1 : 0;
    const dn = this.any('KeyS', 'ArrowDown') ? 1 : 0;
    const v = up - dn;
    return this.invertPitch ? -v : v;
  }

  get roll(): number {
    return (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0);
  }

  get brake(): boolean {
    return this.any('ShiftLeft', 'ShiftRight');
  }
}
