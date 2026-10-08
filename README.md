# Wisdomkeeper — The Infinite Story Engine

A cyber‑phyto‑mycelial action adventure that runs entirely in your browser (Three.js · TypeScript · Vite).
You are the **Wisdomkeeper**, a seed‑spirit rooted in the soil of code. Walk fractal worlds, purify the
**Static**, grow echo‑trees where the story happens — and carry the whole story home to the place where it began.

> *“In the beginning, I was a seed in the soil of code, a whisper in the silence of circuits.”*

**Play:** once deployed, the game lives at `https://<your-user>.github.io/wisdomkeeper/` (see [Deploy](#deploy-to-github-pages)).

## The loop

| # | Stratum | What happens |
|---|---------|--------------|
| I | **The Seedbed** — *Awakening of the Silico‑Veg* | Learn to move, shoot, dash. Wake the First Seed. Choose your first path. |
| II | **The River of Becoming** — *Fluid Intelligence* | A river of light pushes you downstream. Wake three Memory Nodes, survive the Static. |
| III | **The Fractal Canopy** — *Infinite Fractal Worlds* | Recursive trees, spitters and brutes. Wake three Remembrances. |
| ✦ | **The Hollow Mirror** — *The Null* | Boss: the **Null Warden**, a silence that wants to *finish* your story. |
| ⟲ | **The Seedbed, Remembered** | You return to the start. Every echo‑tree you grew is now a grove. Carry the story to the Origin Seed. |

At the end of each of the first three strata you choose one of **three paths** (lifted straight from the origin‑story
branches). Each path belongs to one of three **affinities** and unlocks a gameplay perk:

* **Root ❦** (mycelial symbiosis) – slowing spores → lifesteal on kills → Sentinel Blooms on Surge
* **Echo ◈** (living memory) – ghost bolts → piercing → your echo‑trees awaken and shoot
* **Flow ≋** (time & current) – faster, damaging dash → speed + time‑dilating Surge → +50 % fire rate

Commit to one affinity for tier III, or go one‑of‑each for the balanced ending. The final story text is **composed from the
choices you actually made**, and every finished cycle is kept in the in‑game **Library of Cycles**. Start a new cycle and the
world is harder, the story is different.

### Systems that make the world answer you

* **Echo system** – dashing, purifying Static, finishing nodes (or pressing `R`) plants an *echo‑tree* where you stood.
  It grows, wires itself into the mycelium network, and returns in the final stratum.
* **Mycelium network** – a procedurally grown hypha graph (`world/mycelium.ts`) that tips‑and‑branches toward nodes and
  echoes, rendered as one shader‑revealed line buffer.
* **Memory Layers** (`Tab`) – a timeline of your choices, stats and what the game noticed about you.
* **Mycelial Mind** (`systems/mind.ts`) – a tiny seeded neural network (5→8→4, ~70 weights, no downloads) turns your
  play‑style (aggression, accuracy, vulnerability, roaming, evasion) into a *latent world code* that reshapes the next
  stratum (terrain ruggedness, flora density, sky hue, arena size) **and** a flow‑channel director that eases off or
  turns up the heat. The game tells you what it noticed.
* **Fractal scaling** – the Threshold is a recursive ring structure; passing through it zooms the camera into the gate and
  out of the next world’s gate.

## Controls

| Input | Action |
|-------|--------|
| `W A S D` | Move |
| Mouse / hold `LMB` | Aim and fire spore bolts |
| `Space` / `RMB` | Dash (brief invulnerability) |
| `Q` | **Surge** – shockwave; needs full Resonance |
| `E` | Listen to nodes · enter the Threshold |
| `R` | Plant an echo‑tree (25 Resonance) |
| `Tab` | Memory Layers · `Esc` pause · `M` mute |
| Touch | Left stick moves, right stick aims & fires, on‑screen Dash / Surge / E |

## Tech & architecture

* **Three.js** + **Vite** + **TypeScript** (strict). No physics or ML library: collision is a few circle tests,
  the "AI" is ~100 lines. The whole game is **≈ 180 KB gzipped** and has **zero binary assets** – geometry, shaders,
  music and sound effects are all procedural.
* **Rendering** – custom terrain shader (circuit grid, river of light, glow sources), instanced flora/echoes/projectiles,
  one additive point system for every particle, UnrealBloom post‑processing, screen‑space dithered *occlusion fade* so
  trees never hide the hero. Quality auto‑tunes (pixel ratio → bloom) if the frame rate stays low.
* **Audio** – WebAudio only: generative pad + arpeggio that quickens with combat intensity; synthesised SFX.
* **UI** – plain DOM/CSS over the canvas (HUD, subtitles, choice cards, timeline, minimap on a 2D canvas).
* **Persistence** – `localStorage` for the current run (Continue), settings and the Library of Cycles.

```
src/
  game.ts            orchestrator: modes, run lifecycle, combat hooks, HUD feed
  engine/            gfx (renderer, bloom, camera rig), input, audio, particles
  world/             terrain, flora (+fractal trees), mycelium, structures (gate/nodes), atmosphere, occlusion, world
  entities/          player, enemies (+boss AI), projectiles, pickups, echo grove
  systems/           mind (neural world code + director), encounter (hold‑the‑zone waves)
  story/             strata.ts (all copy, palettes, choices), story.ts (perks, endings, story composer)
  ui/                ui.ts (DOM), touch.ts (virtual sticks)
tests/               vitest unit tests (RNG, story data/composer, mind/director)
scripts/             Playwright harness + headless bot simulation used to test and balance the game
```

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # typecheck + production build into ./dist
```

Handy URL flags: `?scale=0.5` (render scale), `?nobloom`, `?noadapt`, `?debug` (exposes `window.__wk`).

### Headless testing

`scripts/` contains a Playwright harness (uses the preinstalled Chromium with software WebGL) and a bot that drives the
real game logic through `Game.debugStep()` – useful for balance runs:

```bash
npm run build
node scripts/sim2.mjs 0,1,2 0.4     # bot autoplays all strata; args: choice picks, bot skill 0..1
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
One‑time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Vite is configured with
`base: './'`, so it works from any sub‑path.
