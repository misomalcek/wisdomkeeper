import * as THREE from 'three';
import { fbm, makeNoise2D, type Noise2D } from '../util/rng';
import { smoothstep } from '../util/math';
import type { Palette } from '../story/strata';

export interface TerrainOpts {
  radius: number;
  amp: number;
  freq: number;
  river: boolean;
  seed: number;
  palette: Palette;
  /** 0..1 how strongly the circuit-grid shows through. */
  grid: number;
}

export const MAX_LIGHTS = 10;

/**
 * Heightfield arena. Height, river mask and flow are analytic so entities can
 * query them every frame without touching the mesh.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  private noise: Noise2D;
  private amp: number;
  private freq: number;
  private river: boolean;
  private riverA: number;
  private riverF: number;
  private riverP: number;
  private riverW: number;
  readonly uniforms: Record<string, THREE.IUniform>;
  private lightArr: THREE.Vector4[] = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -9999, 0, 0));

  constructor(o: TerrainOpts) {
    this.radius = o.radius;
    this.noise = makeNoise2D(o.seed);
    this.amp = o.amp;
    this.freq = o.freq;
    this.river = o.river;
    this.riverA = o.radius * 0.18;
    this.riverF = 0.055;
    this.riverP = (o.seed % 628) / 100;
    this.riverW = 6.5;

    const size = o.radius * 3.4;
    const seg = Math.min(260, Math.round(size / 0.75));
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const riverAttr = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(i, this.heightAt(x, z));
      riverAttr[i] = this.riverAt(x, z);
    }
    geo.setAttribute('aRiver', new THREE.BufferAttribute(riverAttr, 1));
    geo.computeVertexNormals();
    geo.deleteAttribute('uv');

    const c = (hex: number) => new THREE.Color(hex);
    this.uniforms = {
      uTime: { value: 0 },
      uBase: { value: c(o.palette.groundBase) },
      uHigh: { value: c(o.palette.groundHigh) },
      uAccent: { value: c(o.palette.accent) },
      uAccent2: { value: c(o.palette.accent2) },
      uRiver: { value: c(o.palette.river) },
      uFogColor: { value: c(o.palette.fog) },
      uFogDensity: { value: o.palette.fogDensity },
      uGrid: { value: o.grid },
      uRadius: { value: o.radius },
      uLights: { value: this.lightArr },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aRiver;
        varying vec3 vWorld; varying vec3 vN; varying float vRiver; varying float vDist;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vN = normalize(normalMatrix * normal); vRiver = aRiver;
          vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        #define NL ${MAX_LIGHTS}
        uniform float uTime; uniform vec3 uBase, uHigh, uAccent, uAccent2, uRiver, uFogColor;
        uniform float uFogDensity, uGrid, uRadius; uniform vec4 uLights[NL];
        varying vec3 vWorld; varying vec3 vN; varying float vRiver; varying float vDist;
        float gridLine(vec2 p, float scale){
          vec2 q = p * scale;
          vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
          return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
        }
        void main(){
          vec3 n = normalize(vN);
          float diff = clamp(dot(n, normalize(vec3(0.35, 1.0, 0.25))), 0.0, 1.0);
          float h = smoothstep(-2.0, 7.0, vWorld.y);
          vec3 col = mix(uBase, uHigh, h) * (0.45 + 0.75 * diff);

          float glow = 0.0;
          for (int i = 0; i < NL; i++) {
            vec4 L = uLights[i];
            vec2 d = vWorld.xz - L.xz;
            glow += L.w * exp(-dot(d, d) / (L.y > -9000.0 ? 90.0 : 1.0));
          }
          glow = clamp(glow, 0.0, 1.6);

          float g1 = gridLine(vWorld.xz, 0.25);
          float g2 = gridLine(vWorld.xz, 0.05);
          float fade = 1.0 - smoothstep(30.0, 80.0, vDist);
          float lines = (g1 * 0.35 + g2 * 0.9) * uGrid * (0.3 + glow * 1.5) * fade;
          col += mix(uAccent, uAccent2, 0.5 + 0.5 * sin(vWorld.x * 0.05 + uTime * 0.2)) * lines;
          col += uAccent * glow * 0.05 * (0.4 + diff);

          // river of light
          if (vRiver > 0.001) {
            float flow = sin(vWorld.z * 0.7 - uTime * 2.2 + sin(vWorld.x * 0.6) * 1.5) * 0.5 + 0.5;
            float flow2 = sin(vWorld.z * 1.9 - uTime * 3.4 + vWorld.x * 0.8) * 0.5 + 0.5;
            vec3 rc = uRiver * (0.55 + 0.9 * flow * flow2) + uAccent2 * 0.12 * glow;
            col = mix(col, rc, smoothstep(0.0, 0.7, vRiver));
          }

          // arena rim: a thin bright seam where the playable bowl ends
          float r = length(vWorld.xz);
          float rd = abs(r - uRadius);
          float rim = (1.0 - smoothstep(0.0, 0.35, rd)) * (0.55 + 0.45 * sin(atan(vWorld.z, vWorld.x) * 40.0 + uTime));
          col += uAccent2 * rim * 0.45 + uAccent2 * exp(-rd * rd * 0.08) * 0.05;

          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  private centerX(z: number) {
    return this.riverA * Math.sin(z * this.riverF + this.riverP) + this.riverA * 0.4 * Math.sin(z * this.riverF * 2.3 + 1.7);
  }

  /** 0 outside the river, 1 in the channel's core. */
  riverAt(x: number, z: number) {
    if (!this.river) return 0;
    const d = Math.abs(x - this.centerX(z));
    return 1 - smoothstep(this.riverW * 0.35, this.riverW, d);
  }

  /** Writes the current's direction (xz plane, +z downstream) scaled by strength. */
  flowAt(x: number, z: number, out: THREE.Vector2) {
    const r = this.riverAt(x, z);
    if (r <= 0) return out.set(0, 0);
    const dx = (this.centerX(z + 1) - this.centerX(z - 1)) / 2;
    out.set(dx, 1).normalize().multiplyScalar(r * 5.5);
    return out;
  }

  heightAt(x: number, z: number) {
    const r = Math.hypot(x, z);
    let h = fbm(this.noise, x * this.freq, z * this.freq, 4) * this.amp * 2;
    h *= 0.3 + 0.7 * smoothstep(5, 22, r);
    h += smoothstep(this.radius * 0.94, this.radius * 1.35, r) * 22;
    if (this.river) h -= this.riverAt(x, z) * 1.6;
    return h;
  }

  /** Feed up to MAX_LIGHTS glow sources (x, z, strength). */
  setGlow(i: number, x: number, z: number, strength: number) {
    if (i >= MAX_LIGHTS) return;
    this.lightArr[i].set(x, 0, z, strength);
    // y flag: > -9000 marks the slot as live
  }
  clearGlowFrom(i: number) {
    for (let k = i; k < MAX_LIGHTS; k++) this.lightArr[k].set(0, -9999, 0, 0);
  }

  update(t: number) {
    this.uniforms.uTime.value = t;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
