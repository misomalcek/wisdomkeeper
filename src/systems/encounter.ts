import type { Game } from '../game';
import type { MemoryNode } from '../world/structures';
import { clamp } from '../util/math';

/** "Hold the zone": while you stand in a node's ring it resonates, and the Static answers in waves. */
export class Encounter {
  progress = 0; // seconds spent inside the zone
  elapsed = 0;
  wave = 0;
  private waveTimer = 0.8;
  phase: 'running' | 'cleanup' = 'running';
  readonly duration: number;
  inside = true;

  constructor(readonly node: MemoryNode, stratumIndex: number, diff: number) {
    this.duration = 12 + 2 * stratumIndex + (diff - 1) * 3;
  }

  get fraction() {
    return clamp(this.progress / this.duration, 0, 1);
  }

  /** Returns true once the encounter is finished. */
  update(g: Game, dt: number): boolean {
    this.elapsed += dt;
    const p = g.player;
    this.inside = (p.x - this.node.pos.x) ** 2 + (p.z - this.node.pos.z) ** 2 < (this.node.zoneRadius * 1.1) ** 2;
    if (this.phase === 'running') {
      if (this.inside) this.progress += dt;
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        const interval = clamp(5.4 - this.wave * 0.3, 3.2, 5.4);
        this.waveTimer = interval;
        const alive = g.enemies.filter((e) => !e.dead && e.fromEvent).length + g.pendingSpawnCount;
        if (alive < 14) {
          const budget = g.def.waveBase * (1 + this.wave * 0.22) * (0.75 + 0.25 * g.diff);
          g.spawnBudget(Math.round(budget), this.node.pos.x, this.node.pos.z, true);
          this.wave++;
        }
      }
      if (this.progress >= this.duration) {
        this.phase = 'cleanup';
        g.ui.say('The song holds. Only the last of the Static remains.');
      }
    } else {
      const left = g.enemies.some((e) => !e.dead && e.fromEvent) || g.pendingSpawnCount > 0;
      if (!left) return true;
    }
    return false;
  }
}
