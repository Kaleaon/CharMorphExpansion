# Character Designer

A cross-platform (web / desktop / mobile) character designer with PBR rendering,
a slider-driven morph system, and a Second Life–compatible skeleton.

Status: **M6 (export) in progress — LL mesh export done; COLLADA, GLB, BVH and shape export pending**. See [`docs/PLAN_character_designer.md`](docs/PLAN_character_designer.md)
for the research, architecture and milestone plan.

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Slider/macro model: bipolar sliders, multilinear macros, presets |
| `packages/packs` | Lazy-pack manager: downloads optional morph packs on demand and extends the live model + worker |
| `packages/storage` | Saved-character library (IndexedDB with in-memory fallback) |
| `packages/morph` | Sparse morph targets: pack formats, incremental engine, Web Worker client |
| `tools/convert-makehuman` | Builds `assets/makehuman-hm08/` from the pinned CC0 MakeHuman assets (`node tools/convert-makehuman/convert.ts`) |
| `packages/render` | three.js viewport: PBR, IBL + lighting presets, shadows, orbit/turntable |
| `packages/skeleton` | SL avatar skeleton (133 joints, 26 collision volumes) with the viewer's transform rules, and the SL body-shape model (186 params, drivers) |
| `packages/rig` | The MakeHuman body as an SL rigged mesh: joint correspondences, T-pose retarget, skinning, custom rest skeleton, SL-slider fit |
| `tools/opensim` | Run a real OpenSim 0.9.3 locally for integration tests (`pnpm opensim:start`, `opensim:login`, `opensim:stop`) |
| `tools/import-sl-skeleton` | Regenerates the skeleton table from the pinned SL viewer commit (`node tools/import-sl-skeleton/import.ts [--check]`) |
| `apps/web` | Vite + React app (`pnpm --filter @charmorph/web dev`) |
| `packages/assets` | Asset provenance manifest schema + license validation |
| `tools/license-gate` | CI check: every file in `assets/` needs an allowed-license manifest entry |
| `assets/` | Only CC0 / CC-BY content, each pack with `MANIFEST.json` (`makehuman-hm08`: base body + core targets; `-age`, `-face`, `-body`: lazy packs; all CC0) |
| `legacy/` | Frozen predecessor (Blender add-on, GPL-3/AGPL-3, and Android app). **Not part of the new app.** |

## Develop

```
pnpm install
pnpm run ci  # typecheck + tests + license gate
```

## Licensing

Code: MIT (see `LICENSE`). Assets: CC0 or CC-BY only, enforced by the license gate.
See `CONTRIBUTING.md` for the clean-room rule regarding `legacy/` and copyleft sources.
