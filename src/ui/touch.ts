import type { Input } from '../engine/input';

/** Two virtual sticks + three buttons. Writes straight into Input. */
export function setupTouch(input: Input, onFirstTouch: () => void) {
  const bind = (id: string, onMove: (x: number, y: number, active: boolean) => void) => {
    const el = document.getElementById(id)!;
    const knob = el.querySelector('i') as HTMLElement;
    let pid = -1;
    const upd = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2);
      let dy = (e.clientY - cy) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      onMove(dx, dy, true);
    };
    el.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      el.setPointerCapture(pid);
      input.lastDevice = 'touch';
      input.touchActive = true;
      onFirstTouch();
      upd(e);
    });
    el.addEventListener('pointermove', (e) => e.pointerId === pid && upd(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      knob.style.transform = '';
      onMove(0, 0, false);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  bind('stick-l', (x, y) => input.touchMove.set(x, y));
  bind('stick-r', (x, y, active) => {
    input.touchAim.set(x, y);
    input.touchFire = active && Math.hypot(x, y) > 0.25;
  });
  const tap = (id: string, code: string) =>
    document.getElementById(id)!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.lastDevice = 'touch';
      onFirstTouch();
      input.press(code);
    });
  tap('t-dash', 'TouchDash');
  tap('t-surge', 'KeyQ');
  tap('t-use', 'KeyE');
  tap('t-plant', 'KeyR');
  tap('t-pause', 'Escape');
}
