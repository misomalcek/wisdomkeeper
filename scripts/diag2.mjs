import { serve, launch } from './harness.mjs';
import path from 'node:path';
const server = await serve(path.resolve('dist'));
const { browser, page, logs } = await launch({ width: 960, height: 540 });
await page.goto('http://127.0.0.1:4173/?debug&scale=0.5&nobloom');
await page.waitForTimeout(800);
await page.evaluate(() => window.__wk.debugGoto(0));
await page.waitForTimeout(2000);
await page.evaluate(() => { const g = window.__wk; g.debugAt(g.world.nodes[0].pos.x + 3, g.world.nodes[0].pos.z + 3); g.god = true; });
await page.keyboard.press('KeyE');
await page.waitForTimeout(14000);
const info = await page.evaluate(() => {
  const g = window.__wk; const p = g.player;
  return {
    aim: p.aim, fire: g.input.firing, mouse: [g.input.mouse.x, g.input.mouse.y], last: g.input.lastDevice,
    player: [p.x, p.z, p.y], dead: p.dead, mode: g.mode, paused: g.paused,
    enemies: g.enemies.map(e => ({ k: e.kind, x: +e.x.toFixed(1), z: +e.z.toFixed(1), spawn: e.spawnT, hp: e.hp, state: e.state })),
    bolts: g.projectiles.count,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close(); server.close();
