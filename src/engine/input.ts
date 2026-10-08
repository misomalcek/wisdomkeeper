import { Vector2 } from 'three';

/** Keyboard + mouse + touch, collapsed into one polling-friendly state object. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  readonly mouse = new Vector2(0, 0); // NDC
  mouseLeft = false;
  mouseRight = false;
  mouseMoved = false;
  /** Touch controls (virtual sticks), -1..1. */
  touchMove = new Vector2();
  touchAim = new Vector2();
  touchFire = false;
  touchActive = false;
  /** Set when the player last used touch vs. mouse, so aim logic picks the right one. */
  lastDevice: 'mouse' | 'touch' = 'mouse';
  private onAnyKey?: () => void;

  attach(target: HTMLElement, onAnyKey?: () => void) {
    this.onAnyKey = onAnyKey;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.onAnyKey?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseLeft = this.mouseRight = false;
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.lastDevice = 'mouse';
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.mouseMoved = true;
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.lastDevice = 'mouse';
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) {
        this.mouseRight = true;
        this.pressed.add('MouseRight');
      }
      this.onAnyKey?.();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  press(code: string) {
    this.pressed.add(code);
  }
  endFrame() {
    this.pressed.clear();
  }

  moveVector(out: Vector2): Vector2 {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    x += this.touchMove.x;
    y += this.touchMove.y;
    out.set(x, y);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  get firing() {
    return this.mouseLeft || this.touchFire || this.isDown('KeyJ');
  }
}
