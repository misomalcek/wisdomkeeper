import * as THREE from 'three';
import type { Palette } from '../story/strata';
import type { Terrain } from './terrain';
import { damp } from '../util/math';

const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** The fractal Threshold: nested rings that echo themselves at 0.62× scale, around a kaleidoscopic fold. */
export class FractalGate {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private rings: THREE.Mesh[] = [];
  private discMat: THREE.ShaderMaterial;
  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private ringMats: THREE.MeshBasicMaterial[] = [];
  open = 0;
  wantOpen = false;
  radius = 3.4;

  constructor(palette: Palette, terrain: Terrain, x: number, z: number, faceTo: THREE.Vector3) {
    const y = terrain.heightAt(x, z);
    this.pos.set(x, y, z);
    this.group.position.set(x, y + this.radius + 0.4, z);
    const a = new THREE.Color(palette.accent);
    const b = new THREE.Color(palette.accent2);
    for (let i = 0; i < 7; i++) {
      const s = Math.pow(0.66, i);
      const geo = new THREE.TorusGeometry(this.radius * s, 0.13 * Math.pow(0.8, i), 8, 64);
      const mat = new THREE.MeshBasicMaterial({ color: a.clone().lerp(b, i / 6).multiplyScalar(1.4 + (i % 2) * 0.8) });
      this.ringMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.userData.spin = (i % 2 ? 1 : -1) * (0.3 + i * 0.22);
      m.rotation.x = i * 0.35;
      this.rings.push(m);
      this.group.add(m);
    }
    this.discMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uA: { value: a.clone().multiplyScalar(2) },
        uB: { value: b.clone().multiplyScalar(2) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uOpen; uniform vec3 uA, uB; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          vec2 q = p * 1.4; float v = 0.0;
          for (int i = 0; i < 6; i++) {
            q = abs(q) / max(dot(q, q), 0.12) - vec2(0.85 + 0.05 * sin(uTime * 0.3), 0.7);
            v += exp(-length(q) * 1.6);
          }
          v = clamp(v * 0.55, 0.0, 1.6);
          vec3 open = mix(uA, uB, v) * (0.5 + v);
          vec3 shut = vec3(0.5, 0.05, 0.12) * (0.25 + 0.3 * v);
          vec3 col = mix(shut, open, uOpen);
          float edge = smoothstep(1.0, 0.8, r);
          float a = edge * mix(0.28, 0.85, uOpen);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 0.96, 48), this.discMat);
    this.group.add(disc);
    this.beamMat = new THREE.MeshBasicMaterial({ color: hdr(palette.accent, 1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.2, 70, 12, 1, true), this.beamMat);
    // Group origin sits radius+0.4 above ground; the beam rises from the ground.
    this.beam.position.set(0, 35 - this.radius - 0.4, 0);
    this.group.add(this.beam);
    this.group.lookAt(faceTo.x, this.group.position.y, faceTo.z);
  }

  setOpen(v: boolean) {
    this.wantOpen = v;
  }

  update(dt: number, t: number) {
    this.open = damp(this.open, this.wantOpen ? 1 : 0, 2.2, dt);
    this.discMat.uniforms.uTime.value = t;
    this.discMat.uniforms.uOpen.value = this.open;
    const speed = 0.4 + this.open * 1.4;
    for (const r of this.rings) r.rotation.z += r.userData.spin * dt * speed;
    this.rings.forEach((r, i) => (r.rotation.y = Math.sin(t * 0.4 + i) * 0.25));
    this.beamMat.opacity = this.open * (0.18 + 0.06 * Math.sin(t * 3));
    // dim rings when locked
    const k = 0.35 + this.open * 0.65;
    this.ringMats.forEach((m, i) => m.color.setScalar(k * (1.2 + (i % 2) * 0.5)));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.discMat.dispose();
    this.beamMat.dispose();
    this.ringMats.forEach((m) => m.dispose());
  }
}

export type NodeState = 'dormant' | 'active' | 'done';

/** A Memory Node: a crystal that sings when woken, summons the Static, then blooms. */
export class MemoryNode {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly zoneRadius = 11;
  state: NodeState = 'dormant';
  index: number;
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshBasicMaterial;
  private shards: THREE.Mesh[] = [];
  private shardMat: THREE.MeshBasicMaterial;
  private zone: THREE.LineLoop;
  private zoneMat: THREE.LineBasicMaterial;
  private baseRing: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private cDormant: THREE.Color;
  private cActive: THREE.Color;
  private cDone: THREE.Color;
  private cur = new THREE.Color();

  constructor(palette: Palette, terrain: Terrain, x: number, z: number, index: number, golden = false) {
    this.index = index;
    const y = terrain.heightAt(x, z);
    this.pos.set(x, y, z);
    this.group.position.set(x, y, z);
    this.cDormant = new THREE.Color(palette.accent).multiplyScalar(golden ? 1.4 : 0.4);
    this.cActive = new THREE.Color(palette.accent2).multiplyScalar(2.4);
    this.cDone = new THREE.Color(palette.accent).multiplyScalar(2.2);
    this.crystalMat = new THREE.MeshBasicMaterial({ color: this.cDormant.clone() });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), this.crystalMat);
    this.crystal.scale.set(0.9, 2.2, 0.9);
    this.crystal.position.y = 3.2;
    this.group.add(this.crystal);
    this.shardMat = new THREE.MeshBasicMaterial({ color: this.cDormant.clone() });
    const sg = new THREE.OctahedronGeometry(0.28, 0);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(sg, this.shardMat);
      this.shards.push(s);
      this.group.add(s);
    }
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.cDormant.clone(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.baseRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.baseRing.position.y = 0.3;
    this.group.add(this.baseRing);
    // stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.4, 2.2, 6).translate(0, 1.1, 0),
      new THREE.MeshStandardMaterial({ color: 0x1c2a30, metalness: 0.8, roughness: 0.4 }),
    );
    this.group.add(stem);

    // Zone outline hugging the terrain
    const pts: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const px = Math.cos(a) * this.zoneRadius;
      const pz = Math.sin(a) * this.zoneRadius;
      pts.push(px, terrain.heightAt(x + px, z + pz) - y + 0.3, pz);
    }
    const zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.zoneMat = new THREE.LineBasicMaterial({ color: this.cActive.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.zone = new THREE.LineLoop(zg, this.zoneMat);
    this.group.add(this.zone);
  }

  setState(s: NodeState) {
    this.state = s;
  }

  update(dt: number, t: number) {
    const target = this.state === 'dormant' ? this.cDormant : this.state === 'active' ? this.cActive : this.cDone;
    this.cur.copy(this.crystalMat.color).lerp(target, 1 - Math.exp(-4 * dt));
    this.crystalMat.color.copy(this.cur);
    this.shardMat.color.copy(this.cur);
    this.ringMat.color.copy(this.cur);
    const spin = this.state === 'active' ? 3 : this.state === 'done' ? 1.2 : 0.5;
    this.crystal.rotation.y += dt * spin;
    this.crystal.position.y = 3.2 + Math.sin(t * 1.4 + this.index) * 0.25;
    this.shards.forEach((s, i) => {
      const a = t * (0.6 + spin * 0.3) + (i / this.shards.length) * Math.PI * 2;
      const r = 1.8 + (this.state === 'active' ? 0.6 * Math.sin(t * 5 + i) : 0);
      s.position.set(Math.cos(a) * r, 3.2 + Math.sin(a * 2 + i) * 0.9, Math.sin(a) * r);
      s.rotation.y = a;
    });
    this.zoneMat.opacity = damp(this.zoneMat.opacity, this.state === 'active' ? 0.75 : 0, 5, dt);
    const gs = this.state === 'active' ? 1.1 : this.state === 'done' ? 1 : 0.8;
    this.baseRing.scale.setScalar(gs + 0.08 * Math.sin(t * 3 + this.index));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
  }
}
