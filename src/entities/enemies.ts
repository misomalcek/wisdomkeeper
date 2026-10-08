import * as THREE from 'three';
import type { Game } from '../game';
import type { EnemyKind } from '../types';
import { TAU } from '../util/math';

let nextId = 1;
const HOT = new THREE.Color(0xff3b7a);
const WHITE = new THREE.Color(0xffffff).multiplyScalar(3);

interface Stats {
  hp: number;
  speed: number;
  radius: number;
  dmg: number;
  value: number;
}
const TABLE: Record<EnemyKind, Stats> = {
  mite: { hp: 24, speed: 8.6, radius: 0.85, dmg: 10, value: 1 },
  spitter: { hp: 46, speed: 5.2, radius: 1.0, dmg: 11, value: 2 },
  brute: { hp: 200, speed: 3.8, radius: 1.8, dmg: 18, value: 5 },
  boss: { hp: 3400, speed: 4.2, radius: 3.8, dmg: 22, value: 0 },
};
export const ENEMY_COST: Record<Exclude<EnemyKind, 'boss'>, number> = { mite: 1, spitter: 2, brute: 5 };

// Shared geometry (never disposed per-enemy).
const GEO = {
  mite: new THREE.OctahedronGeometry(0.85, 0),
  miteEdges: new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.88, 0)),
  spitter: new THREE.ConeGeometry(0.8, 2.0, 5),
  spitterEdges: new THREE.EdgesGeometry(new THREE.ConeGeometry(0.84, 2.04, 5)),
  ring: new THREE.TorusGeometry(1.1, 0.05, 6, 24),
  brute: new THREE.DodecahedronGeometry(1.6, 0),
  bruteEdges: new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(1.64, 0)),
  spike: new THREE.ConeGeometry(0.3, 1.1, 5),
  bossShell: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.7, 1)),
  bossBody: new THREE.IcosahedronGeometry(3.2, 1),
  bossCore: new THREE.SphereGeometry(1.15, 16, 12),
  bossRing: [4.8, 5.8, 6.9].map((r) => new THREE.TorusGeometry(r, 0.07, 6, 64)),
  tele: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
  tele2: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

export class Enemy {
  readonly id = nextId++;
  readonly kind: EnemyKind;
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  x = 0; z = 0; y = 0;
  vx = 0; vz = 0;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  dmg: number;
  value: number;
  dead = false;
  spawnT = 0;
  flash = 0;
  slowT = 0;
  slowF = 0.5;
  state = 'chase';
  st = 0;
  cd = 0.5 + Math.random();
  lockAng = 0;
  contactCD = 0;
  fromEvent = false;
  // boss
  phase = 1;
  activated = false;
  atk: 'radial' | 'spiral' | 'summon' | 'charge' | 'volley' | null = null;
  atkT = 0;
  atkN = 0;
  invuln = 0;
  // visuals
  coreMat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  edgeMat: THREE.LineBasicMaterial;
  baseEmissive = 0.7;
  tele?: THREE.Mesh;
  teleMat?: THREE.MeshBasicMaterial;
  spinners: THREE.Object3D[] = [];
  extraMats: THREE.Material[] = [];

  constructor(kind: EnemyKind, x: number, z: number, diff: number) {
    this.kind = kind;
    const s = TABLE[kind];
    const hpMul = 0.85 + 0.3 * diff;
    this.hp = this.maxHp = Math.round(s.hp * hpMul);
    this.speed = s.speed * (0.95 + 0.08 * diff);
    this.radius = s.radius;
    this.dmg = Math.round(s.dmg * (0.9 + 0.15 * diff));
    this.value = s.value;
    this.x = x;
    this.z = z;
    this.group.add(this.body);
    this.edgeMat = new THREE.LineBasicMaterial({ color: HOT.clone().multiplyScalar(2.2) });
    const solid = (emissive: number) =>
      new THREE.MeshStandardMaterial({ color: 0x14060c, emissive: HOT, emissiveIntensity: emissive, roughness: 0.4, metalness: 0.6, flatShading: true });

    if (kind === 'mite') {
      this.coreMat = solid(0.8);
      this.baseEmissive = 0.8;
      this.body.add(new THREE.Mesh(GEO.mite, this.coreMat), new THREE.LineSegments(GEO.miteEdges, this.edgeMat));
    } else if (kind === 'spitter') {
      this.coreMat = solid(0.6);
      this.baseEmissive = 0.6;
      const cone = new THREE.Mesh(GEO.spitter, this.coreMat);
      cone.rotation.x = Math.PI; // point down, hovering
      const edges = new THREE.LineSegments(GEO.spitterEdges, this.edgeMat);
      edges.rotation.x = Math.PI;
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a3b).multiplyScalar(2) });
      this.extraMats.push(ringMat);
      const ring = new THREE.Mesh(GEO.ring, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.9;
      this.spinners.push(ring);
      this.body.add(cone, edges, ring);
    } else if (kind === 'brute') {
      this.coreMat = solid(0.5);
      this.baseEmissive = 0.5;
      this.body.add(new THREE.Mesh(GEO.brute, this.coreMat), new THREE.LineSegments(GEO.bruteEdges, this.edgeMat));
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x220810, emissive: 0xff5a2a, emissiveIntensity: 0.8, flatShading: true });
      this.extraMats.push(spikeMat);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        const sp = new THREE.Mesh(GEO.spike, spikeMat);
        sp.position.set(Math.cos(a) * 1.5, 0.3 + (i % 2) * 0.5, Math.sin(a) * 1.5);
        sp.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
        this.body.add(sp);
      }
      this.makeTele(2.6, 16);
    } else {
      this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6aa0).multiplyScalar(3.2) });
      this.baseEmissive = 1;
      const bodyMat = solid(0.25);
      this.extraMats.push(bodyMat);
      this.body.add(new THREE.Mesh(GEO.bossBody, bodyMat), new THREE.LineSegments(GEO.bossShell, this.edgeMat), new THREE.Mesh(GEO.bossCore, this.coreMat));
      GEO.bossRing.forEach((g, i) => {
        const rm = new THREE.MeshBasicMaterial({ color: (i === 1 ? new THREE.Color(0xe8f4ff) : HOT.clone()).multiplyScalar(2.2) });
        this.extraMats.push(rm);
        const r = new THREE.Mesh(g, rm);
        r.rotation.set(i * 1.0, i * 0.6, 0);
        r.userData.axis = new THREE.Vector3(Math.sin(i * 2.3), 1, Math.cos(i * 1.7)).normalize();
        r.userData.rate = 0.5 + i * 0.35;
        this.spinners.push(r);
        this.body.add(r);
      });
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x120410, emissive: HOT, emissiveIntensity: 0.9, flatShading: true });
      this.extraMats.push(spikeMat);
      for (let i = 0; i < 12; i++) {
        const sp = new THREE.Mesh(GEO.spike, spikeMat);
        const u = Math.acos(1 - 2 * ((i + 0.5) / 12));
        const v = Math.PI * (1 + Math.sqrt(5)) * i;
        const dir = new THREE.Vector3(Math.sin(u) * Math.cos(v), Math.cos(u), Math.sin(u) * Math.sin(v));
        sp.scale.setScalar(2.2);
        sp.position.copy(dir).multiplyScalar(3.6);
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.body.add(sp);
      }
      this.makeTele(5, 60);
      this.invuln = 99;
    }
    this.group.scale.setScalar(0.01);
  }

  private makeTele(width: number, len: number) {
    this.teleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b4a).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.tele = new THREE.Mesh(GEO.tele, this.teleMat);
    this.tele.scale.set(width, 1, len);
    this.tele.position.y = 0.25;
    this.tele.visible = false;
    this.group.add(this.tele);
  }

  dispose() {
    this.coreMat.dispose();
    this.edgeMat.dispose();
    this.teleMat?.dispose();
    this.extraMats.forEach((m) => m.dispose());
    this.tele?.removeFromParent();
  }
}

export function updateEnemy(e: Enemy, g: Game, dt: number) {
  const p = g.player;
  const terrain = g.world.terrain;

  // spawn emergence
  if (e.spawnT < 1) {
    e.spawnT = Math.min(1, e.spawnT + dt / (e.kind === 'boss' ? 1.8 : 0.55));
    const s = e.spawnT * e.spawnT * (3 - 2 * e.spawnT);
    e.group.scale.set(s, Math.max(s, 0.01), s);
  }
  e.flash = Math.max(0, e.flash - dt);
  e.contactCD -= dt;
  e.slowT -= dt;
  const ts = (e.slowT > 0 ? e.slowF : 1) * g.enemyTimeScale;
  const sdt = dt * ts;

  // knockback decay
  e.x += e.vx * dt;
  e.z += e.vz * dt;
  const kd = Math.max(0, 1 - 7 * dt);
  e.vx *= kd;
  e.vz *= kd;

  if (e.spawnT >= 1 && !p.dead) aiStep(e, g, sdt, dt);

  // enemies never occupy the player's centre (keeps aiming and contact readable)
  if (e.kind !== 'boss' && !p.dead) {
    const pdx = e.x - p.x;
    const pdz = e.z - p.z;
    const pd = Math.hypot(pdx, pdz);
    const min = e.radius * 0.7 + 0.5;
    if (pd < min) {
      const k = pd > 1e-3 ? (min - pd) / pd : 0;
      e.x += pd > 1e-3 ? pdx * k : min;
      e.z += pd > 1e-3 ? pdz * k : 0;
    }
  }

  // keep inside the arena
  const R = g.world.radius * 0.97;
  const rr = Math.hypot(e.x, e.z);
  if (rr > R) {
    e.x *= R / rr;
    e.z *= R / rr;
  }

  // separation (cheap O(n²); n is small)
  if (e.kind !== 'boss') {
    for (const o of g.enemies) {
      if (o === e || o.dead || o.kind === 'boss') continue;
      const dx = e.x - o.x;
      const dz = e.z - o.z;
      const min = (e.radius + o.radius) * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5 * Math.min(1, dt * 12);
        e.x += dx * push;
        e.z += dz * push;
      }
    }
  }

  // visuals
  const hover = e.kind === 'boss' ? 5.2 + Math.sin(g.time * 1.3) * 0.5 : e.kind === 'spitter' ? 1.8 : e.kind === 'brute' ? 1.9 : 1.3 + Math.sin(g.time * 4 + e.id) * 0.15;
  e.y = terrain.heightAt(e.x, e.z) + hover;
  e.group.position.set(e.x, e.y, e.z);
  const f = e.flash > 0;
  e.edgeMat.color.copy(f ? WHITE : HOT).multiplyScalar(f ? 1 : 2.2);
  if (e.coreMat instanceof THREE.MeshStandardMaterial) e.coreMat.emissiveIntensity = f ? 4 : e.baseEmissive + (e.state === 'wind' ? 1.5 : 0);
  else if (e.kind === 'boss') e.coreMat.color.copy(f ? WHITE : HOT).multiplyScalar(f ? 1 : 3.2 + Math.sin(g.time * 6) * 0.5);

  if (e.kind === 'mite') {
    e.body.rotation.y += dt * 4;
    e.body.rotation.x = Math.sin(g.time * 5 + e.id) * 0.3;
  } else if (e.kind === 'spitter') {
    e.body.rotation.y += dt * 1.5;
    for (const s of e.spinners) s.rotation.z += dt * 5;
  } else if (e.kind === 'brute') {
    e.body.rotation.y += dt * 0.8;
    e.body.rotation.x = Math.sin(g.time * 2 + e.id) * 0.08;
  } else {
    e.body.rotation.y += dt * 0.25;
    for (const s of e.spinners) s.rotateOnAxis(s.userData.axis as THREE.Vector3, dt * (s.userData.rate as number));
  }
  // glitch jitter
  if (e.spawnT >= 1 && (Math.random() < 0.04 || e.flash > 0) && e.kind !== 'boss') {
    e.body.scale.set(1 + (Math.random() - 0.5) * 0.35, 1 + (Math.random() - 0.5) * 0.2, 1 + (Math.random() - 0.5) * 0.35);
  } else e.body.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 18));
}

function aiStep(e: Enemy, g: Game, dt: number, rawDt: number) {
  const p = g.player;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 0.001;
  const toP = Math.atan2(dx, dz);
  const flow = g.flowAt(e.x, e.z);
  e.x += flow.x * rawDt * 0.6;
  e.z += flow.y * rawDt * 0.6;

  const touch = () => {
    if (d < e.radius + 0.7 && e.contactCD <= 0) {
      if (g.hurtPlayer(e.dmg, e.x, e.z)) {
        e.contactCD = 0.9;
        e.vx -= (dx / d) * 6;
        e.vz -= (dz / d) * 6;
      } else e.contactCD = 0.25;
    }
  };

  switch (e.kind) {
    case 'mite': {
      const wob = Math.sin(g.time * 3 + e.id * 1.7) * (d > 6 ? 0.55 : 0.15);
      const a = toP + wob;
      const sp = e.speed * (d < 2.2 ? 0.5 : 1);
      e.x += Math.sin(a) * sp * dt;
      e.z += Math.cos(a) * sp * dt;
      touch();
      break;
    }
    case 'spitter': {
      e.cd -= dt;
      if (e.state === 'chase') {
        const want = 13;
        const side = Math.sin(g.time * 0.8 + e.id) * 0.9;
        let a = toP;
        let sp = 0;
        if (d > want + 3) sp = e.speed;
        else if (d < want - 3) {
          a = toP + Math.PI;
          sp = e.speed * 0.9;
        } else {
          a = toP + Math.PI / 2 * Math.sign(side || 1);
          sp = e.speed * 0.45;
        }
        e.x += Math.sin(a) * sp * dt;
        e.z += Math.cos(a) * sp * dt;
        if (e.cd <= 0 && d < 28) {
          e.state = 'wind';
          e.st = 0.5;
        }
      } else if (e.state === 'wind') {
        e.st -= dt;
        if (e.st <= 0) {
          const n = g.diff > 1.35 ? 3 : g.diff > 1.0 ? 2 : 1;
          const spread = 0.2;
          const orbSpeed = 17 + g.diff * 1.5;
          // lead the shot: aim where the player is *going*, with a little human-scale error
          const lead = Math.min(1, d / orbSpeed);
          const aimA = Math.atan2(p.x + p.vx * lead - e.x, p.z + p.vz * lead - e.z) + (Math.random() - 0.5) * 0.1;
          for (let i = 0; i < n; i++) g.projectiles.fireEnemy(e.x, e.z, aimA + (i - (n - 1) / 2) * spread, orbSpeed, e.dmg);
          g.audio.sfx('spit');
          e.state = 'chase';
          e.cd = 2.1 / (0.85 + 0.15 * g.diff) + Math.random() * 0.7;
        }
      }
      touch();
      break;
    }
    case 'brute': {
      e.cd -= dt;
      if (e.state === 'chase') {
        e.x += Math.sin(toP) * e.speed * dt;
        e.z += Math.cos(toP) * e.speed * dt;
        if (e.cd <= 0 && d < 18) {
          e.state = 'wind';
          e.st = 0.85;
          g.audio.sfx('warn');
        }
      } else if (e.state === 'wind') {
        e.st -= dt;
        e.lockAng = toP;
        if (e.tele && e.teleMat) {
          e.tele.visible = true;
          e.tele.rotation.y = e.lockAng;
          e.teleMat.opacity = 0.25 + 0.35 * (1 - e.st / 0.85);
        }
        if (e.st <= 0) {
          e.state = 'charge';
          e.st = 0.7;
          if (e.tele) e.tele.visible = false;
        }
      } else if (e.state === 'charge') {
        e.st -= dt;
        e.x += Math.sin(e.lockAng) * 28 * dt;
        e.z += Math.cos(e.lockAng) * 28 * dt;
        if (Math.random() < 0.7) g.particles.burst(new THREE.Vector3(e.x, e.y - 1, e.z), HOT, 1, 4, 0.5, 0.4);
        if (d < e.radius + 0.8 && e.contactCD <= 0) {
          if (g.hurtPlayer(Math.round(e.dmg * 1.4), e.x, e.z)) e.contactCD = 1.2;
        }
        if (e.st <= 0) {
          e.state = 'recover';
          e.st = 0.9;
        }
      } else if (e.state === 'recover') {
        e.st -= dt;
        if (e.st <= 0) {
          e.state = 'chase';
          e.cd = 2.2 + Math.random();
        }
      }
      if (e.state !== 'charge') touch();
      break;
    }
    case 'boss':
      bossStep(e, g, dt, d, toP);
      break;
  }
}

function bossStep(e: Enemy, g: Game, dt: number, d: number, toP: number) {
  const p = g.player;
  if (!e.activated) {
    if (d < 30) {
      e.activated = true;
      e.invuln = 0.6;
      e.cd = 2;
      g.audio.sfx('boss');
      g.shake(1);
      g.bossAwake(e);
    }
    return;
  }
  e.invuln = Math.max(0, e.invuln - dt);
  // phase transitions
  const ratio = e.hp / e.maxHp;
  const phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  if (phase > e.phase) {
    e.phase = phase;
    e.atk = null;
    e.cd = 1.6;
    e.invuln = 1.2;
    g.projectiles.clearEnemyBolts();
    g.particles.ring(new THREE.Vector3(e.x, e.y, e.z), HOT.clone().multiplyScalar(3), 60, 22, 0.8, 1.0);
    g.audio.sfx('boss');
    g.shake(1.2);
    g.bossPhase(e, phase);
  }

  // positioning: hold a comfortable distance, circle slowly
  if (e.atk !== 'charge') {
    const want = 15;
    let a = toP;
    let sp = 0;
    if (d > want + 4) sp = e.speed;
    else if (d < want - 5) {
      a = toP + Math.PI;
      sp = e.speed * 0.8;
    } else {
      a = toP + Math.PI / 2;
      sp = e.speed * 0.35;
    }
    e.x += Math.sin(a) * sp * dt;
    e.z += Math.cos(a) * sp * dt;
  }

  const shots = [14, 18, 24][e.phase - 1];
  const pos = new THREE.Vector3(e.x, e.y, e.z);

  if (e.atk === null) {
    e.cd -= dt;
    if (e.cd <= 0) {
      const pool: ('radial' | 'spiral' | 'summon' | 'charge' | 'volley')[] =
        e.phase === 1
          ? ['radial', 'radial', 'volley', 'volley', 'summon']
          : e.phase === 2
            ? ['radial', 'spiral', 'spiral', 'volley', 'volley', 'summon', 'charge']
            : ['radial', 'spiral', 'spiral', 'volley', 'charge', 'charge', 'summon'];
      let pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === 'summon' && g.enemies.filter((o) => !o.dead && o.kind !== 'boss').length > 7) pick = 'radial';
      e.atk = pick;
      e.atkN = 0;
      e.atkT = pick === 'radial' ? 0.7 : pick === 'spiral' ? 3.6 : pick === 'summon' ? 1.0 : pick === 'volley' ? 0.6 : 1.1;
      if (pick === 'volley') {
        e.atkN = 3 + e.phase;
        e.st = 0;
      }
      if (pick === 'charge') {
        e.lockAng = toP;
        g.audio.sfx('warn');
      }
    }
    return;
  }

  e.atkT -= dt;
  const fireRing = (n: number, offset: number, speed: number) => {
    for (let i = 0; i < n; i++) g.projectiles.fireEnemy(e.x, e.z, offset + (i / n) * TAU, speed, 10);
    g.audio.sfx('spit');
  };
  switch (e.atk) {
    case 'radial':
      e.state = 'wind';
      if (e.atkT <= 0) {
        fireRing(shots, Math.random() * TAU, 10 + e.phase * 1.2);
        if (e.phase >= 3) fireRing(shots, Math.random() * TAU, 7.5);
        g.particles.ring(pos, HOT.clone().multiplyScalar(2.5), 24, 12, 0.6, 0.6);
        e.atk = null;
        e.state = 'chase';
        e.cd = [2.4, 1.9, 1.5][e.phase - 1];
      }
      break;
    case 'spiral': {
      e.state = 'wind';
      e.atkN -= dt;
      if (e.atkN <= 0) {
        e.atkN = 0.1 - e.phase * 0.008;
        const a = g.time * 3.2;
        const arms = e.phase + 1; // 2, 3, 4 arms
        for (let i = 0; i < arms; i++) g.projectiles.fireEnemy(e.x, e.z, a + (i / arms) * TAU, 11.5, 9);
      }
      if (e.atkT <= 0) {
        e.atk = null;
        e.state = 'chase';
        e.cd = 2.2;
      }
      break;
    }
    case 'volley':
      e.state = 'wind';
      if (e.atkT > 0) break; // telegraph
      e.st -= dt;
      if (e.st <= 0) {
        if (e.atkN <= 0) {
          e.atk = null;
          e.state = 'chase';
          e.cd = [2.2, 1.8, 1.5][e.phase - 1];
          break;
        }
        e.atkN--;
        e.st = 0.34;
        const speed = 16 + e.phase * 1.5;
        const lead = Math.min(1.2, d / speed);
        const aimA = Math.atan2(p.x + p.vx * lead - e.x, p.z + p.vz * lead - e.z);
        const half = e.phase >= 2 ? 2 : 1;
        for (let i = -half; i <= half; i++) g.projectiles.fireEnemy(e.x, e.z, aimA + i * 0.18, speed, 12);
        g.audio.sfx('spit');
      }
      break;
    case 'summon':
      e.state = 'wind';
      if (e.atkT <= 0) {
        const n = 2 + e.phase;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + Math.random();
          const r = 8 + Math.random() * 4;
          g.queueSpawn(e.phase === 3 && i % 2 ? 'spitter' : 'mite', e.x + Math.cos(a) * r, e.z + Math.sin(a) * r, false);
        }
        e.atk = null;
        e.state = 'chase';
        e.cd = 3;
      }
      break;
    case 'charge':
      if (e.atkT > 0.0 && e.state !== 'charge') {
        // telegraph (atkT counts 1.1 → 0)
        e.state = 'wind';
        e.lockAng = toP;
        if (e.tele && e.teleMat) {
          e.tele.visible = true;
          e.tele.rotation.y = e.lockAng;
          e.teleMat.opacity = 0.2 + 0.4 * (1 - e.atkT / 1.1);
        }
      }
      if (e.atkT <= 0 && e.state !== 'charge') {
        e.state = 'charge';
        e.atkT = 0.9;
        if (e.tele) e.tele.visible = false;
        g.audio.sfx('boss');
      } else if (e.state === 'charge') {
        e.x += Math.sin(e.lockAng) * 30 * dt;
        e.z += Math.cos(e.lockAng) * 30 * dt;
        g.particles.burst(new THREE.Vector3(e.x, e.y - 2, e.z), HOT, 2, 6, 0.8, 0.5);
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        if (Math.hypot(dx, dz) < e.radius + 0.8 && e.contactCD <= 0 && g.hurtPlayer(Math.round(e.dmg * 1.3), e.x, e.z)) e.contactCD = 1;
        if (e.atkT <= 0) {
          e.atk = null;
          e.state = 'chase';
          e.cd = 1.4;
        }
      }
      break;
  }
  if (e.atk !== 'charge' && Math.hypot(p.x - e.x, p.z - e.z) < e.radius + 0.8 && e.contactCD <= 0) {
    if (g.hurtPlayer(e.dmg, e.x, e.z)) e.contactCD = 1;
  }
}
