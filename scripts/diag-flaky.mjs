import { newSession } from './bot.mjs';
const { page, logs, close } = await newSession();
const r = await page.evaluate(() => {
  const g = window.__wk; const out = [];
  for (let k = 0; k < 8; k++) {
    g.debugGoto(1); g.debugStep(20); g.debugClearCamps(); g.debugStep(5);
    const p = g.player, t = g.world.terrain;
    p.res = 100;
    g.input.press('Space'); g.debugStep(8); g.debugStep(60);
    const m0 = p.mode;
    g.input.press('KeyV'); g.debugStep(2); const m1 = p.mode;
    g.cam.pitch = -0.25; g.input.touchMove.set(0, -1); const y0 = p.y; const gh0 = t.heightAt(p.x, p.z); g.debugStep(60); g.input.touchMove.set(0, 0);
    out.push({ k, m0, m1, climbed: +(p.y - y0).toFixed(1), aboveGround: +(p.y - t.heightAt(p.x, p.z)).toFixed(1), res: Math.round(p.res), pos: [p.x | 0, p.z | 0], mode: p.mode, gh0: +gh0.toFixed(1), river: +t.riverAt(p.x, p.z).toFixed(2) });
  }
  return out;
});
for (const o of r) console.log(JSON.stringify(o));
console.log(logs.join('\n') || 'no console errors');
await close();
