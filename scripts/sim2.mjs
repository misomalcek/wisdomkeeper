// Bot autoplays the whole game headlessly; reports per-stratum clear time, deaths, damage.
import { newSession } from './bot.mjs';
const picks = (process.argv[2] ?? '0,0,0').split(',').map(Number);
const skill = Number(process.argv[3] ?? 0.5);
const { page, logs, close } = await newSession();
const res = await page.evaluate(({ picks, skill }) => {
  const g = window.__wk;
  g.debugGoto(0); g.debugStep(60);
  const report = []; let pickI = 0;
  let lastDmg = 0, lastIdx = 0, t0 = 0, dmg0 = 0, death0 = 0, simT = 0, ended = false;
  const goalOf = () => {
    const nodes = g.world.nodes.filter(n => n.state !== 'done');
    if (nodes.length && !g.world.nodes.some(n => n.state === 'active')) return { x: nodes[0].pos.x, z: nodes[0].pos.z };
    if (g.world.gate && g.world.gate.group.visible && g.world.gate.wantOpen) return { x: g.world.gate.pos.x, z: g.world.gate.pos.z };
    if (g.def.id === 'mirror' && g.enemies.length) { const b = g.enemies.find(e => e.kind === 'boss'); return b ? { x: b.x * 0.4, z: b.z * 0.4 + 14 } : { x: 0, z: 14 }; }
    return { x: 0, z: 0 };
  };
  for (let t = 0; t < 30 * 60 * 14 && !ended; t++) {
    simT = t / 30;
    if (g.mode === 'play' || g.mode === 'dead') window.__bot.think({ goal: goalOf(), skill });
    if (t % 10 === 0) g.input.press('KeyE');
    if (g.mode === 'play' || g.mode === 'dead') lastDmg = g.stats.damageTaken;
    g.debugStep(1);
    if (g.mode === 'play' || g.mode === 'dead') lastDmg = Math.max(lastDmg, g.stats.damageTaken);
    if (g.mode === 'choice') { g.ui.choiceKey(picks[pickI++ % picks.length]); }
    if (g.mode === 'dead') { g.debugStep(60); g.reseed(); }
    if (g.mode === 'ending') { ended = true; }
    const idx = g.run.stratumIndex;
    if (g.mode !== 'transition' && idx !== lastIdx) {
      report.push({ stratum: g.def.id === 'return' ? 'mirror' : ['seedbed','river','canopy','mirror','return'][lastIdx], clearTime: +(simT - t0).toFixed(1), deaths: g.run.deaths - death0, damage: Math.round(lastDmg), kills: g.run.history.at(-1)?.kills, echoes: g.run.history.at(-1)?.echoes, diff: +g.diff.toFixed(2) });
      lastIdx = idx; t0 = simT; death0 = g.run.deaths;
    }
    if (g.mode === 'transition') g.debugStep(0);
  }
  return { report, simT, ended, mode: g.mode, stratum: g.def.id, run: { tiers: g.run.tiers, kills: g.run.kills, deaths: g.run.deaths, echoes: g.run.echoes.length, hist: g.run.history.map(h => h.mindNote) } };
}, { picks, skill });
console.log(JSON.stringify(res, null, 1));
console.log(logs.join('\n') || 'no console errors');
await close();
