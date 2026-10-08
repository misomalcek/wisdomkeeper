export type Affinity = 'root' | 'echo' | 'flow';
export type StratumId = 'seedbed' | 'river' | 'canopy' | 'mirror' | 'return';
export type EnemyKind = 'mite' | 'spitter' | 'brute' | 'boss';

export interface Choice {
  id: string;
  affinity: Affinity;
  title: string;
  blurb: string;
  /** First-person line stitched into the final story. */
  epilogue: string;
}

export interface ChoiceSet {
  act: string;
  prompt: string;
  choices: Choice[];
}

export interface HistoryEntry {
  stratum: StratumId;
  stratumName: string;
  choice?: { id: string; affinity: Affinity; title: string };
  kills: number;
  echoes: number;
  deaths: number;
  time: number;
  /** What the Mycelial Mind noticed about the player in this stratum. */
  mindNote?: string;
}

export interface EchoRecord {
  x: number;
  z: number;
  affinity: Affinity;
  stratum: StratumId;
  /** Stratum radius at planting time, so the Return can rescale positions. */
  radius: number;
}

export interface PlayStats {
  shots: number;
  hits: number;
  damageTaken: number;
  distance: number;
  time: number;
  combatTime: number;
  dashes: number;
}

export interface RunState {
  version: 1;
  cycle: number;
  seed: number;
  stratumIndex: number;
  tiers: Record<Affinity, number>;
  history: HistoryEntry[];
  echoes: EchoRecord[];
  maxHp: number;
  deaths: number;
  kills: number;
  elapsed: number;
  difficulty: number;
  /** Latent world code produced by the Mycelial Mind from player style. */
  latent: number[];
}

export interface LibraryEntry {
  cycle: number;
  title: string;
  ending: string;
  text: string;
  date: string;
}
