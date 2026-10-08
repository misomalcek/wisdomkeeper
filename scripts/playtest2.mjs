// Full-loop smoke test: S0 fight -> node encounter -> gate -> choice -> transition -> S1
import { serve, launch } from './harness.mjs';
import path from 'node:path';
const server = await serve(path.resolve('dist'));
const { browser, page, logs } = await launch({ width: 1100, height: 620 });
const st = async () => JSON.stringify(await page.evaluate(() => window.__wk.debugState()));
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
// project nearest enemy to screen px
const target = () => page.evaluate(() => {
  const g = window.__wk; const V = g.player.group.position.constructor;
  let best = null, bd = 1e9;
  for (const e of g.enemies) { if (e.dead || e.spawnT < 1) continue; const d = (e.x - g.player.x) ** 2 + (e.z - g.player.z) ** 2; if (d < bd) { bd = d; best = e; } }
  if (!best) return null;
  const v = new V(best.x, best.y, best.z).project(g.gfx.camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
});
async function fightFor(ms) {
  const t0 = Date.now();
  await page.mouse.down();
  while (Date.now() - t0 < ms) {
    const t = await target();
    if (t) await page.mouse.move(t.x, t.y);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
}
await page.goto('http://127.0.0.1:4173/?debug&scale=0.5&nobloom');
await page.waitForTimeout(1000);
await page.evaluate(() => window.__wk.debugGoto(0));
await page.waitForTimeout(2500);
await page.evaluate(() => { const g = window.__wk; g.debugAt(g.world.nodes[0].pos.x + 3, g.world.nodes[0].pos.z + 3); g.god = true; });
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
for (let i = 0; i < 8; i++) {
  await fightFor(4000);
  console.log('t', i, await st());
  if (i === 2) await shot('enc-fight');
  const s = await page.evaluate(() => window.__wk.debugState());
  if (s.nodes[0] === 'done') break;
}
await shot('enc-after');
console.log('final', await st());
console.log(logs.join('\n') || 'no console errors');
await browser.close(); server.close();
