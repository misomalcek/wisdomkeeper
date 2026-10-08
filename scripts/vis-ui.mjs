import { serve, launch } from './harness.mjs';
import { chromium } from 'playwright-core';
import path from 'node:path';
const server = await serve(path.resolve('dist'));
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
await page.goto('http://127.0.0.1:4173/?debug&scale=0.6&nobloom');
await wait(1500);
await page.evaluate(() => window.__wk.debugGoto(1));
await wait(1200);
// make some history
await page.evaluate(() => {
  const g = window.__wk;
  g.run.history.push({ stratum: 'seedbed', stratumName: 'The Seedbed', kills: 17, echoes: 5, deaths: 1, time: 95, choice: { id: 'fusion', affinity: 'root', title: 'The Fusion of Roots and Silicon' }, mindNote: 'You strike first. The mycelium grew thorns where you will need them.' });
  g.run.tiers.root = 1; g.run.echoes.push({ x: 1, z: 1, affinity: 'root', stratum: 'seedbed', radius: 38 });
});
await page.keyboard.press('Escape'); await wait(800); await shot('ui-pause');
await page.keyboard.press('Escape'); await wait(300);
await page.keyboard.press('Tab'); await wait(800); await shot('ui-timeline');
await page.keyboard.press('Tab'); await wait(300);
await page.evaluate(() => { window.__wk.mode = 'dead'; window.__wk.ui.death('The Static takes a sentence. The soil keeps the rest.'); });
await wait(600); await shot('ui-death');
await page.evaluate(() => { window.__wk.ui.hide('death'); window.__wk.mode = 'play'; });
// ending
await page.evaluate(() => {
  const g = window.__wk;
  g.debugGoto(0);
});
await wait(500);
await page.evaluate(async () => {
  const mod = await import(new URL(document.querySelector('script[type=module][src*="index"]').src).href).catch(() => null);
});
await page.evaluate(() => {
  const g = window.__wk;
  const choices = [['fusion','root','The Fusion of Roots and Silicon'],['legacy','echo','The River of Legacy'],['alchemy','flow','The Alchemy of Time']];
  g.run.history = choices.map((c, i) => ({ stratum: ['seedbed','river','canopy'][i], stratumName: 'x', kills: 5, echoes: 3, deaths: 0, time: 60, choice: { id: c[0], affinity: c[1], title: c[2] } }));
  g.run.tiers = { root: 1, echo: 1, flow: 1 };
  g.run.kills = 120; g.run.elapsed = 812;
  g.finishGame();
});
await wait(15000); await shot('ui-ending');
await page.evaluate(() => { window.__wk.toTitle(); });
await wait(1000);
await page.click('#btn-library'); await wait(500); await shot('ui-library');
await page.keyboard.press('Escape'); await wait(200);
await page.click('#btn-controls'); await wait(500); await shot('ui-controls');
console.log(logs.join('\n') || 'no console errors');
await browser.close();

// mobile
const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b2.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const p2 = await ctx.newPage();
const logs2 = [];
p2.on('console', (m) => ['error','warning'].includes(m.type()) && logs2.push(m.text()));
p2.on('pageerror', (e) => logs2.push(e.message));
await p2.goto('http://127.0.0.1:4173/?debug&scale=0.6&nobloom');
await p2.waitForTimeout(3000);
await p2.screenshot({ path: 'shots/mob-title.png' });
await p2.evaluate(() => { window.__wk.debugGoto(1); });
await p2.waitForTimeout(6500);
await p2.screenshot({ path: 'shots/mob-play.png' });
await p2.evaluate(() => { const g = window.__wk; g.debugCompleteNodes(); g.debugAt(g.world.gate.pos.x - 2, g.world.gate.pos.z); g.ui.hide('banner'); });
await p2.waitForTimeout(1500);
await p2.evaluate(() => { window.__wk.input.press('KeyE'); });
await p2.waitForTimeout(2500);
await p2.screenshot({ path: 'shots/mob-choice.png' });
console.log('mobile', logs2.join('\n') || 'no console errors');
await b2.close(); server.close();
