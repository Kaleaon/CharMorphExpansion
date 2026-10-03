# Character Designer

A cross-platform (web / desktop / mobile) character designer with PBR rendering,
a slider-driven morph system, and a Second Life–compatible skeleton.

Status: **M0 (foundation)**. See [`docs/PLAN_character_designer.md`](docs/PLAN_character_designer.md)
for the research, architecture and milestone plan.

## Layout

| Path | Purpose |
|---|---|
| `packages/core` | Parameter graph, sliders, presets (stub) |
| `packages/assets` | Asset provenance manifest schema + license validation |
| `tools/license-gate` | CI check: every file in `assets/` needs an allowed-license manifest entry |
| `assets/` | Only CC0 / CC-BY content, each pack with `MANIFEST.json` |
| `legacy/` | Frozen predecessor (Blender add-on, GPL-3/AGPL-3, and Android app). **Not part of the new app.** |

## Develop

```
pnpm install
pnpm run ci  # typecheck + tests + license gate
```

## Licensing

Code: MIT (see `LICENSE`). Assets: CC0 or CC-BY only, enforced by the license gate.
See `CONTRIBUTING.md` for the clean-room rule regarding `legacy/` and copyleft sources.
