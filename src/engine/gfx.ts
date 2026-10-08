import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from '../util/math';

export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly hemi = new THREE.HemisphereLight(0x88ccff, 0x112211, 0.9);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1.2);
  readonly playerLight = new THREE.PointLight(0x5cffc1, 14, 28, 1.7);
  private pixelRatio: number;
  private lowQualityTimer = 0;
  private frames = 0;
  private fpsAcc = 0;
  fps = 60;
  bloomEnabled = true;
  private adaptive = true;

  constructor(readonly container: HTMLElement) {
    const q = new URLSearchParams(location.search);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.pixelRatio = Number(q.get('scale')) || Math.min(window.devicePixelRatio || 1, 1.75);
    this.adaptive = !q.has('noadapt') && !q.has('scale');
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.scene.add(this.hemi, this.sun, this.sun.target, this.playerLight);
    this.sun.position.set(30, 60, 20);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    if (q.has('nobloom')) this.bloom.enabled = this.bloomEnabled = false;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pixel scale used by point-size shaders. */
  get pointScale() {
    return (this.renderer.domElement.height * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /** Self-tuning quality: drop pixel ratio, then bloom, if the frame rate stays low. */
  adapt(dt: number) {
    this.frames++;
    this.fpsAcc += dt;
    if (this.fpsAcc < 1) return;
    this.fps = this.frames / this.fpsAcc;
    this.frames = 0;
    this.fpsAcc = 0;
    if (!this.adaptive) return;
    if (this.fps < 28) this.lowQualityTimer++;
    else this.lowQualityTimer = Math.max(0, this.lowQualityTimer - 1);
    if (this.lowQualityTimer >= 3) {
      this.lowQualityTimer = 0;
      if (this.pixelRatio > 1) {
        this.pixelRatio = 1;
        this.resize();
      } else if (this.pixelRatio > 0.8) {
        this.pixelRatio = 0.75;
        this.resize();
      } else if (this.bloomEnabled) {
        this.bloomEnabled = false;
        this.bloom.enabled = false;
      }
    }
  }

  setWorldLook(p: { fog: number; fogDensity: number; hemiSky: number; hemiGround: number; sun: number; accent: number }) {
    const fog = new THREE.Color(p.fog);
    this.scene.background = fog;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fog);
      this.scene.fog.density = p.fogDensity;
    } else {
      this.scene.fog = new THREE.FogExp2(fog, p.fogDensity);
    }
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.sun.color.set(p.sun);
    this.playerLight.color.set(p.accent);
  }

  render() {
    this.composer.render();
  }
}

export class CameraRig {
  readonly offset = new THREE.Vector3(0, 18, 13.2);
  readonly pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  zoom = 1;
  zoomTarget = 1;
  zoomRate = 3;
  fovBoost = 0;
  fovTarget = 0;
  private fov = 48;

  constructor(private camera: THREE.PerspectiveCamera) {}

  addShake(a: number) {
    this.shake = Math.min(this.shake + a, 1.6);
  }

  snap(focus: THREE.Vector3) {
    this.look.copy(focus);
    this.pos.copy(focus).addScaledVector(this.offset, this.zoom);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt: number, focus: THREE.Vector3, lead: THREE.Vector3) {
    const k = 7;
    this.zoom = damp(this.zoom, this.zoomTarget, this.zoomRate, dt);
    this.fovBoost = damp(this.fovBoost, this.fovTarget, this.zoomRate, dt);
    this.look.x = damp(this.look.x, focus.x + lead.x, k, dt);
    this.look.y = damp(this.look.y, focus.y + lead.y, k, dt);
    this.look.z = damp(this.look.z, focus.z + lead.z, k, dt);
    this.pos.copy(this.look).addScaledVector(this.offset, this.zoom);
    this.shake = Math.max(0, this.shake - dt * 2.8);
    const s = this.shake * this.shake;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * s,
      this.pos.y + (Math.random() - 0.5) * s,
      this.pos.z + (Math.random() - 0.5) * s,
    );
    this.fov = damp(this.fov, 48 + this.fovBoost, 8, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.look);
  }
}
