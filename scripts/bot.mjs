// Headless gameplay bot + simulation runner. Drives the real game logic through Game.debugStep().
import { serve, launch } from './harness.mjs';
import path from 'node:path';

export const BOT_SRC = `
(() => {
  const g = window.__wk;
  const V = g.player.group.position.constructor;
  const tmp = new V();
  window.__bot = {
    // returns nothing; sets input for one tick
    think(opts = {}) {
      const p = g.player, inp = g.input;
      inp.lastDevice = 'mouse';
      let best = null, bd = 1e9;
      for (const e of g.enemies) { if (e.dead || e.spawnT < 1 || (e.kind === 'boss' && !e.activated && false)) continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
      // aim
      if (best) {
        const sk = opts.skill ?? 1;
        // human-ish aim: noise grows with distance, and the target is lagged a little
        const n = (1 - sk) * 4.5;
        tmp.set(best.x + (Math.random() - 0.5) * n, p.y, best.z + (Math.random() - 0.5) * n).project(g.gfx.camera);
        inp.mouse.set(tmp.x, tmp.y);
        inp.mouseLeft = bd < 34;
      } else inp.mouseLeft = false;
      // movement: stay inside the active node ring, kite nearby enemies
      let mx = 0, mz = 0;
      const enc = g.encounter;
      const node = g.world.nodes.find(n => n.state === 'active');
      if (node) { const dx = node.pos.x - p.x, dz = node.pos.z - p.z, d = Math.hypot(dx, dz); if (d > 7) { mx += dx / d; mz += dz / d; } }
      else if (opts.goal) { const dx = opts.goal.x - p.x, dz = opts.goal.z - p.z, d = Math.hypot(dx, dz); if (d > 3) { mx += dx / d; mz += dz / d; } }
      for (const e of g.enemies) {
        if (e.dead) continue;
        const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
        const sk2 = opts.skill ?? 1; const safe = (e.kind === 'boss' ? 13 : e.kind === 'brute' ? 9 : 5) * (0.5 + 0.5 * sk2);
        if (d < safe) { const w = (safe - d) / safe * 2.2; mx += dx / (d || 1) * w; mz += dz / (d || 1) * w; mx += -dz / (d||1) * 0.5; mz += dx / (d||1) * 0.5; }
      }
      // dodge bolts
      const l = Math.hypot(mx, mz) || 1;
      inp.touchMove.set(mx / Math.max(l, 1), mz / Math.max(l, 1));
      if (best && bd < 3.5 && p.dashCD <= 0 && Math.random() < 0.3 * (opts.skill ?? 1)) inp.press('Space');
      if (p.res >= 100 && g.enemies.length >= 3) inp.press('KeyQ');
      if (p.hp <= 0) { /* dead handled by caller */ }
    },
  };
})();
`;

export async function newSession(query = '?debug&scale=0.5&nobloom', size = { width: 640, height: 360 }) {
  const server = await serve(path.resolve('dist'));
  const { browser, page, logs } = await launch(size);
  await page.goto('http://127.0.0.1:4173/' + query);
  await page.waitForTimeout(600);
  await page.evaluate(BOT_SRC);
  return { server, browser, page, logs, close: async () => { await browser.close(); server.close(); } };
}
