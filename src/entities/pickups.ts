import * as THREE from 'three';
import type { Game } from '../game';

export type PickupKind = 'heal' | 'res';
interface Pickup {
  kind: PickupKind;
  x: number; z: number; y: number;
  vx: number; vz: number;
  life: number;
  phase: number;
}

const MAX = 80;
const _o = new THREE.Object3D();
const COL = {
  heal: new THREE.Color(0x7cff6b).multiplyScalar(2.6),
  res: new THREE.Color(0xb084ff).multiplyScalar(2.8),
};

export class Pickups {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private items: Pickup[] = [];

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial(), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  drop(x: number, z: number, kind: PickupKind) {
    if (this.items.length >= MAX) this.items.shift();
    const a = Math.random() * Math.PI * 2;
    this.items.push({ kind, x, z, y: 0, vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, life: 22, phase: Math.random() * 6 });
  }

  clear() {
    this.items.length = 0;
  }

  update(game: Game, dt: number) {
    const p = game.player;
    const terrain = game.world.terrain;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      it.vx *= Math.max(0, 1 - 3 * dt);
      it.vz *= Math.max(0, 1 - 3 * dt);
      const dx = p.x - it.x;
      const dz = p.z - it.z;
      const d = Math.hypot(dx, dz);
      if (d < 7 && !game.player.dead) {
        const pull = (1 - d / 7) * 40 + 6;
        it.vx += (dx / d) * pull * dt;
        it.vz += (dz / d) * pull * dt;
      }
      it.x += it.vx * dt;
      it.z += it.vz * dt;
      it.y = terrain.heightAt(it.x, it.z) + 0.9 + Math.sin(game.time * 3 + it.phase) * 0.15;
      if (d < 1.3 && !game.player.dead) {
        game.collect(it.kind);
        this.items.splice(i, 1);
        continue;
      }
      if (it.life <= 0) this.items.splice(i, 1);
    }
    let n = 0;
    for (const it of this.items) {
      _o.position.set(it.x, it.y, it.z);
      _o.rotation.set(game.time * 2 + it.phase, game.time * 3, 0);
      const fade = it.life < 3 ? (Math.sin(game.time * 20) > 0 ? 1 : 0.3) : 1;
      _o.scale.setScalar(fade);
      _o.updateMatrix();
      this.mesh.setMatrixAt(n, _o.matrix);
      this.mesh.setColorAt(n, COL[it.kind]);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
