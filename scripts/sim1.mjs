import { newSession } from './bot.mjs';
const idx = Number(process.argv[2] ?? 0);
const secs = Number(process.argv[3] ?? 90);
const { page, logs, close } = await newSession();
const res = await page.evaluate(({ idx, secs }) => {
  const g = window.__wk; g.debugGoto(idx);
  g.debugStep(60);
  const out = []; let deaths = 0;
  const goalOf = () => g.world.gate ? { x: g.world.gate.pos.x, z: g.world.gate.pos.z } : { x: 0, z: 0 };
  for (let t = 0; t < secs * 30; t++) {
    window.__bot.think({ goal: goalOf() });
    // interact when possible
    if (t % 15 === 0) g.input.press('KeyE');
    g.debugStep(1);
    if (g.mode === 'dead') { deaths++; g.debugStep(60); g.reseed(); }
    if (t % (30 * 10) === 0) out.push({ t: t / 30, ...g.debugState() });
  }
  return { out, deaths, final: g.debugState() };
}, { idx, secs });
for (const o of res.out) console.log(JSON.stringify(o));
console.log('deaths', res.deaths, 'final', JSON.stringify(res.final));
console.log(logs.join('\n') || 'no console errors');
await close();
