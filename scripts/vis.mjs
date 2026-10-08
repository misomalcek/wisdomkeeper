import { serve, launch } from './harness.mjs';
import path from 'node:path';
const server = await serve(path.resolve('dist'));
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto('http://127.0.0.1:4173/?debug&scale=1&noadapt');
await wait(800);
const hideHud = () => page.evaluate(() => { for (const id of ['banner','subtitle']) document.getElementById(id).style.display = 'none'; });

// A: river
await page.evaluate(() => { const g = window.__wk; g.debugGoto(1); g.god = true; g.ui.clearSay(); });
await wait(1500); await hideHud();
await page.evaluate(() => { const g = window.__wk; const R = g.world.radius; g.debugAt(-14, 0); g.debugStep(40); g.player.aim = Math.PI / 2; });
await wait(2500);
await shot('qa-river');

// B: enemies in canopy
await page.evaluate(() => { const g = window.__wk; g.debugGoto(2); g.god = true; g.ui.clearSay(); });
await wait(1500); await hideHud();
await page.evaluate(() => {
  const g = window.__wk; const p = g.player;
  g.spawnEnemy('mite', p.x + 5, p.z - 3, false); g.spawnEnemy('mite', p.x - 6, p.z - 2, false);
  g.spawnEnemy('spitter', p.x + 9, p.z - 8, false); g.spawnEnemy('brute', p.x - 9, p.z - 9, false);
  g.debugStep(75);
  // fire a few bolts / plant echoes for the shot
  p.res = 100; g.plantEcho(p.x + 3, p.z + 4, 'manual'); g.plantEcho(p.x - 4, p.z + 5, 'manual'); g.plantEcho(p.x + 7, p.z + 2, 'manual');
  g.debugStep(90);
});
await wait(2500);
await shot('qa-enemies');

// C: boss
await page.evaluate(() => { const g = window.__wk; g.debugGoto(3); g.god = true; g.ui.clearSay(); });
await wait(1500); await hideHud();
await page.evaluate(() => { const g = window.__wk; g.debugAt(0, 20); g.debugStep(150); });
await wait(2500);
await shot('qa-boss');
console.log(logs.join('\n') || 'no console errors');
await browser.close(); server.close();
