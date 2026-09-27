export type Action = 'confirm' | 'back' | 'map' | 'mode' | 'mute' | 'theme' | 'retry' | 'next' | 'prev' | 'up' | 'down' | { sheet: number };

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Keyboard state, one-shot actions and mouse look (pointer lock, or drag as a fallback). */
export class Input {
  private readonly down = new Set<string>();
  private readonly listeners: Array<(a: Action) => void> = [];
  lookX = 0;
  lookY = 0;
  locked = false;
  private dragging = false;
  crouchToggle = false;
  onClick: (() => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouchToggle = !this.crouchToggle;
      const a = this.actionFor(e.code);
      if (a) this.listeners.forEach((l) => l(a));
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.dragging = false;
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === target));
    target.addEventListener('pointerdown', (e) => {
      this.onClick?.();
      if (!this.locked) {
        this.dragging = true;
        target.setPointerCapture?.(e.pointerId);
      }
    });
    target.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (this.locked || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    try {
      const p = this.target.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    } catch {
      /* pointer lock unavailable: drag to look instead */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
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

  /** Movement axes relative to the camera: forward, right. */
  get axes(): [number, number] {
    const f = (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    return [f, r];
  }

  get sprint(): boolean {
    return this.isDown('ShiftLeft', 'ShiftRight');
  }

  private actionFor(code: string): Action | null {
    if (/^Digit[1-8]$/.test(code)) return { sheet: Number(code.slice(5)) };
    switch (code) {
      case 'Space':
      case 'Enter':
        return 'confirm';
      case 'Escape':
        return 'back';
      case 'KeyM':
      case 'Tab':
        return 'map';
      case 'KeyG':
        return 'mode';
      case 'KeyN':
        return 'mute';
      case 'KeyT':
        return 'theme';
      case 'KeyR':
        return 'retry';
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
