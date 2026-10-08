import type { Affinity, LibraryEntry, RunState, ChoiceSet, Choice } from '../types';
import { AFFINITY_META, PERKS, type ComposedStory } from '../story/story';
import { STRATA } from '../story/strata';
import { fmtTime } from '../util/math';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudState {
  hp: number;
  maxHp: number;
  res: number;
  dashReady: number; // 0..1
  surgeReady: boolean;
  plantReady: boolean;
  tiers: Record<Affinity, number>;
  act: string;
  objective: string;
  progress: { label: string; v: number } | null;
  boss: number | null;
  prompt: string | null;
  hint: string | null;
}

export interface MapData {
  R: number;
  player: { x: number; z: number; a: number };
  nodes: { x: number; z: number; state: string }[];
  gate: { x: number; z: number; open: number } | null;
  enemies: { x: number; z: number; boss: boolean }[];
  echoes: { x: number; z: number }[];
  accent: string;
}

type OverlayId = 'title' | 'prologue' | 'choice' | 'timeline' | 'controls' | 'library' | 'pause' | 'death' | 'ending';

export class UI {
  private sayQueue: string[] = [];
  private sayBusy = false;
  private sayTimers: number[] = [];
  private lastHud = '';
  private mapCtx = $<HTMLCanvasElement>('minimap').getContext('2d')!;
  private choiceKeyHandler?: (i: number) => void;

  isOpen(id: OverlayId) {
    return !$(id).classList.contains('hidden');
  }
  anyOverlay() {
    return (['title', 'prologue', 'choice', 'timeline', 'controls', 'library', 'pause', 'death', 'ending'] as OverlayId[]).some((o) => this.isOpen(o));
  }
  show(id: OverlayId) {
    $(id).classList.remove('hidden');
  }
  hide(id: OverlayId) {
    $(id).classList.add('hidden');
  }
  hideAll() {
    (['title', 'prologue', 'choice', 'timeline', 'controls', 'library', 'pause', 'death', 'ending'] as OverlayId[]).forEach((o) => this.hide(o));
  }

  bindClose(onClose: (id: OverlayId) => void) {
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        const ov = b.closest('.overlay') as HTMLElement;
        onClose(ov.id as OverlayId);
      });
    });
  }

  on(id: string, fn: () => void) {
    $(id).addEventListener('click', fn);
  }

  // ---- HUD ------------------------------------------------------------------
  setHudVisible(v: boolean) {
    $('hud').classList.toggle('hidden', !v);
  }

  updateHud(s: HudState) {
    const key = JSON.stringify([Math.round(s.hp), s.maxHp, Math.round(s.res), Math.round(s.dashReady * 20), s.surgeReady, s.plantReady, s.tiers, s.act, s.objective, s.progress && Math.round(s.progress.v * 200), s.progress?.label, s.boss !== null ? Math.round(s.boss * 300) : null, s.prompt, s.hint]);
    if (key === this.lastHud) return;
    this.lastHud = key;
    $('hp-fill').style.transform = `scaleX(${Math.max(0, s.hp / s.maxHp)})`;
    $('hp-text').textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    $('res-fill').style.transform = `scaleX(${Math.min(1, s.res / 100)})`;
    const resBar = $('res-fill').parentElement!;
    resBar.classList.toggle('ready', s.surgeReady);
    $('res-text').textContent = s.surgeReady ? 'SURGE READY [Q]' : 'RESONANCE';
    const dash = $('ab-dash');
    dash.classList.toggle('ready', s.dashReady >= 1);
    (dash.firstElementChild as HTMLElement).style.transform = `scaleX(${s.dashReady})`;
    $('ab-plant').classList.toggle('ready', s.plantReady);
    const aff = $('affinities');
    aff.innerHTML = (['root', 'echo', 'flow'] as Affinity[])
      .filter((a) => s.tiers[a] > 0)
      .map((a) => `<span class="chip" style="color:${AFFINITY_META[a].color}">${AFFINITY_META[a].glyph} ${AFFINITY_META[a].name} ${'I'.repeat(s.tiers[a])}</span>`)
      .join('');
    $('act-name').textContent = s.act;
    $('objective').textContent = s.objective;
    const prog = $('prog');
    prog.classList.toggle('hidden', !s.progress);
    if (s.progress) {
      $('prog-fill').style.transform = `scaleX(${s.progress.v})`;
      $('prog-text').textContent = s.progress.label;
    }
    $('boss-bar').classList.toggle('hidden', s.boss === null);
    if (s.boss !== null) $('boss-fill').style.transform = `scaleX(${Math.max(0, s.boss)})`;
    const prompt = $('prompt');
    prompt.classList.toggle('hidden', !s.prompt);
    if (s.prompt) prompt.innerHTML = s.prompt;
    const hint = $('hint');
    hint.classList.toggle('hidden', !s.hint);
    if (s.hint) hint.innerHTML = s.hint;
  }

  drawMinimap(m: MapData) {
    const ctx = this.mapCtx;
    const W = 180;
    const c = W / 2;
    const sc = (c - 10) / m.R;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(2,16,15,0.65)';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(124,255,214,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, m.R * sc, 0, Math.PI * 2);
    ctx.stroke();
    const P = (x: number, z: number) => [c + x * sc, c + z * sc] as const;
    ctx.fillStyle = 'rgba(176,132,255,0.8)';
    for (const e of m.echoes) {
      const [x, y] = P(e.x, e.z);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    for (const n of m.nodes) {
      const [x, y] = P(n.x, n.z);
      ctx.fillStyle = n.state === 'done' ? '#5cffc1' : n.state === 'active' ? '#ffb86b' : 'rgba(92,255,193,0.35)';
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 4, y);
      ctx.fill();
    }
    if (m.gate) {
      const [x, y] = P(m.gate.x, m.gate.z);
      ctx.strokeStyle = m.gate.open > 0.5 ? '#fff' : 'rgba(255,59,122,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const e of m.enemies) {
      const [x, y] = P(e.x, e.z);
      ctx.fillStyle = '#ff3b7a';
      ctx.beginPath();
      ctx.arc(x, y, e.boss ? 5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    const [px, py] = P(m.player.x, m.player.z);
    ctx.translate(px, py);
    ctx.rotate(-m.player.a + Math.PI);
    ctx.fillStyle = m.accent;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(4, -4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- narration ------------------------------------------------------------
  say(lines: string | string[]) {
    const arr = Array.isArray(lines) ? lines : [lines];
    this.sayQueue.push(...arr);
    while (this.sayQueue.length > 5) this.sayQueue.splice(1, 1);
    if (!this.sayBusy) this.pump();
  }
  clearSay() {
    this.sayQueue.length = 0;
    this.sayTimers.forEach((t) => window.clearTimeout(t));
    this.sayTimers.length = 0;
    this.sayBusy = false;
    $('subtitle-text').classList.remove('on');
  }
  private pump() {
    const line = this.sayQueue.shift();
    const el = $('subtitle-text');
    if (!line) {
      this.sayBusy = false;
      el.classList.remove('on');
      return;
    }
    this.sayBusy = true;
    el.textContent = '';
    el.classList.add('on');
    let i = 0;
    const type = () => {
      i = Math.min(line.length, i + 2);
      el.textContent = line.slice(0, i);
      if (i < line.length) this.sayTimers.push(window.setTimeout(type, 26));
      else {
        const hold = 2200 + line.length * 42;
        this.sayTimers.push(
          window.setTimeout(() => {
            el.classList.remove('on');
            this.sayTimers.push(window.setTimeout(() => this.pump(), 650));
          }, hold),
        );
      }
    };
    type();
  }

  banner(act: string, name: string) {
    const b = $('banner');
    b.classList.add('hidden');
    void b.offsetWidth;
    (b.querySelector('.act') as HTMLElement).textContent = act;
    (b.querySelector('h2') as HTMLElement).textContent = name;
    b.classList.remove('hidden');
    window.setTimeout(() => b.classList.add('hidden'), 5300);
  }

  toast(msg: string) {
    const t = $('toast');
    t.classList.add('hidden');
    void t.offsetWidth;
    t.textContent = msg;
    t.classList.remove('hidden');
  }

  fade(on: boolean, color: 'white' | 'black' = 'white', ms = 900) {
    const f = $('fade');
    f.classList.toggle('dark', color === 'black');
    f.style.transition = `opacity ${ms}ms ease`;
    f.style.opacity = on ? '1' : '0';
    if (ms === 0) void f.offsetWidth; // commit instantly so the next fade starts from here
  }

  hurtFlash() {
    const d = $('damage-flash');
    d.classList.add('on');
    window.setTimeout(() => d.classList.remove('on'), 60);
  }

  // ---- overlays ------------------------------------------------------------------
  prologue(lines: string[], done: () => void) {
    this.show('prologue');
    const p = $('prologue-text');
    let i = 0;
    let busy = false;
    const next = () => {
      if (busy) return;
      if (i >= lines.length) {
        cleanup();
        done();
        return;
      }
      busy = true;
      p.classList.remove('on');
      window.setTimeout(() => {
        p.textContent = lines[i++];
        p.classList.add('on');
        busy = false;
      }, 700);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') next();
    };
    const cleanup = () => {
      window.removeEventListener('keydown', key);
      $('prologue').removeEventListener('click', next);
      p.classList.remove('on');
      this.hide('prologue');
    };
    window.addEventListener('keydown', key);
    $('prologue').addEventListener('click', next);
    next();
  }

  choice(set: ChoiceSet, tiers: Record<Affinity, number>, pick: (c: Choice) => void) {
    $('choice-act').textContent = set.act;
    $('choice-prompt').textContent = set.prompt;
    const cards = $('choice-cards');
    cards.innerHTML = '';
    set.choices.forEach((c, i) => {
      const meta = AFFINITY_META[c.affinity];
      const nextTier = tiers[c.affinity] + 1;
      const perk = PERKS[c.affinity][nextTier - 1];
      const b = document.createElement('button');
      b.className = 'card';
      b.style.setProperty('--c', meta.color);
      b.innerHTML = `<span class="aff">${meta.glyph} ${meta.name} — ${meta.tagline}</span>
        <span class="ttl">${c.title}</span>
        <span class="bl">${c.blurb}</span>
        <span class="perk"><b>${meta.name.toUpperCase()} ${'I'.repeat(Math.min(nextTier, 3))}</b><br>${perk ?? 'Mastery already woven in — your path deepens.'}</span>
        <span class="key">[${i + 1}]</span>`;
      b.addEventListener('click', () => select(i));
      cards.appendChild(b);
    });
    const select = (i: number) => {
      if (!this.isOpen('choice')) return;
      this.choiceKeyHandler = undefined;
      this.hide('choice');
      pick(set.choices[i]);
    };
    this.choiceKeyHandler = select;
    this.show('choice');
  }
  choiceKey(i: number) {
    if (this.choiceKeyHandler) this.choiceKeyHandler(i);
  }

  timeline(run: RunState) {
    const body = $('timeline-body');
    const cur = run.stratumIndex;
    const left = STRATA.map((s, i) => {
      const h = run.history.find((x) => x.stratum === s.id);
      const state = i < cur ? 'past' : i === cur ? 'now' : 'future';
      const color = h?.choice ? AFFINITY_META[h.choice.affinity].color : 'var(--accent)';
      const meta = h ? `${h.kills} purified · ${h.echoes} echoes · ${fmtTime(h.time)}${h.deaths ? ` · reseeded ${h.deaths}×` : ''}` : state === 'now' ? 'you are here' : 'not yet woven';
      return `<div class="tl-item ${state}" style="--c:${color}">
        <h3>${s.name}</h3><div class="meta">${s.act}</div>
        ${h?.choice ? `<div class="ch">${AFFINITY_META[h.choice.affinity].glyph} ${h.choice.title}</div>` : ''}
        <div class="meta">${meta}</div>
        ${h?.mindNote ? `<div class="note">The Mycelial Mind noticed: ${h.mindNote}</div>` : ''}
      </div>`;
    }).join('');
    const rows = (['root', 'echo', 'flow'] as Affinity[])
      .map((a) => {
        const m = AFFINITY_META[a];
        const pips = [1, 2, 3].map((n) => `<i class="pip ${run.tiers[a] >= n ? 'on' : ''}"></i>`).join('');
        const perks = PERKS[a].slice(0, run.tiers[a]).map((p) => `<li>${p}</li>`).join('');
        return `<div style="--c:${m.color}"><div class="tier-row"><span style="color:${m.color}">${m.glyph} ${m.name}</span><span class="pips">${pips}</span></div>${perks ? `<ul class="perk-list">${perks}</ul>` : ''}</div>`;
      })
      .join('');
    body.innerHTML = `<div class="tl">${left}</div>
      <div class="side"><h3>Affinities</h3>${rows}
      <h3>The world so far</h3>
      <div class="echoes-line">${run.echoes.length} echo-tree${run.echoes.length === 1 ? '' : 's'} remember${run.echoes.length === 1 ? 's' : ''} you. ${run.kills} fragment${run.kills === 1 ? '' : 's'} of Static purified. ${run.cycle > 1 ? `Cycle ${run.cycle}.` : ''}</div></div>`;
    this.show('timeline');
  }

  library(entries: LibraryEntry[]) {
    const body = $('library-body');
    body.innerHTML = entries.length
      ? entries
          .slice()
          .reverse()
          .map((e) => `<details><summary>Cycle ${e.cycle} — ${e.title}<small>${e.date}</small></summary><p>${e.text.replace(/</g, '&lt;')}</p></details>`)
          .join('')
      : '<p class="empty">No stories carried home yet. Finish a cycle and it will be kept here.</p>';
    this.show('library');
  }

  death(text: string) {
    $('death-text').textContent = text;
    this.show('death');
  }

  ending(story: ComposedStory) {
    $('ending-title').textContent = story.title;
    const body = $('ending-body');
    body.innerHTML = story.paragraphs.map((p, i) => `<p style="animation-delay:${0.6 + i * 1.4}s">${p.replace(/</g, '&lt;')}</p>`).join('');
    $('ending-stats').textContent = story.stats;
    const menu = document.querySelector('#ending .menu') as HTMLElement;
    menu.style.animationDelay = `${0.6 + story.paragraphs.length * 1.4}s`;
    this.show('ending');
  }

  setMuteLabel(muted: boolean) {
    $('btn-mute').textContent = muted ? 'Unmute' : 'Mute';
  }
  setBloomLabel(on: boolean) {
    $('btn-bloom').textContent = `Bloom: ${on ? 'on' : 'off'}`;
  }
  showTouch(v: boolean) {
    $('touch').classList.toggle('hidden', !v);
  }
  showNoGL() {
    $('nogl').classList.remove('hidden');
  }
}
