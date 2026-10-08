import * as THREE from 'three';
import type { Game } from '../game';
import { AFFINITY_COLOR } from './echoes';
import { BOLT_COLORS } from './projectiles';
import { TAU, damp } from '../util/math';

const _v = new THREE.Vector2();

/** The Wisdomkeeper: a luminous seed-spirit with orbiting rings and trailing root-filaments. */
export class Player {
  readonly group = new THREE.Group();
  x = 0; z = 0; y = 0;
  vx = 0; vz = 0;
  hp = 100;
  res = 0;
  aim = 0;
  facing = 0;
  dead = false;
  moving = false;
  fireCD = 0;
  dashCD = 0;
  dashT = 0;
  dashDirX = 0;
  dashDirZ = 0;
  invuln = 0;
  hurtT = 0;
  dashHit = new Set<number>();
  dashCount = 0;
  private rings: THREE.Mesh[] = [];
  private tendrils: THREE.Mesh[] = [];
  private core: THREE.Mesh;
  private shell: THREE.Mesh;
  private decal: THREE.Mesh;
  private chevron: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private decalMat: THREE.MeshBasicMaterial;
  private trailAcc = 0;
  private stepAcc = 0;

  constructor() {
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8fff0).multiplyScalar(2.6) });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), this.coreMat);
    this.core.position.y = 0.2;
    this.group.scale.setScalar(1.3);
    const profile = [[0.001, -0.95], [0.22, -0.7], [0.5, -0.15], [0.46, 0.4], [0.24, 0.95], [0.001, 1.25]].map(([r, y]) => new THREE.Vector2(r, y));
    this.shell = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 14),
      new THREE.MeshStandardMaterial({ color: 0x0a2a28, emissive: 0x1aa58a, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.4, transparent: true, opacity: 0.82 }),
    );
    this.shell.position.y = 0.2;
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5cffc1).multiplyScalar(2) });
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.78 + i * 0.22, 0.022, 6, 40), this.ringMat);
      r.rotation.set(i * 1.05, i * 0.6, 0);
      r.position.y = 0.2;
      this.rings.push(r);
      this.group.add(r);
    }
    const tMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5cffc1).multiplyScalar(1.4) });
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 1.3, 4).translate(0, -0.65, 0), tMat);
      t.position.set(Math.cos((i / 6) * TAU) * 0.18, -0.75, Math.sin((i / 6) * TAU) * 0.18);
      t.userData.phase = i;
      this.tendrils.push(t);
      this.group.add(t);
    }
    this.chevron = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 3).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5cffc1).multiplyScalar(2) }));
    this.chevron.position.set(0, 0.1, 1.9);
    this.decalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5cffc1).multiplyScalar(1.6), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.decal = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40).rotateX(-Math.PI / 2), this.decalMat);
    this.group.add(this.core, this.shell, this.chevron);
  }

  get decalMesh() {
    return this.decal;
  }

  reset(x: number, z: number, hp: number) {
    this.x = x; this.z = z; this.vx = this.vz = 0;
    this.hp = hp;
    this.dead = false;
    this.invuln = 1.5;
    this.fireCD = 0;
    this.dashT = 0;
    this.dashCD = 0;
    this.group.visible = true;
    this.decal.visible = true;
  }

  applyAffinityLook(g: Game) {
    const t = g.run.tiers;
    const max = Math.max(t.root, t.echo, t.flow);
    if (max === 0) return;
    const dom = (['root', 'echo', 'flow'] as const).filter((a) => t[a] === max);
    const c = new THREE.Color(dom.length === 1 ? AFFINITY_COLOR[dom[0]] : 0xe8fff4);
    this.ringMat.color.copy(c).multiplyScalar(2.2);
    this.decalMat.color.copy(c).multiplyScalar(1.6);
    (this.chevron.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(2);
    g.gfx.playerLight.color.copy(c);
  }

  update(g: Game, dt: number, move: THREE.Vector2, aimAngle: number | null, wantFire: boolean) {
    const tiers = g.run.tiers;
    const terrain = g.world.terrain;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.fireCD -= dt;
    this.dashCD -= dt;
    this.moving = move.lengthSq() > 0.01;
    if (aimAngle !== null) this.aim = aimAngle;
    else if (this.moving) this.aim = Math.atan2(move.x, move.y);

    if (!this.dead && g.mode === 'play') {
      const speedMul = (tiers.flow >= 2 ? 1.15 : 1) * (wantFire ? 0.88 : 1);
      const maxSp = 11 * speedMul;
      if (this.dashT > 0) {
        this.dashT -= dt;
        const sp = 40;
        this.vx = this.dashDirX * sp;
        this.vz = this.dashDirZ * sp;
        this.invuln = Math.max(this.invuln, 0.12);
        g.particles.emit(this.x, this.y, this.z, 0, 0.5, 0, BOLT_COLORS.base, 0.9, 0.45, 3);
        if (tiers.flow >= 1) {
          for (const e of g.enemies) {
            if (e.dead || this.dashHit.has(e.id)) continue;
            if ((e.x - this.x) ** 2 + (e.z - this.z) ** 2 < (e.radius + 1.3) ** 2) {
              this.dashHit.add(e.id);
              g.damageEnemy(e, 30, this.dashDirX, this.dashDirZ, {});
            }
          }
        }
      } else {
        const tx = move.x * maxSp;
        const tz = move.y * maxSp;
        const k = this.moving ? 14 : 10;
        this.vx = damp(this.vx, tx, k, dt);
        this.vz = damp(this.vz, tz, k, dt);
      }
      const flow = g.flowAt(this.x, this.z);
      const nx = this.x + (this.vx + flow.x) * dt;
      const nz = this.z + (this.vz + flow.y) * dt;
      const R = g.world.radius * 0.97;
      const rr = Math.hypot(nx, nz);
      if (rr > R) {
        this.x = (nx * R) / rr;
        this.z = (nz * R) / rr;
      } else {
        this.x = nx;
        this.z = nz;
      }
      g.stats.distance += Math.hypot(this.vx, this.vz) * dt;

      // dash
      if (g.input.wasPressed('Space') || g.input.wasPressed('ShiftLeft') || g.input.wasPressed('MouseRight') || g.input.wasPressed('TouchDash')) {
        if (this.dashCD <= 0 && this.dashT <= 0) this.startDash(g, move);
      }

      // fire
      if (wantFire && this.fireCD <= 0) this.shoot(g);
    }

    // visuals
    const targetY = terrain.heightAt(this.x, this.z) + 1.15 + Math.sin(g.time * 3) * 0.1;
    this.y = damp(this.y || targetY, targetY, 14, dt);
    this.group.position.set(this.x, this.y, this.z);
    this.facing = damp(this.facing, this.facing + Math.atan2(Math.sin(this.aim - this.facing), Math.cos(this.aim - this.facing)), 14, dt);
    this.shell.rotation.y = this.facing;
    this.chevron.rotation.y = this.facing;
    this.chevron.position.set(Math.sin(this.facing) * 1.9, 0.1, Math.cos(this.facing) * 1.9);
    this.rings.forEach((r, i) => {
      r.rotation.x += dt * (0.8 + i * 0.5);
      r.rotation.z += dt * (0.5 - i * 0.3);
    });
    this.core.scale.setScalar(1 + 0.12 * Math.sin(g.time * 6) + (wantFire ? 0.2 : 0));
    this.tendrils.forEach((t) => {
      const ph = t.userData.phase as number;
      t.rotation.x = Math.sin(g.time * 3 + ph) * 0.25 - this.vz * 0.02;
      t.rotation.z = Math.cos(g.time * 2.6 + ph) * 0.25 + this.vx * 0.02;
    });
    const blink = this.invuln > 0 && this.hurtT > 0 && Math.sin(g.time * 50) > 0;
    this.group.visible = !this.dead && !blink;
    this.decal.position.set(this.x, terrain.heightAt(this.x, this.z) + 0.25, this.z);
    this.decal.scale.setScalar(1 + 0.08 * Math.sin(g.time * 4));
    this.decal.visible = !this.dead;
    g.gfx.playerLight.position.set(this.x, this.y + 3.5, this.z);

    // movement dust + root tracks
    if (this.moving && !this.dead) {
      this.trailAcc += dt;
      if (this.trailAcc > 0.05) {
        this.trailAcc = 0;
        g.particles.emit(this.x, this.y - 0.8, this.z, (Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8, BOLT_COLORS.base, 0.35, 0.6, 2);
      }
      this.stepAcc += dt;
      if (this.stepAcc > 2.2) {
        this.stepAcc = 0;
        g.world.mycelium.seed(this.x, this.z, 1, 1, 22);
      }
    }
    void _v;
  }

  private startDash(g: Game, move: THREE.Vector2) {
    const tiers = g.run.tiers;
    this.dashT = tiers.flow >= 1 ? 0.2 : 0.16;
    this.dashCD = tiers.flow >= 1 ? 0.55 : 0.9;
    this.dashHit.clear();
    if (move.lengthSq() > 0.05) {
      _v.copy(move).normalize();
      this.dashDirX = _v.x;
      this.dashDirZ = _v.y;
    } else {
      this.dashDirX = Math.sin(this.aim);
      this.dashDirZ = Math.cos(this.aim);
    }
    g.stats.dashes++;
    this.dashCount++;
    g.audio.sfx('dash');
    g.particles.burst(new THREE.Vector3(this.x, this.y, this.z), BOLT_COLORS.base, 10, 7, 0.5, 0.5);
    if (this.dashCount % 3 === 0) g.plantEcho(this.x, this.z, 'dash');
  }

  private shoot(g: Game) {
    const tiers = g.run.tiers;
    this.fireCD = 0.155 / (tiers.flow >= 3 ? 1.5 : 1);
    const spread = (Math.random() - 0.5) * 0.06;
    const ang = this.aim + spread;
    const ox = this.x + Math.sin(ang) * 1.1;
    const oz = this.z + Math.cos(ang) * 1.1;
    const color = tiers.root >= 1 ? BOLT_COLORS.root : tiers.echo >= 1 ? BOLT_COLORS.echo : tiers.flow >= 1 ? BOLT_COLORS.flow : BOLT_COLORS.base;
    const dmg = 12;
    const pierce = tiers.echo >= 2 ? 1 : 0;
    const slow = tiers.root >= 1 ? 0.45 : 0;
    g.projectiles.firePlayer(ox, oz, ang, { dmg, color, pierce, slow });
    if (tiers.echo >= 1) g.projectiles.fireDelayed(0.3, this.x, this.z, ang, { dmg: dmg * 0.6, color: BOLT_COLORS.echo, pierce, slow });
    g.stats.shots++;
    g.audio.sfx('shoot', 0.9 + Math.random() * 0.2);
    this.core.scale.setScalar(1.35);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
    this.decal.geometry.dispose();
    this.decalMat.dispose();
  }
}
