import { newSession } from './bot.mjs';
let ok = true;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) ok = false; };

// ---- 1. max-tier perks run without errors and actually do things
for (const aff of ['root', 'echo', 'flow']) {
  const { page, logs, close } = await newSession();
  const r = await page.evaluate((aff) => {
    const g = window.__wk; g.debugGoto(2); g.debugStep(30);
    g.run.tiers[aff] = 3; g.player.applyAffinityLook(g);
    const out = { turretShots: 0, slowed: 0, hpGain: 0 };
    // plant a few echoes then fight
    g.player.res = 100;
    for (let i = 0; i < 5; i++) g.plantEcho(g.player.x + (i - 2) * 4, g.player.z + 5, 'manual');
    for (let i = 0; i < 6; i++) g.spawnEnemy('mite', g.player.x + 10 + i, g.player.z - 8, false);
    g.spawnEnemy('spitter', g.player.x - 10, g.player.z - 8, false); g.spawnEnemy('brute', g.player.x + 6, g.player.z - 12, false);
    g.debugStep(60);
    g.player.hp = 50;
    let maxBolts = 0;
    for (let t = 0; t < 30 * 20; t++) {
      window.__bot.think({ skill: 0.5 });
      if (t === 40) { g.player.res = 100; g.input.press('KeyQ'); }
      g.debugStep(1);
      maxBolts = Math.max(maxBolts, g.projectiles.count);
      if (g.enemies.some(e => e.slowT > 0 && e.slowF < 0.5)) out.slowed++;
      if (g.mode === 'dead') { g.debugStep(30); g.reseed(); }
    }
    out.hpEnd = g.player.hp; out.kills = g.run.kills; out.maxBolts = maxBolts;
    out.sentinels = g.world.grove.echoes.filter(e => e.sentinel).length;
    return out;
  }, aff);
  check(`tier-3 ${aff}: no console errors`, logs.length === 0, logs.join(' | '));
  check(`tier-3 ${aff}: combat works`, r.kills > 0, JSON.stringify(r));
  if (aff === 'flow') check('flow II surge slows enemies', r.slowed > 0);
  await close();
}

// ---- 2. death -> reseed via the real UI
{
  const { page, logs, close } = await newSession();
  await page.evaluate(() => { window.__wk.debugGoto(1); window.__wk.debugStep(30); });
  await page.evaluate(() => { const g = window.__wk; g.player.hp = 1; g.player.invuln = 0; g.hurtPlayer(50, g.player.x, g.player.z); });
  await page.evaluate(() => window.__wk.debugStep(90));
  const shown = await page.evaluate(() => !document.getElementById('death').classList.contains('hidden'));
  check('death overlay appears', shown);
  await page.click('#btn-reseed');
  const st = await page.evaluate(() => ({ mode: window.__wk.mode, hp: window.__wk.player.hp, deaths: window.__wk.run.deaths }));
  check('reseed restores play', st.mode === 'play' && st.hp > 90 && st.deaths === 1, JSON.stringify(st));
  check('death flow: no console errors', logs.length === 0, logs.join(' | '));
  await close();
}

// ---- 3. save -> reload -> continue
{
  const { page, logs, close } = await newSession();
  await page.evaluate(() => { const g = window.__wk; g.debugGoto(1); g.run.tiers.flow = 1; g.run.maxHp = 120; g.debugStep(10); g.saveRun?.(); });
  await page.evaluate(() => window.__wk['saveRun']());
  await page.reload();
  await page.waitForTimeout(800);
  const vis = await page.evaluate(() => !document.getElementById('btn-continue').classList.contains('hidden'));
  check('continue button shown after reload', vis);
  await page.click('#btn-continue');
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ s: window.__wk.def.id, tiers: window.__wk.run.tiers, maxHp: window.__wk.run.maxHp, mode: window.__wk.mode }));
  check('continue restores stratum + build', st.s === 'river' && st.tiers.flow === 1 && st.maxHp === 120 && st.mode === 'play', JSON.stringify(st));
  check('continue: no console errors', logs.length === 0, logs.join(' | '));
  await close();
}

// ---- 4. new cycle from the ending screen
{
  const { page, logs, close } = await newSession();
  await page.evaluate(() => { const g = window.__wk; g.debugGoto(4); g.debugStep(30); g.player.x = g.world.nodes[0].pos.x + 2; g.player.z = g.world.nodes[0].pos.z; g.input.press('KeyE'); g.debugStep(2); });
  await page.waitForTimeout(4200);
  const shown = await page.evaluate(() => window.__wk.debugStep(5) ?? !document.getElementById('ending').classList.contains('hidden'));
  check('ending overlay shown', shown === true || shown === undefined);
  const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('wk.library.v1') || '[]').length);
  check('story saved to library', lib === 1, `entries=${lib}`);
  await page.evaluate(() => { document.getElementById('btn-newcycle').click(); });
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => window.__wk.run.cycle);
  check('new cycle increments', c === 2, `cycle=${c}`);
  check('cycle flow: no console errors', logs.length === 0, logs.join(' | '));
  await close();
}
console.log(ok ? '\nALL SYSTEM CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
