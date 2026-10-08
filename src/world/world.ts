import * as THREE from 'three';
import type { RunState } from '../types';
import { STRATA, type Palette, type StratumDef } from '../story/strata';
import { Rng, hashString } from '../util/rng';
import { TAU } from '../util/math';
import { latentToParams } from '../systems/mind';
import { Terrain } from './terrain';
import { buildFlora, type Flora } from './flora';
import { Mycelium } from './mycelium';
import { FractalGate, MemoryNode } from './structures';
import { Motes, Sky } from './atmosphere';
import { EchoGrove } from '../entities/echoes';

function shiftPalette(p: Palette, hue: number): Palette {
  if (Math.abs(hue) < 0.001) return p;
  const out = { ...p };
  const tmp = { h: 0, s: 0, l: 0 };
  for (const k of ['skyHorizon', 'fog', 'groundBase', 'groundHigh', 'accent', 'accent2', 'river'] as const) {
    const c = new THREE.Color(p[k]);
    c.getHSL(tmp);
    c.setHSL((tmp.h + hue + 1) % 1, tmp.s, tmp.l);
    out[k] = c.getHex();
  }
  return out;
}

export class World {
  readonly group = new THREE.Group();
  readonly def: StratumDef;
  readonly radius: number;
  readonly palette: Palette;
  readonly terrain: Terrain;
  readonly flora: Flora;
  readonly mycelium: Mycelium;
  readonly grove: EchoGrove;
  readonly sky: Sky;
  readonly motes: Motes;
  readonly nodes: MemoryNode[] = [];
  readonly gate?: FractalGate;
  readonly startPos = new THREE.Vector3();
  readonly checkpoint = new THREE.Vector3();
  readonly rng: Rng;
  /** Where the boss arena's gate will appear. */
  readonly gateXZ = new THREE.Vector2();

  constructor(def: StratumDef, run: RunState) {
    this.def = def;
    const params = def.id === 'return' ? latentToParams([0, 0, 0, 0]) : latentToParams(run.latent);
    this.radius = def.radius * params.arenaScale;
    this.palette = shiftPalette(def.palette, def.id === 'return' ? 0 : params.hueShift);
    const baseSeed = hashString(`${run.seed}:${def.id === 'return' ? 'seedbed' : def.id}`);
    this.rng = new Rng(baseSeed ^ 0x51ed);
    const rng = this.rng;

    this.terrain = new Terrain({
      radius: this.radius,
      amp: def.terrain.amp * params.ruggedness,
      freq: def.terrain.freq,
      river: def.terrain.river,
      seed: baseSeed,
      palette: this.palette,
      grid: def.id === 'mirror' ? 0.9 : def.id === 'return' ? 0.35 : 0.65,
    });
    this.group.add(this.terrain.mesh);

    // ---- layout -----------------------------------------------------------------
    const R = this.radius;
    const axis = def.id === 'river' ? 0 : rng.range(0, TAU);
    const ax = new THREE.Vector2(Math.cos(axis), Math.sin(axis));
    const perp = new THREE.Vector2(-ax.y, ax.x);
    const at = (t: number, lateral = 0) => new THREE.Vector2().addScaledVector(ax, t * R).addScaledVector(perp, lateral * R);
    const startXZ = def.boss ? at(-0.78) : at(-0.74);
    const gateXZ = def.boss ? new THREE.Vector2(0, 0) : at(0.78);
    this.gateXZ.copy(gateXZ);
    this.startPos.set(startXZ.x, this.terrain.heightAt(startXZ.x, startXZ.y), startXZ.y);
    this.checkpoint.copy(this.startPos);

    const nodeXZ: THREE.Vector2[] = [];
    if (def.nodes === 1) nodeXZ.push(new THREE.Vector2(0, 0));
    else if (def.nodes > 1) {
      for (let i = 0; i < def.nodes; i++) {
        for (let tries = 0; tries < 60; tries++) {
          const t = -0.35 + (0.9 / (def.nodes - 1)) * i * 0.85 + rng.range(-0.08, 0.08);
          const lat = (i % 2 === 0 ? 1 : -1) * rng.range(0.22, 0.4);
          const p = at(t, lat);
          if (p.length() > R * 0.82) continue;
          if (this.terrain.riverAt(p.x, p.y) > 0.02) continue;
          if (nodeXZ.some((q) => q.distanceTo(p) < 20)) continue;
          nodeXZ.push(p);
          break;
        }
      }
      // Fallback if rejection sampling starved
      while (nodeXZ.length < def.nodes) nodeXZ.push(at(-0.3 + 0.3 * nodeXZ.length, 0.3 * (nodeXZ.length % 2 ? -1 : 1)));
    }

    const avoid = [
      { x: startXZ.x, z: startXZ.y, r: 6 },
      { x: gateXZ.x, z: gateXZ.y, r: 8 },
      ...nodeXZ.map((p) => ({ x: p.x, z: p.y, r: 5 })),
    ];
    this.flora = buildFlora(def, this.terrain, rng.fork('flora'), params.floraDensity, avoid);
    this.group.add(this.flora.group);

    this.mycelium = new Mycelium(this.terrain, rng.fork('myc'), this.palette);
    this.group.add(this.mycelium.lines);
    this.grove = new EchoGrove(this.terrain);
    this.group.add(this.grove.group);

    nodeXZ.forEach((p, i) => {
      const n = new MemoryNode(this.palette, this.terrain, p.x, p.y, i, def.id === 'return');
      this.nodes.push(n);
      this.group.add(n.group);
      this.mycelium.addTarget(p.x, p.y);
    });

    if (def.id !== 'return') {
      const center = new THREE.Vector3(0, 0, 0);
      this.gate = new FractalGate(this.palette, this.terrain, gateXZ.x, gateXZ.y, def.boss ? new THREE.Vector3(startXZ.x, 0, startXZ.y) : center);
      this.gate.group.visible = !def.boss;
      this.group.add(this.gate.group);
      this.mycelium.addTarget(gateXZ.x, gateXZ.y);
    }
    this.mycelium.addAnchor(startXZ.x, startXZ.y);

    // A first breath of network around the start so the ground is never bare.
    this.mycelium.seed(startXZ.x, startXZ.y, 5, 0, 90);
    if (def.id === 'return') this.growReturnGrove(run);
    this.mycelium.prewarm(def.id === 'return' ? 220 : 40);

    this.sky = new Sky(this.palette);
    this.group.add(this.sky.mesh);
    this.motes = new Motes(R, def.id === 'mirror' ? 260 : 380, this.palette, def.id !== 'mirror');
    this.group.add(this.motes.points);
  }

  /** The Return: every echo the player ever left, grown and wired together. */
  private growReturnGrove(run: RunState) {
    const R = this.radius;
    const rng = this.rng.fork('grove');
    const placed: { x: number; z: number }[] = [];
    const list = run.echoes.slice(-220);
    for (const e of list) {
      const k = (R * 0.92) / Math.max(e.radius, 1);
      const x = e.x * k * 0.9;
      const z = e.z * k * 0.9;
      if (Math.hypot(x, z) < 5 || Math.hypot(x, z) > R * 0.95) continue;
      this.grove.plant(x, z, e.affinity, { grown: true, scale: rng.range(1.1, 1.7) });
      placed.push({ x, z });
    }
    // Make sure the grove feels earned even for a cautious run: a halo shaped by the player's affinities.
    const total = Math.max(1, run.tiers.root + run.tiers.echo + run.tiers.flow);
    const want = Math.max(0, 36 - placed.length);
    for (let i = 0; i < want; i++) {
      const roll = rng.next() * total;
      const aff = roll < run.tiers.root ? 'root' : roll < run.tiers.root + run.tiers.echo ? 'echo' : 'flow';
      const a = rng.range(0, TAU);
      const r = rng.range(8, R * 0.85);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      this.grove.plant(x, z, aff, { grown: true, scale: rng.range(0.9, 1.5) });
      placed.push({ x, z });
    }
    // Wire the grove into the origin seed.
    const center = { x: 0, z: 0 };
    this.mycelium.addAnchor(0, 0);
    for (const p of placed.slice(0, 48)) {
      const near = this.mycelium.nearestAnchor(p.x, p.z, 26) ?? center;
      this.mycelium.connect(near, p);
    }
    this.mycelium.seed(0, 0, 14, 0, 120);
  }

  update(dt: number, t: number, camPos: THREE.Vector3, pointScale: number, player: THREE.Vector3) {
    this.terrain.update(t);
    this.flora.update(t);
    this.mycelium.update(dt, t);
    this.grove.update(dt);
    this.sky.update(t, camPos);
    this.motes.update(t, pointScale);
    this.gate?.update(dt, t);
    for (const n of this.nodes) n.update(dt, t);

    // glow sources for the ground shader
    let s = 0;
    this.terrain.setGlow(s++, player.x, player.z, 0.9);
    for (const n of this.nodes) this.terrain.setGlow(s++, n.pos.x, n.pos.z, n.state === 'active' ? 1.5 : n.state === 'done' ? 0.9 : 0.35);
    if (this.gate && this.gate.group.visible) this.terrain.setGlow(s++, this.gate.pos.x, this.gate.pos.z, 0.35 + this.gate.open * 0.9);
    const es = this.grove.echoes;
    for (let i = es.length - 1; i >= 0 && s < 10; i--) this.terrain.setGlow(s++, es[i].x, es[i].z, 0.6);
    this.terrain.clearGlowFrom(s);
  }

  dispose() {
    this.terrain.dispose();
    this.flora.dispose();
    this.mycelium.dispose();
    this.grove.dispose();
    this.sky.dispose();
    this.motes.dispose();
    this.gate?.dispose();
    this.nodes.forEach((n) => n.dispose());
  }
}

export const stratumByIndex = (i: number) => STRATA[Math.min(i, STRATA.length - 1)];
