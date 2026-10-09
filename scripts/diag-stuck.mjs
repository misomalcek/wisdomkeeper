import { newSession } from './bot.mjs';
const { page, logs, close } = await newSession();
const r = await page.evaluate(() => {
  const g = window.__wk;
  g.debugGoto(2); g.debugStep(30); g.god = true;
  const trace = [];
  for (let t = 0; t < 30 * 60 * 4; t++) {
    if (g.mode === 'play') window.__bot.think({ skill: 0.8 });
    g.debugStep(1);
    if (g.mode === 'choice') { if (g.ui.isOpen('binary')) g.ui.binaryKey('purify'); else g.ui.choiceKey(0); }
    if (t % (30 * 30) === 0) {
      const o = g.objectivePoint(); const p = g.player;
      trace.push({ min: +(t / 1800).toFixed(1), pos: [p.x | 0, p.z | 0], mode: p.mode, obj: o && [o.x | 0, o.z | 0], dObj: o && Math.round(Math.hypot(o.x - p.x, o.z - p.z)), nodes: g.world.nodes.map(n => n.state), camps: g.debugCamps.map(c => c.cleared), enemies: g.enemies.length, idle: g.enemies.filter(e => e.idle).length, kills: g.run.kills, shots: g.stats.shots, hits: g.stats.hits, bot: { ...window.__bot.stats }, near: (() => { let b=null,d=1e9; for (const e of g.enemies){ if(e.dead) continue; const dd=Math.hypot(e.x-p.x,e.z-p.z); if(dd<d){d=dd;b=e;} } return b && [b.kind, Math.round(d), b.idle, Math.round(b.y - g.world.terrain.heightAt(b.x,b.z))]; })(), res: Math.round(p.res), y: +(p.y - g.world.terrain.heightAt(p.x, p.z)).toFixed(1) });
    }
  }
  return { trace, nodes: g.world.nodes.map(n => [n.pos.x | 0, n.pos.z | 0, +g.world.terrain.slopeAt(n.pos.x, n.pos.z).toFixed(2)]), camps: g.debugCamps.map(c => [c.spec.x | 0, c.spec.z | 0, c.spec.kind, c.cleared]), R: g.world.radius };
});
console.log(JSON.stringify(r, null, 0).replace(/\},\{/g, '},\n{'));
console.log(logs.join('\n') || 'no console errors');
await close();
