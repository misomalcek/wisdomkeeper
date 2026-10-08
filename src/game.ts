import * as THREE from 'three';
import type { Affinity, Choice, EnemyKind, PlayStats, RunState, LibraryEntry } from './types';
import { Gfx, CameraRig } from './engine/gfx';
import { Input } from './engine/input';
import { AudioEngine } from './engine/audio';
import { Particles } from './engine/particles';
import { UI, type HudState } from './ui/ui';
import { setupTouch } from './ui/touch';
import { World } from './world/world';
import { STRATA, type StratumDef } from './story/strata';
import {
  AFFINITY_META, CLOSING_QUOTE, LORE_BARKS, OPENING_QUOTE, PERKS, SECOND_QUOTE, composeStory, emptyTiers, toLibraryEntry,
} from './story/story';
import { MycelialMind, NEUTRAL_LATENT, adaptDifficulty, describeStyle, digest, freshStats } from './systems/mind';
import { Encounter } from './systems/encounter';
import { Player } from './entities/player';
import { Enemy, ENEMY_COST, updateEnemy } from './entities/enemies';
import { BOLT_COLORS, Projectiles } from './entities/projectiles';
import { Pickups, type PickupKind } from './entities/pickups';
import { AFFINITY_COLOR } from './entities/echoes';
import type { MemoryNode } from './world/structures';
import { clamp, damp } from './util/math';
import { updateOcclusion } from './world/occlusion';

type Mode = 'title' | 'prologue' | 'play' | 'choice' | 'transition' | 'dead' | 'ending';

const SAVE_KEY = 'wk.run.v1';
const LIB_KEY = 'wk.library.v1';
const SET_KEY = 'wk.settings.v1';
const HOT = new THREE.Color(0xff3b7a);

interface PendingSpawn {
  kind: EnemyKind;
  x: number;
  z: number;
  t: number;
  fromEvent: boolean;
  fx: number;
}

const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode / quota: the game still works, it just forgets */
    }
  },
  del(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export class Game {
  readonly gfx: Gfx;
  readonly rig: CameraRig;
  readonly input = new Input();
  readonly audio = new AudioEngine();
  readonly ui = new UI();
  readonly particles = new Particles();
  readonly projectiles = new Projectiles();
  readonly pickups = new Pickups();
  readonly player = new Player();
  enemies: Enemy[] = [];
  world!: World;
  def: StratumDef = STRATA[0];
  run!: RunState;
  mind!: MycelialMind;
  stats: PlayStats = freshStats();
  mode: Mode = 'title';
  paused = false;
  time = 0;
  diff = 1;
  enemyTimeScale = 1;
  god = false;

  private last = 0;
  private encounter: Encounter | null = null;
  private pending: PendingSpawn[] = [];
  private boss: Enemy | null = null;
  private bossDown = false;
  private stratumKills = 0;
  private stratumEchoes = 0;
  private stratumDeaths = 0;
  private ambientTimer = 3;
  private pendingNote = '';
  private surgeRing: THREE.Mesh;
  private surgeT = 99;
  private surgeR = 15;
  private slowMoT = 0;
  private titleAngle = 0;
  private tutorial = 0;
  private flow = new THREE.Vector2();
  private mv = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private aimPoint = new THREE.Vector3();
  private lead = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private trans: { t: number; next: number; gate: THREE.Vector3 } | null = null;
  private firstEcho = true;
  private deathTimer = 0;
  private endingStart = 0;
  private story: ReturnType<typeof composeStory> | null = null;

  constructor(root: HTMLElement) {
    this.gfx = new Gfx(root);
    this.rig = new CameraRig(this.gfx.camera);
    this.input.attach(this.gfx.renderer.domElement, () => this.audio.init());
    window.addEventListener('pointerdown', () => this.audio.init(), { once: false });
    if (matchMedia('(pointer: coarse)').matches) {
      setupTouch(this.input, () => this.audio.init());
      this.ui.showTouch(true);
    }

    const scene = this.gfx.scene;
    scene.add(this.particles.points, this.projectiles.group, this.pickups.group, this.player.group, this.player.decalMesh);
    this.surgeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 72).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb084ff).multiplyScalar(3), transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    scene.add(this.surgeRing);

    this.applySettings();
    this.bindUI();
    this.newRun(1);
    this.showTitleWorld();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play' && !this.paused) this.setPaused(true);
    });
  }

  start() {
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- settings / save

  private applySettings() {
    const s = store.get<{ vol: number; muted: boolean; bloom: boolean }>(SET_KEY);
    if (!s) return;
    this.audio.volume = s.vol ?? 0.7;
    this.audio.muted = !!s.muted;
    this.gfx.bloom.enabled = this.gfx.bloomEnabled = s.bloom !== false;
    (document.getElementById('vol') as HTMLInputElement).value = String(Math.round(this.audio.volume * 100));
    this.ui.setMuteLabel(this.audio.muted);
    this.ui.setBloomLabel(this.gfx.bloom.enabled);
  }
  private saveSettings() {
    store.set(SET_KEY, { vol: this.audio.volume, muted: this.audio.muted, bloom: this.gfx.bloom.enabled });
  }
  private saveRun() {
    store.set(SAVE_KEY, this.run);
  }
  private loadRun(): RunState | null {
    const r = store.get<RunState>(SAVE_KEY);
    return r && r.version === 1 && Array.isArray(r.history) && r.stratumIndex >= 0 && r.stratumIndex < STRATA.length ? r : null;
  }
  private library(): LibraryEntry[] {
    return store.get<LibraryEntry[]>(LIB_KEY) ?? [];
  }

  // ---------------------------------------------------------------- UI wiring

  private bindUI() {
    const ui = this.ui;
    ui.on('btn-begin', () => {
      this.audio.init();
      this.audio.sfx('click');
      this.beginNewStory();
    });
    ui.on('btn-continue', () => {
      this.audio.init();
      this.audio.sfx('click');
      const r = this.loadRun();
      if (r) this.continueRun(r);
    });
    ui.on('btn-library', () => ui.library(this.library()));
    ui.on('btn-controls', () => ui.show('controls'));
    ui.bindClose((id) => {
      ui.hide(id);
      if (id === 'timeline' && this.mode !== 'title') ui.show('pause');
    });
    ui.on('btn-resume', () => this.setPaused(false));
    ui.on('btn-layers', () => {
      ui.hide('pause');
      ui.timeline(this.run);
    });
    ui.on('btn-mute', () => {
      ui.setMuteLabel(this.audio.toggleMute());
      this.saveSettings();
    });
    ui.on('btn-bloom', () => {
      this.gfx.bloom.enabled = !this.gfx.bloom.enabled;
      ui.setBloomLabel(this.gfx.bloom.enabled);
      this.saveSettings();
    });
    (document.getElementById('vol') as HTMLInputElement).addEventListener('input', (e) => {
      this.audio.setVolume(Number((e.target as HTMLInputElement).value) / 100);
      this.saveSettings();
    });
    ui.on('btn-title', () => this.toTitle());
    ui.on('btn-reseed', () => this.reseed());
    ui.on('btn-newcycle', () => this.beginNextCycle());
    ui.on('btn-end-title', () => this.toTitle());
    this.refreshTitleButtons();
  }

  private refreshTitleButtons() {
    const r = this.loadRun();
    document.getElementById('btn-continue')!.classList.toggle('hidden', !r || r.stratumIndex === 0);
    if (r && r.stratumIndex > 0) document.getElementById('btn-continue')!.textContent = `Continue · ${STRATA[r.stratumIndex].name}`;
  }

  private setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    if (p) this.ui.show('pause');
    else {
      this.ui.hide('pause');
      this.ui.hide('timeline');
      this.ui.hide('controls');
    }
    this.ui.setMuteLabel(this.audio.muted);
    this.ui.setBloomLabel(this.gfx.bloom.enabled);
  }

  // ---------------------------------------------------------------- run lifecycle

  private newRun(cycle: number) {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.run = {
      version: 1,
      cycle,
      seed,
      stratumIndex: 0,
      tiers: emptyTiers(),
      history: [],
      echoes: [],
      maxHp: 100,
      deaths: 0,
      kills: 0,
      elapsed: 0,
      difficulty: 1 + 0.25 * (cycle - 1),
      latent: [...NEUTRAL_LATENT],
    };
    this.mind = new MycelialMind(seed);
    this.diff = this.run.difficulty;
  }

  private beginNewStory() {
    this.newRun(1);
    store.del(SAVE_KEY);
    this.startPrologue([OPENING_QUOTE, SECOND_QUOTE]);
  }

  private beginNextCycle() {
    const cycle = this.run.cycle + 1;
    this.ui.hide('ending');
    this.newRun(cycle);
    store.del(SAVE_KEY);
    this.startPrologue(['Every ending is a seed.', OPENING_QUOTE, `Cycle ${cycle}. The soil is different this time — and so, perhaps, are you.`]);
  }

  private startPrologue(lines: string[]) {
    this.mode = 'prologue';
    this.ui.hide('title');
    this.ui.fade(false);
    this.ui.prologue(lines, () => {
      this.ui.fade(true, 'black', 0);
      this.enterStratum(0, true);
      this.ui.fade(false, 'black', 1400);
    });
  }

  private continueRun(r: RunState) {
    this.run = r;
    this.mind = new MycelialMind(r.seed);
    this.diff = r.difficulty;
    this.ui.hide('title');
    this.ui.fade(true, 'black', 0);
    this.enterStratum(r.stratumIndex, true);
    this.ui.fade(false, 'black', 1200);
  }

  private toTitle() {
    this.ui.hideAll();
    this.paused = false;
    this.mode = 'title';
    this.clearEntities();
    this.ui.setHudVisible(false);
    this.ui.clearSay();
    this.ui.fade(false);
    this.newRun(1);
    this.showTitleWorld();
    this.refreshTitleButtons();
    this.ui.show('title');
  }

  private buildWorld(def: StratumDef) {
    if (this.world) {
      this.gfx.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.def = def;
    this.world = new World(def, this.run);
    this.gfx.scene.add(this.world.group);
    const p = this.world.palette;
    const lerpC = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
    this.gfx.setWorldLook({
      fog: p.fog,
      fogDensity: p.fogDensity,
      hemiSky: lerpC(p.skyHorizon, p.accent, 0.35),
      hemiGround: lerpC(p.groundHigh, p.accent2, 0.2),
      sun: p.sun,
      accent: p.accent,
    });
    this.gfx.hemi.intensity = def.id === 'return' ? 1.5 : def.id === 'mirror' ? 1.2 : 1.1;
    this.gfx.sun.intensity = def.id === 'return' ? 2.0 : 1.4;
    this.audio.setMood(def.music);
  }

  private showTitleWorld() {
    this.buildWorld(STRATA[0]);
    this.player.reset(0, 6, 100);
    this.player.group.visible = true;
    this.mode = 'title';
    this.focus.set(0, 2, 0);
  }

  private clearEntities() {
    for (const e of this.enemies) this.removeEnemy(e);
    this.enemies = [];
    this.pending = [];
    this.encounter = null;
    this.boss = null;
    this.projectiles.clear();
    this.pickups.clear();
    this.particles.clear();
  }

  private removeEnemy(e: Enemy) {
    this.gfx.scene.remove(e.group);
    e.dispose();
  }

  private enterStratum(index: number, snap: boolean) {
    this.clearEntities();
    this.run.stratumIndex = index;
    this.diff = this.run.difficulty;
    this.buildWorld(STRATA[index]);
    this.stats = freshStats();
    this.stratumKills = this.stratumEchoes = this.stratumDeaths = 0;
    this.bossDown = false;
    this.ambientTimer = 4;
    this.tutorial = 0;
    this.time = 0;
    this.enemyTimeScale = 1;
    this.paused = false;

    const w = this.world;
    this.player.reset(w.startPos.x, w.startPos.z, this.run.maxHp);
    this.player.y = 0;
    this.player.aim = Math.atan2(-w.startPos.x, -w.startPos.z);
    this.player.facing = this.player.aim;
    this.player.applyAffinityLook(this);
    this.focus.set(w.startPos.x, w.startPos.y + 1, w.startPos.z);
    this.rig.snap(this.focus);
    if (snap) {
      this.rig.zoom = 0.2;
      this.rig.fovBoost = 38;
    }
    this.rig.zoomTarget = [0.95, 1.05, 1.15, 1.32, 1.0][index] ?? 1;
    this.rig.fovTarget = 0;
    this.rig.zoomRate = 1.7;

    if (this.def.boss) this.spawnEnemy('boss', 0, 0, false);

    this.mode = 'play';
    this.ui.hideAll();
    this.ui.setHudVisible(true);
    this.ui.clearSay();
    this.ui.banner(this.def.act, this.def.name);
    window.setTimeout(() => {
      if (this.run.stratumIndex !== index) return;
      this.ui.say(this.def.intro);
      if (this.pendingNote && index > 0 && index < 4) this.ui.say(`The Mycelial Mind noticed — ${this.pendingNote}`);
      this.pendingNote = '';
    }, 1800);
    this.saveRun();
  }

  private exitStratum(choice: Choice | null) {
    const f = digest(this.stats, this.run.maxHp);
    const latent = this.mind.latent(f);
    this.pendingNote = describeStyle(f, latent);
    this.run.history.push({
      stratum: this.def.id,
      stratumName: this.def.name,
      choice: choice ? { id: choice.id, affinity: choice.affinity, title: choice.title } : undefined,
      kills: this.stratumKills,
      echoes: this.stratumEchoes,
      deaths: this.stratumDeaths,
      time: this.stats.time,
      mindNote: this.pendingNote,
    });
    this.run.latent = latent;
    this.run.difficulty = adaptDifficulty(this.run.difficulty, f);
    this.startTransition(this.run.stratumIndex + 1);
  }

  private startTransition(next: number) {
    const g = this.world.gate;
    const gatePos = g ? g.pos.clone().setY(g.group.position.y) : this.player.group.position.clone();
    this.trans = { t: 0, next, gate: gatePos };
    this.mode = 'transition';
    this.ui.setHudVisible(false);
    this.ui.fade(true, 'white', 1500);
    this.audio.sfx('gate');
    this.rig.zoomTarget = 0.16;
    this.rig.fovTarget = 40;
    this.rig.zoomRate = 1.8;
    this.projectiles.clearEnemyBolts();
  }

  private updateTransition(dt: number) {
    const t = this.trans!;
    t.t += dt;
    const k = clamp(t.t / 1.6, 0, 1);
    const e = k * k * (3 - 2 * k);
    this.player.x += (t.gate.x - this.player.x) * Math.min(1, dt * 2.6);
    this.player.z += (t.gate.z - this.player.z) * Math.min(1, dt * 2.6);
    this.player.update(this, dt, this.mv.set(0, 0), null, false);
    this.player.group.scale.setScalar(1.3 * (1 - e * 0.8));
    this.focus.copy(t.gate);
    this.updateWorldVisuals(dt, false);
    this.rig.update(dt, this.focus, this.lead.set(0, 0, 0));
    if (this.world.gate) this.world.gate.setOpen(true);
    if (t.t >= 1.75) {
      this.player.group.scale.setScalar(1.3);
      this.trans = null;
      this.enterStratum(t.next, true);
      this.ui.fade(false, 'white', 2000);
    }
  }

  private reseed() {
    this.ui.hide('death');
    this.run.deaths++;
    this.stratumDeaths++;
    const w = this.world;
    this.player.reset(w.checkpoint.x, w.checkpoint.z, this.run.maxHp);
    this.player.hp = this.run.maxHp;
    this.player.res = Math.max(this.player.res, 30);
    for (const e of this.enemies) if (e.kind !== 'boss') e.dead = true;
    this.pending = [];
    this.projectiles.clearEnemyBolts();
    if (this.encounter) {
      this.encounter.node.setState('dormant');
      this.encounter = null;
    }
    this.mode = 'play';
    this.slowMoT = 0;
    this.enemyTimeScale = 1;
    this.focus.set(w.checkpoint.x, w.checkpoint.y + 1, w.checkpoint.z);
    this.rig.snap(this.focus);
    this.particles.burst(new THREE.Vector3(w.checkpoint.x, w.checkpoint.y + 1, w.checkpoint.z), BOLT_COLORS.base, 40, 10, 0.6, 0.9);
    this.audio.sfx('plant');
    this.ui.say('The soil remembers. I rise where I last listened.');
  }

  // ---------------------------------------------------------------- main loop

  private frame = (ms: number) => {
    requestAnimationFrame(this.frame);
    const raw = (ms - this.last) / 1000;
    this.last = ms;
    if (raw <= 0 || raw > 5) return; // first frame / returning from a hidden tab
    const dt = Math.min(raw, 0.05);
    this.gfx.adapt(raw);
    this.handleGlobalKeys();
    try {
      this.tick(dt);
    } catch (err) {
      // never let one bad frame kill the loop
      console.error(err);
    }
    this.particles.setScale(this.gfx.pointScale);
    this.gfx.camera.updateMatrixWorld();
    updateOcclusion(this.gfx.renderer, this.gfx.camera, this.player.group.position);
    this.gfx.render();
    this.input.endFrame();
  };

  private handleGlobalKeys() {
    const k = this.input;
    if (k.wasPressed('KeyM')) this.ui.setMuteLabel(this.audio.toggleMute());
    if (k.wasPressed('Digit1')) this.ui.choiceKey(0);
    if (k.wasPressed('Digit2')) this.ui.choiceKey(1);
    if (k.wasPressed('Digit3')) this.ui.choiceKey(2);
    if (k.wasPressed('Escape')) {
      if (this.ui.isOpen('timeline')) {
        this.ui.hide('timeline');
        if (this.paused) this.ui.show('pause');
      } else if (this.ui.isOpen('controls') || this.ui.isOpen('library')) {
        this.ui.hide('controls');
        this.ui.hide('library');
      } else if (this.mode === 'play') this.setPaused(!this.paused);
    }
    if (k.wasPressed('Tab') && (this.mode === 'play' || this.mode === 'choice')) {
      if (this.ui.isOpen('timeline')) {
        this.ui.hide('timeline');
        if (this.mode === 'play') this.paused = false;
      } else if (this.mode === 'play') {
        this.paused = true;
        this.ui.hide('pause');
        this.ui.timeline(this.run);
      }
    }
  }

  private tick(dt: number) {
    switch (this.mode) {
      case 'title':
        this.updateTitle(dt);
        return;
      case 'prologue':
        return;
      case 'transition':
        this.updateTransition(dt);
        return;
      case 'choice':
        this.updateWorldVisuals(dt, false);
        this.rig.update(dt, this.focus.set(this.player.x, this.player.y, this.player.z), this.lead.set(0, 0, 0));
        return;
      case 'ending':
        this.updateEnding(dt);
        return;
    }
    if (this.paused) return;
    if (this.mode === 'dead') {
      this.deathTimer += dt;
      dt *= 0.3;
      if (this.deathTimer > 1.6 && !this.ui.isOpen('death')) {
        this.ui.death(this.deathText());
      }
    }
    this.updatePlay(dt);
  }

  private deathText() {
    const lines = [
      'Your thread frays — and the mycelium catches it.',
      'The Static takes a sentence. The soil keeps the rest.',
      'A seed does not end when it falls. It begins to listen.',
    ];
    return lines[this.run.deaths % lines.length];
  }

  // ---------------------------------------------------------------- title

  private updateTitle(dt: number) {
    this.time += dt;
    this.titleAngle += dt * 0.07;
    const cam = this.gfx.camera;
    const r = 34;
    cam.position.set(Math.cos(this.titleAngle) * r, 15 + Math.sin(this.time * 0.2) * 1.5, Math.sin(this.titleAngle) * r);
    cam.lookAt(0, 3, 0);
    this.player.update(this, dt, this.mv.set(0, 0), 0, false);
    this.updateWorldVisuals(dt, true);
  }

  // ---------------------------------------------------------------- play

  private updateWorldVisuals(dt: number, title: boolean) {
    this.time += title ? 0 : dt;
    const t = this.time;
    this.world.update(dt, t, this.gfx.camera.position, this.gfx.pointScale, this.player.group.position);
    this.particles.update(dt);
    this.surgeUpdate(dt);
  }

  flowAt(x: number, z: number) {
    return this.world.terrain.flowAt(x, z, this.flow);
  }

  private computeAim(): number | null {
    const inp = this.input;
    if (inp.lastDevice === 'touch') {
      return inp.touchAim.lengthSq() > 0.06 ? Math.atan2(inp.touchAim.x, inp.touchAim.y) : null;
    }
    this.ray.setFromCamera(inp.mouse, this.gfx.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.player.y));
    if (!this.ray.ray.intersectPlane(plane, this.aimPoint)) return null;
    const dx = this.aimPoint.x - this.player.x;
    const dz = this.aimPoint.z - this.player.z;
    if (dx * dx + dz * dz < 0.5) return null;
    return Math.atan2(dx, dz);
  }

  private updatePlay(dt: number) {
    const p = this.player;
    const dead = this.mode === 'dead';
    this.stats.time += dt;
    this.run.elapsed += dt;
    this.time += dt;

    // slow-mo after a surge/boss kill
    if (this.slowMoT > 0) this.slowMoT -= dt;

    const move = this.input.moveVector(this.mv);
    const aim = dead ? null : this.computeAim();
    const wantFire = !dead && this.input.firing;
    p.dead = dead;
    p.update(this, dt, dead ? this.mv.set(0, 0) : move, aim, wantFire);

    if (!dead) {
      this.handleActions();
      this.updateTutorial();
    }

    // encounter
    if (this.encounter && !dead && this.encounter.update(this, dt)) this.completeNode(this.encounter.node);

    // spawns
    this.updatePending(dt);
    if (!dead) this.updateAmbient(dt);

    // enemies
    this.enemyTimeScale = damp(this.enemyTimeScale, 1, 3, dt);
    for (const e of this.enemies) if (!e.dead) updateEnemy(e, this, dt);
    this.enemies = this.enemies.filter((e) => {
      if (e.dead) {
        this.removeEnemy(e);
        return false;
      }
      return true;
    });

    this.projectiles.update(this, dt);
    this.pickups.update(this, dt);
    this.updateTurrets(dt);
    this.updateWorldVisuals(dt, false);

    // camera
    this.focus.set(p.x, p.y, p.z);
    const ldt = this.input.lastDevice === 'mouse' ? 0.22 : 3.5;
    if (this.input.lastDevice === 'mouse' && !dead) {
      this.lead.set((this.aimPoint.x - p.x) * ldt, 0, (this.aimPoint.z - p.z) * ldt);
      const l = this.lead.length();
      if (l > 5) this.lead.multiplyScalar(5 / l);
    } else this.lead.set(Math.sin(p.aim) * ldt, 0, Math.cos(p.aim) * ldt);
    this.rig.update(dt, this.focus, this.lead);

    // audio intensity
    const alive = this.enemies.length;
    this.audio.setIntensity(clamp(alive / 14 + (this.encounter ? 0.25 : 0) + (this.boss && !this.bossDown ? 0.4 : 0), 0, 1));

    this.drawHud();
  }

  private handleActions() {
    const k = this.input;
    const p = this.player;
    if (k.wasPressed('KeyQ')) this.trySurge();
    if (k.wasPressed('KeyR')) this.tryPlant();
    if (k.wasPressed('KeyE')) this.tryInteract();
    if (p.hp <= 0 && this.mode === 'play') this.killPlayer();
  }

  // ---------------------------------------------------------------- spawning

  get pendingSpawnCount() {
    return this.pending.length;
  }

  queueSpawn(kind: EnemyKind, x: number, z: number, fromEvent: boolean) {
    const R = this.world.radius * 0.92;
    const r = Math.hypot(x, z);
    if (r > R) {
      x *= R / r;
      z *= R / r;
    }
    this.pending.push({ kind, x, z, t: kind === 'boss' ? 0.2 : 0.9, fromEvent, fx: 0 });
  }

  private updatePending(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      s.fx -= dt;
      if (s.fx <= 0) {
        s.fx = 0.07;
        const y = this.world.terrain.heightAt(s.x, s.z) + 0.3;
        const a = Math.random() * Math.PI * 2;
        const rad = 1.8 * (s.t / 0.9 + 0.2);
        this.particles.emit(s.x + Math.cos(a) * rad, y, s.z + Math.sin(a) * rad, 0, 2.5, 0, HOT.clone().multiplyScalar(2.2), 0.45, 0.5, 1);
      }
      if (s.t <= 0) {
        this.pending.splice(i, 1);
        this.spawnEnemy(s.kind, s.x, s.z, s.fromEvent);
      }
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, z: number, fromEvent: boolean) {
    if (this.enemies.length > 44) return;
    const e = new Enemy(kind, x, z, this.diff);
    e.fromEvent = fromEvent;
    this.enemies.push(e);
    this.gfx.scene.add(e.group);
    const y = this.world.terrain.heightAt(x, z);
    this.particles.burst(new THREE.Vector3(x, y + 1, z), HOT, kind === 'boss' ? 40 : 10, 6, 0.5, 0.6);
  }

  spawnBudget(budget: number, cx: number, cz: number, fromEvent: boolean) {
    const mix = this.def.mix;
    const kinds = (['mite', 'spitter', 'brute'] as const).filter((k) => mix[k] > 0);
    if (!kinds.length) return;
    let left = budget;
    let guard = 0;
    while (left > 0 && guard++ < 30) {
      const options = kinds.filter((k) => ENEMY_COST[k] <= left);
      if (!options.length) break;
      const total = options.reduce((a, k) => a + mix[k], 0);
      let roll = Math.random() * total;
      let kind = options[0];
      for (const k of options) {
        roll -= mix[k];
        if (roll <= 0) {
          kind = k;
          break;
        }
      }
      left -= ENEMY_COST[kind];
      let x = cx;
      let z = cz;
      for (let tries = 0; tries < 6; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 13 + Math.random() * 7;
        x = cx + Math.cos(a) * r;
        z = cz + Math.sin(a) * r;
        if ((x - this.player.x) ** 2 + (z - this.player.z) ** 2 > 81) break;
      }
      this.queueSpawn(kind, x, z, fromEvent);
    }
  }

  private updateAmbient(dt: number) {
    if (this.def.ambient <= 0 || this.def.boss || this.mode !== 'play' || this.trans) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 2.4;
    const target = Math.round(this.def.ambient * (0.7 + 0.3 * this.diff));
    const ambientAlive = this.enemies.filter((e) => !e.dead && !e.fromEvent).length + this.pending.filter((s) => !s.fromEvent).length;
    if (ambientAlive >= target) return;
    // don't pile onto a finished level
    if (this.world.nodes.length && this.world.nodes.every((n) => n.state === 'done') && this.gateOpen()) return;
    const R = this.world.radius * 0.85;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if ((x - this.player.x) ** 2 + (z - this.player.z) ** 2 < 26 * 26) continue;
      this.spawnBudgetAt(x, z);
      return;
    }
  }

  private spawnBudgetAt(x: number, z: number) {
    const mix = this.def.mix;
    const kinds = (['mite', 'spitter', 'brute'] as const).filter((k) => mix[k] > 0);
    const total = kinds.reduce((a, k) => a + mix[k], 0);
    let roll = Math.random() * total;
    let kind = kinds[0];
    for (const k of kinds) {
      roll -= mix[k];
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    this.queueSpawn(kind, x, z, false);
  }

  // ---------------------------------------------------------------- combat hooks

  damageEnemy(e: Enemy, dmg: number, dirx: number, dirz: number, o: { slow?: number; echo?: boolean }) {
    if (e.dead) return;
    if (e.invuln > 0) {
      e.flash = 0.04;
      return;
    }
    e.hp -= dmg;
    e.flash = 0.09;
    if (!o.echo) this.stats.hits++;
    const l = Math.hypot(dirx, dirz) || 1;
    const k = e.kind === 'boss' ? 0 : e.kind === 'brute' ? 1.5 : 5;
    e.vx += (dirx / l) * k;
    e.vz += (dirz / l) * k;
    if (o.slow) {
      e.slowT = 2.2;
      e.slowF = 1 - o.slow;
    }
    this.particles.burst(new THREE.Vector3(e.x, e.y, e.z), HOT.clone().multiplyScalar(2.5), 4, 5, 0.35, 0.35);
    this.audio.sfx('hit');
    this.player.res = Math.min(100, this.player.res + 0.6);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const pos = new THREE.Vector3(e.x, e.y, e.z);
    this.stratumKills++;
    this.run.kills++;
    this.player.res = Math.min(100, this.player.res + e.value * 3.5);
    this.particles.burst(pos, HOT.clone().multiplyScalar(3), e.kind === 'brute' ? 40 : 18, 9, 0.6, 0.8);
    this.particles.ring(pos, new THREE.Color(0x5cffc1).multiplyScalar(2), 14, 8, 0.4, 0.6);
    this.audio.sfx('kill', e.kind === 'brute' ? 0.6 : 1);
    this.shake(e.kind === 'brute' ? 0.5 : 0.12);
    if (e.kind === 'boss') {
      this.bossDefeated(e);
      return;
    }
    const roll = Math.random();
    if (e.kind === 'brute') {
      this.pickups.drop(e.x, e.z, 'heal');
      this.pickups.drop(e.x, e.z, 'res');
      this.pickups.drop(e.x, e.z, 'res');
    } else if (roll < (e.kind === 'spitter' ? 0.28 : 0.14)) this.pickups.drop(e.x, e.z, 'heal');
    else if (roll < 0.55) this.pickups.drop(e.x, e.z, 'res');
    if (this.run.tiers.root >= 2) this.player.hp = Math.min(this.run.maxHp, this.player.hp + 3);
    if (Math.random() < (e.kind === 'brute' ? 1 : e.kind === 'spitter' ? 0.2 : 0.09)) this.plantEcho(e.x, e.z, 'kill');
    // mycelium answers purification
    this.world.mycelium.seed(e.x, e.z, e.kind === 'brute' ? 4 : 1, 1, 20);
  }

  hurtPlayer(dmg: number, sx: number, sz: number): boolean {
    const p = this.player;
    if (p.dead || p.invuln > 0 || this.god || this.mode !== 'play') return false;
    p.hp -= dmg;
    p.invuln = 0.6;
    p.hurtT = 0.6;
    this.stats.damageTaken += dmg;
    const dx = p.x - sx;
    const dz = p.z - sz;
    const l = Math.hypot(dx, dz) || 1;
    p.vx += (dx / l) * 9;
    p.vz += (dz / l) * 9;
    this.shake(0.7);
    this.ui.hurtFlash();
    this.audio.sfx('hurt');
    this.particles.burst(new THREE.Vector3(p.x, p.y, p.z), HOT.clone().multiplyScalar(2), 14, 8, 0.5, 0.6);
    if (p.hp <= 0) this.killPlayer();
    return true;
  }

  private killPlayer() {
    if (this.mode === 'dead') return;
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    this.mode = 'dead';
    this.deathTimer = 0;
    this.particles.burst(new THREE.Vector3(p.x, p.y, p.z), BOLT_COLORS.base, 60, 12, 0.7, 1.2);
    this.particles.ring(new THREE.Vector3(p.x, p.y, p.z), BOLT_COLORS.base, 40, 14, 0.6, 1);
    this.audio.sfx('surge');
    this.shake(1.2);
  }

  collect(kind: PickupKind) {
    if (kind === 'heal') this.player.hp = Math.min(this.run.maxHp, this.player.hp + 10);
    else this.player.res = Math.min(100, this.player.res + 8);
    this.audio.sfx('pickup', kind === 'heal' ? 1 : 1.3);
    this.particles.burst(new THREE.Vector3(this.player.x, this.player.y, this.player.z), kind === 'heal' ? new THREE.Color(0x7cff6b).multiplyScalar(2.5) : new THREE.Color(0xb084ff).multiplyScalar(2.5), 6, 4, 0.35, 0.4);
  }

  shake(a: number) {
    this.rig.addShake(a);
  }

  // ---------------------------------------------------------------- boss hooks

  bossAwake(e: Enemy) {
    this.boss = e;
    this.ui.say(['…you came back.', 'I am the end of every sentence. Let me finish yours.']);
  }
  bossPhase(_e: Enemy, phase: number) {
    this.ui.say(phase === 2 ? LORE_BARKS.nullPhase2 : LORE_BARKS.nullPhase3);
  }
  private bossDefeated(e: Enemy) {
    this.bossDown = true;
    const pos = new THREE.Vector3(e.x, e.y, e.z);
    this.particles.burst(pos, HOT.clone().multiplyScalar(3.5), 140, 26, 1.2, 1.8);
    this.particles.ring(pos, new THREE.Color(0xe8f4ff).multiplyScalar(3), 90, 30, 1, 1.6);
    this.particles.ring(pos, HOT.clone().multiplyScalar(3), 70, 18, 0.9, 1.6);
    this.audio.sfx('bossdie');
    this.shake(1.6);
    this.slowMoT = 1.2;
    this.enemyTimeScale = 0.2;
    this.projectiles.clearEnemyBolts();
    for (const o of this.enemies) if (o !== e && !o.dead) this.killEnemy(o);
    this.pending = [];
    this.ui.say([...LORE_BARKS.nullDeath, this.def.gateText]);
    // the gate rises where the Warden fell
    const gate = this.world.gate;
    if (gate) {
      gate.group.visible = true;
      gate.setOpen(true);
    }
    this.world.mycelium.seed(e.x, e.z, 24, 0, 100);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.plantEcho(Math.cos(a) * 10, Math.sin(a) * 10, 'node');
    }
    this.audio.sfx('gate');
  }

  // ---------------------------------------------------------------- abilities

  private trySurge() {
    const p = this.player;
    if (p.res < 100 || this.mode !== 'play') {
      if (p.res < 100) this.ui.toast('Resonance not full — purify the Static to fill it.');
      return;
    }
    p.res = 0;
    const tiers = this.run.tiers;
    const origin = new THREE.Vector3(p.x, p.y, p.z);
    this.surgeT = 0;
    this.surgeR = tiers.flow >= 2 ? 20 : 15;
    this.surgeRing.position.set(p.x, this.world.terrain.heightAt(p.x, p.z) + 0.5, p.z);
    this.particles.ring(origin, new THREE.Color(0xb084ff).multiplyScalar(3), 70, 28, 0.8, 0.9);
    this.particles.ring(origin, new THREE.Color(0x5cffc1).multiplyScalar(3), 50, 18, 0.7, 0.9);
    this.audio.sfx('surge');
    this.shake(1);
    p.hp = Math.min(this.run.maxHp, p.hp + 20);
    p.invuln = Math.max(p.invuln, 0.8);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      if (dx * dx + dz * dz < (this.surgeR + e.radius) ** 2) {
        this.damageEnemy(e, e.kind === 'boss' ? 90 : 60, dx, dz, {});
        if (e.kind !== 'boss') {
          const l = Math.hypot(dx, dz) || 1;
          e.vx += (dx / l) * 16;
          e.vz += (dz / l) * 16;
        }
        if (tiers.flow >= 2) {
          e.slowT = 4;
          e.slowF = 0.35;
        }
      }
    }
    this.projectiles.clearEnemyBolts();
    this.world.mycelium.seed(p.x, p.z, 14, 0, 70);
    if (tiers.root >= 3) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        this.world.grove.plant(p.x + Math.cos(a) * 3.2, p.z + Math.sin(a) * 3.2, 'root', { sentinel: true, ttl: 12, scale: 0.8 });
      }
      this.ui.toast('Sentinel Blooms unfurl.');
    }
    if (tiers.echo >= 3) {
      for (const eg of this.world.grove.echoes) {
        if (eg.sentinel || (eg.x - p.x) ** 2 + (eg.z - p.z) ** 2 > 30 * 30) continue;
        const t = this.nearestEnemy(eg.x, eg.z, 40);
        if (!t) continue;
        const ang = Math.atan2(t.x - eg.x, t.z - eg.z);
        for (let i = -1; i <= 1; i++) this.projectiles.firePlayer(eg.x, eg.z, ang + i * 0.12, { dmg: 14, color: BOLT_COLORS.echo, pierce: 1 });
      }
    }
  }

  private surgeUpdate(dt: number) {
    this.surgeT += dt;
    const k = clamp(this.surgeT / 0.55, 0, 1);
    const mat = this.surgeRing.material as THREE.MeshBasicMaterial;
    mat.opacity = k >= 1 ? 0 : (1 - k) * 0.9;
    this.surgeRing.scale.setScalar(Math.max(0.01, k * this.surgeR * 1.05));
  }

  private tryPlant() {
    const p = this.player;
    if (this.mode !== 'play') return;
    if (p.res < 25) {
      this.ui.toast('Planting an echo-tree costs 25 Resonance.');
      return;
    }
    if (this.nearEcho(p.x, p.z, 2.5)) {
      this.ui.toast('An echo already grows here.');
      return;
    }
    if (this.plantEcho(p.x, p.z, 'manual')) p.res -= 25;
  }

  private nearEcho(x: number, z: number, d: number) {
    return this.world.grove.echoes.some((e) => !e.sentinel && (e.x - x) ** 2 + (e.z - z) ** 2 < d * d);
  }

  /** Where the player acted, the world answers with a tree. */
  plantEcho(x: number, z: number, source: 'dash' | 'kill' | 'node' | 'manual'): boolean {
    if (this.stratumEchoes >= 80 || this.nearEcho(x, z, source === 'manual' ? 2.5 : 3.6)) return false;
    if (this.world.terrain.riverAt(x, z) > 0.5) return false;
    const tiers = this.run.tiers;
    const owned = (['root', 'echo', 'flow'] as Affinity[]).filter((a) => tiers[a] > 0);
    const aff: Affinity = owned.length ? owned[Math.floor(Math.random() * owned.length)] : (['root', 'echo', 'flow'] as Affinity[])[Math.floor(Math.random() * 3)];
    const echo = this.world.grove.plant(x, z, aff);
    if (!echo) return false;
    this.stratumEchoes++;
    this.run.echoes.push({ x, z, affinity: aff, stratum: this.def.id, radius: this.world.radius });
    if (this.run.echoes.length > 400) this.run.echoes.shift();
    const near = this.world.mycelium.nearestAnchor(x, z, 30);
    if (near) this.world.mycelium.connect(near, { x, z });
    else this.world.mycelium.addAnchor(x, z);
    this.world.mycelium.addTarget(x, z);
    this.particles.burst(new THREE.Vector3(x, echo.y + 0.5, z), new THREE.Color(AFFINITY_COLOR[aff]).multiplyScalar(2.5), 12, 5, 0.5, 0.7);
    if (source === 'manual' || source === 'node') this.audio.sfx('plant');
    if (this.firstEcho) {
      this.firstEcho = false;
      this.ui.toast('An echo-tree takes root where the story happened.');
    }
    return true;
  }

  private nearestEnemy(x: number, z: number, maxD: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT < 1) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updateTurrets(dt: number) {
    const tiers = this.run.tiers;
    const p = this.player;
    for (const eg of this.world.grove.echoes) {
      const isSentinel = eg.sentinel;
      if (!isSentinel && tiers.echo < 3) continue;
      if (isSentinel && eg.ttl !== undefined && eg.ttl <= 0) continue;
      if ((eg.x - p.x) ** 2 + (eg.z - p.z) ** 2 > 40 * 40) continue;
      eg.shootCD -= dt;
      if (eg.shootCD > 0) continue;
      const range = isSentinel ? 20 : 15;
      const t = this.nearestEnemy(eg.x, eg.z, range);
      if (!t) {
        eg.shootCD = 0.25;
        continue;
      }
      eg.shootCD = isSentinel ? 0.55 : 1.4;
      const ang = Math.atan2(t.x - eg.x, t.z - eg.z);
      this.projectiles.firePlayer(eg.x, eg.z, ang, { dmg: isSentinel ? 8 : 9, color: isSentinel ? BOLT_COLORS.root : BOLT_COLORS.echo, echo: true });
    }
  }

  // ---------------------------------------------------------------- interaction & objectives

  private gateOpen() {
    const g = this.world.gate;
    return !!g && g.group.visible && g.wantOpen;
  }

  private interactTarget(): { kind: 'node' | 'origin' | 'gate'; node?: MemoryNode; label: string } | null {
    if (this.mode !== 'play' || this.encounter) return null;
    const p = this.player;
    const key = this.input.lastDevice === 'touch' ? 'Tap E' : 'E';
    for (const n of this.world.nodes) {
      if (n.state !== 'dormant') continue;
      if ((n.pos.x - p.x) ** 2 + (n.pos.z - p.z) ** 2 < 5 * 5) {
        return this.def.id === 'return'
          ? { kind: 'origin', node: n, label: `<kbd>${key}</kbd> Carry the story home` }
          : { kind: 'node', node: n, label: `<kbd>${key}</kbd> Listen to the ${this.def.nodeLabel}` };
      }
    }
    const g = this.world.gate;
    if (g && this.gateOpen() && g.open > 0.7 && (g.pos.x - p.x) ** 2 + (g.pos.z - p.z) ** 2 < 7.5 * 7.5) {
      return { kind: 'gate', label: `<kbd>${key}</kbd> Enter the Threshold` };
    }
    return null;
  }

  private tryInteract() {
    const t = this.interactTarget();
    if (!t) return;
    if (t.kind === 'node' && t.node) this.startEncounter(t.node);
    else if (t.kind === 'origin') this.finishGame();
    else if (t.kind === 'gate') this.enterGate();
  }

  private startEncounter(node: MemoryNode) {
    node.setState('active');
    this.encounter = new Encounter(node, this.def.index, this.diff);
    this.audio.sfx('node');
    this.shake(0.5);
    this.particles.ring(new THREE.Vector3(node.pos.x, node.pos.y + 1, node.pos.z), new THREE.Color(this.world.palette.accent2).multiplyScalar(3), 50, 16, 0.6, 0.9);
    this.world.mycelium.seed(node.pos.x, node.pos.z, 10, 0, 80);
    this.ui.say(this.def.id === 'seedbed' ? 'It stirs. The Static smells it — hold the ring.' : 'The node sings. Stay inside the ring while the song builds.');
  }

  private completeNode(node: MemoryNode) {
    node.setState('done');
    this.encounter = null;
    this.audio.sfx('node');
    this.shake(0.6);
    const p = new THREE.Vector3(node.pos.x, node.pos.y + 2, node.pos.z);
    this.particles.burst(p, new THREE.Color(this.world.palette.accent).multiplyScalar(3), 60, 12, 0.7, 1.2);
    this.particles.ring(p, new THREE.Color(this.world.palette.accent).multiplyScalar(3), 60, 20, 0.7, 1.2);
    const done = this.world.nodes.filter((n) => n.state === 'done');
    const prev = done.length > 1 ? done[done.length - 2] : null;
    this.world.mycelium.connect(prev ? { x: prev.pos.x, z: prev.pos.z } : { x: this.world.startPos.x, z: this.world.startPos.z }, { x: node.pos.x, z: node.pos.z });
    this.world.mycelium.seed(node.pos.x, node.pos.z, 12, 0, 90);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random();
      this.plantEcho(node.pos.x + Math.cos(a) * 6, node.pos.z + Math.sin(a) * 6, 'node');
    }
    this.world.checkpoint.copy(node.pos).add(new THREE.Vector3(3, 0, 0));
    const frag = this.def.fragments[node.index];
    if (frag) this.ui.say(frag);
    this.run.maxHp += 10;
    this.player.hp = Math.min(this.run.maxHp, this.player.hp + 40);
    this.player.res = Math.min(100, this.player.res + 50);
    this.ui.toast('Memory woven · max health +10');
    if (done.length === this.world.nodes.length && this.world.gate) {
      this.world.gate.setOpen(true);
      this.world.mycelium.connect({ x: node.pos.x, z: node.pos.z }, { x: this.world.gate.pos.x, z: this.world.gate.pos.z });
      this.audio.sfx('gate');
      this.ui.say(this.def.gateText);
    }
  }

  private enterGate() {
    this.audio.sfx('click');
    const choice = this.def.choice;
    if (!choice) {
      this.exitStratum(null);
      return;
    }
    this.mode = 'choice';
    this.ui.say(this.def.id === 'seedbed' ? 'Three ways to listen.' : '');
    this.ui.choice(choice, this.run.tiers, (c) => this.applyChoice(c));
  }

  private applyChoice(c: Choice) {
    this.run.tiers[c.affinity] = Math.min(3, this.run.tiers[c.affinity] + 1);
    this.player.applyAffinityLook(this);
    this.audio.sfx('choice');
    const tier = this.run.tiers[c.affinity];
    this.ui.toast(`${AFFINITY_META[c.affinity].name} ${'I'.repeat(tier)} — ${PERKS[c.affinity][tier - 1]}`);
    this.exitStratum(c);
  }

  private finishGame() {
    if (this.mode !== 'play') return;
    this.mode = 'ending';
    this.endingStart = performance.now();
    this.ui.setHudVisible(false);
    this.ui.clearSay();
    const n = this.world.nodes[0];
    n.setState('done');
    this.audio.sfx('gate');
    this.audio.sfx('node');
    this.particles.burst(new THREE.Vector3(n.pos.x, n.pos.y + 3, n.pos.z), new THREE.Color(0xffd36b).multiplyScalar(3), 120, 20, 0.9, 2);
    this.world.mycelium.seed(0, 0, 30, 0, 140);
    this.ui.fade(true, 'white', 3200);
    // the loop closes: record the finished cycle
    this.run.history.push({
      stratum: this.def.id,
      stratumName: this.def.name,
      kills: this.stratumKills,
      echoes: this.stratumEchoes,
      deaths: this.stratumDeaths,
      time: this.stats.time,
    });
    this.story = composeStory(this.run);
    const lib = this.library();
    lib.push(toLibraryEntry(this.run, this.story));
    store.set(LIB_KEY, lib.slice(-30));
    store.del(SAVE_KEY);
  }

  private updateEnding(dt: number) {
    this.player.update(this, dt, this.mv.set(0, 0), null, false);
    this.updateWorldVisuals(dt, false);
    this.focus.set(this.player.x, this.player.y, this.player.z);
    this.rig.zoomTarget = 0.7;
    this.rig.update(dt, this.focus, this.lead.set(0, 0, 0));
    if (performance.now() - this.endingStart > 3400 && this.story && !this.ui.isOpen('ending')) {
      this.ui.ending(this.story);
      this.ui.fade(false, 'white', 2600);
    }
  }

  private updateTutorial() {
    if (this.def.id !== 'seedbed' || this.run.cycle > 1 || this.tutorial >= 4) return;
    const s = this.stats;
    if (this.tutorial === 0 && s.distance > 8) this.tutorial = 1;
    if (this.tutorial === 1 && s.shots > 8) this.tutorial = 2;
    if (this.tutorial === 2 && s.dashes >= 1) this.tutorial = 3;
    if (this.encounter) this.tutorial = 4;
  }

  private hintText(): string | null {
    if (this.def.id !== 'seedbed' || this.run.cycle > 1 || this.tutorial >= 4 || this.mode !== 'play') return null;
    const touch = this.input.lastDevice === 'touch';
    switch (this.tutorial) {
      case 0:
        return touch ? 'Left stick — move' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — move';
      case 1:
        return touch ? 'Right stick — aim &amp; fire spore bolts' : 'Aim with the mouse · hold <kbd>LMB</kbd> to fire';
      case 2:
        return touch ? 'DASH button — slip through danger' : '<kbd>Space</kbd> — dash through danger';
      default:
        return 'Walk to the glowing seed at the center of the clearing';
    }
  }

  // ---------------------------------------------------------------- HUD

  private drawHud() {
    const p = this.player;
    const w = this.world;
    const done = w.nodes.filter((n) => n.state === 'done').length;
    const total = w.nodes.length;
    const t = this.interactTarget();
    let objective = this.def.objective;
    if (this.def.boss) objective = this.bossDown ? 'Enter the Threshold' : this.boss ? 'Answer the Null Warden' : 'Approach the Hollow Mirror';
    else if (this.def.id !== 'return' && total > 0) objective = done === total ? 'Enter the Threshold' : total > 1 ? `${this.def.objective} (${done}/${total})` : this.def.objective;

    let progress: HudState['progress'] = null;
    let hint = this.hintText();
    if (this.encounter) {
      const enc = this.encounter;
      progress = {
        label: enc.phase === 'cleanup' ? 'Purge the last Static' : enc.inside ? 'Resonating…' : 'Return to the ring!',
        v: enc.phase === 'cleanup' ? 1 : enc.fraction,
      };
      if (!enc.inside && enc.phase === 'running') hint = 'Return to the ring — the song only grows while you stand in it';
    }
    const dashCD = p.dashCD > 0 ? 1 - p.dashCD / (this.run.tiers.flow >= 1 ? 0.55 : 0.9) : 1;
    const s: HudState = {
      hp: p.hp,
      maxHp: this.run.maxHp,
      res: p.res,
      dashReady: clamp(dashCD, 0, 1),
      surgeReady: p.res >= 100,
      plantReady: p.res >= 25,
      tiers: this.run.tiers,
      act: this.def.act,
      objective,
      progress,
      boss: this.boss && this.boss.activated && !this.boss.dead ? this.boss.hp / this.boss.maxHp : null,
      prompt: t ? t.label : null,
      hint,
    };
    this.ui.updateHud(s);
    this.ui.drawMinimap({
      R: w.radius,
      player: { x: p.x, z: p.z, a: p.aim },
      nodes: w.nodes.map((n) => ({ x: n.pos.x, z: n.pos.z, state: n.state })),
      gate: w.gate && w.gate.group.visible ? { x: w.gate.pos.x, z: w.gate.pos.z, open: w.gate.open } : null,
      enemies: this.enemies.filter((e) => !e.dead && e.spawnT >= 1).map((e) => ({ x: e.x, z: e.z, boss: e.kind === 'boss' })),
      echoes: w.grove.echoes.filter((e) => !e.sentinel).map((e) => ({ x: e.x, z: e.z })),
      accent: '#' + new THREE.Color(w.palette.accent).getHexString(),
    });
  }

  // ---------------------------------------------------------------- debug (enabled with ?debug)

  debugGoto(index: number) {
    this.ui.hideAll();
    this.audio.init();
    if (this.mode === 'title') this.newRun(1);
    this.enterStratum(index, true);
  }
  debugCompleteNodes() {
    for (const n of this.world.nodes) if (n.state !== 'done') this.completeNode(n);
  }
  debugKillBoss() {
    if (this.boss) {
      this.boss.activated = true;
      this.boss.invuln = 0;
      this.damageEnemy(this.boss, 99999, 1, 0, {});
    }
  }
  debugState() {
    return {
      mode: this.mode,
      stratum: this.def.id,
      hp: this.player.hp,
      res: this.player.res,
      enemies: this.enemies.length,
      kills: this.run.kills,
      echoes: this.run.echoes.length,
      tiers: this.run.tiers,
      nodes: this.world.nodes.map((n) => n.state),
      gateOpen: this.gateOpen(),
      fps: Math.round(this.gfx.fps),
      encounter: this.encounter ? this.encounter.fraction : null,
      closing: CLOSING_QUOTE.length,
    };
  }
  /** Headless simulation: advance the game n ticks without rendering (used by the test bot). */
  debugStep(n: number, dt = 1 / 30) {
    for (let i = 0; i < n; i++) {
      this.gfx.camera.updateMatrixWorld();
      this.handleGlobalKeys();
      this.tick(dt);
      this.input.endFrame();
    }
  }
  debugPrimaryAction(code: string) {
    this.input.press(code);
  }
  debugAt(x: number, z: number) {
    this.player.x = x;
    this.player.z = z;
  }
}
