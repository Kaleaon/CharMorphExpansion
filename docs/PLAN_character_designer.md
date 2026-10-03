# Character Designer — Research Summary & Proposed Architecture

Status: **PROPOSAL — awaiting approval. No app code has been written.**
Date: 2026-10-03

Legend: **[V]** verified this session by reading the source · **[S]** from search-result snippets only · **[?]** not verified, needs follow-up.

---

## 1. Where the repo stands

The repo is a fork of CharMorph (a Blender add-on, Python, **GPL-3 code**) plus an experimental Android/Filament app (Kotlin) and a submodule `data/` pointing to `Upliner/CharMorph-db`, which holds **mixed-license** characters (see §3). The repo also ships `agpl-3.0.txt` and `gpl-3.0.txt`.

Consequence: **the new app should be a clean-room rewrite**. Reuse *ideas* (layered morph weights, alternative-topology fitting, asset fitting, SL Bento preset), not code or data. That keeps the new codebase free to pick its own license.

## 2. Second Life skeleton — what the source says

Downloaded and parsed `indra/newview/character/avatar_skeleton.xml` and `avatar_lad.xml` from `secondlife/viewer` **[V]**.

- `avatar_skeleton.xml` header: `num_bones="133" num_collision_volumes="26" version="2.0"`. Root is `mPelvis`; spine is `mPelvis → mSpine1 → mSpine2 → mTorso → mSpine3 → mSpine4 → mChest → mNeck → mHead`.
- Each `<bone>` carries `name, aliases, pos, rot, scale, pivot, end, connected, group, support`. `support="base"` = classic pre-Bento bones; `support="extended"` = Bento additions (spine1/2/3/4, face, fingers, wings, tail, hind limbs). 26 collision volumes (`PELVIS, BUTT, BELLY, …`) are nested as `<collision_volume>` under their parent bone and are what *fitted mesh* clothing/bodies weight to.
- `avatar_lad.xml` ("linden avatar definition") defines the **slider system**. Element counts: 255 `param_morph`, 83 `param_skeleton`, 164 `param_driver`, 108 `param_color`, 95 `param_alpha`; 31 `<mesh>` entries (`.llm` binary meshes at several LODs). Example: `Height` is id 33, range −2.3…2, wearable `shape`, group 0 (tweakable), `edit_group="shape_body"`.
- **Key insight for the design:** in SL, the *shape* sliders mostly work by (a) `param_skeleton` — scaling/offsetting bones and collision volumes — and (b) morphs on the Linden system mesh. Third-party mesh bodies (Ruth2, Maitreya, etc.) don't get (b); they follow the shape only through bone + collision-volume deformation (fitted mesh). So a SL-compatible designer must treat **bone deformation as a first-class output of the slider system**, not just vertex morphs.
- Wiki facts **[V]** (Project Bento page, CC-BY-SA 3.0): joint offsets below 0.1 mm have no effect; animations that scale bones don't work with Bento; "the bones in the glb file are aligned differently than the ones in the dae file" in the official Blender human-female resource (so we must pick one convention and test round-trips).
- Bone-count discrepancy: wiki prose says "106 bones + 26 CVs"; the file header says 133 bones. I trust the file header (it's the source of truth) but the 133 probably counts some extra/alias entries — to be reconciled in M2 with an automated test.

**Avastar**: I could not reach avastar.rocks from this environment, and search results had no licensing details **[?]**. From general knowledge, Avastar is a paid, proprietary Blender add-on that provides an SL rig with deform bones (`m*` names) plus control bones. Treat it as a *functional reference only*: do not copy or redistribute its rig, and don't depend on it. Everything we need (names, hierarchy, offsets, collision volumes) is in the viewer's open XML.

## 3. Asset & license research

| Source | What it is | License | Verdict |
|---|---|---|---|
| **SL viewer** `avatar_skeleton.xml`, `avatar_lad.xml` | Skeleton + slider definitions | Repo is **LGPL-2.1 [V]**. The two XML files have no per-file license header **[V]**. No stated carve-out for character data **[V]**. | **Use as a build-time input** (parse, don't fork). Record provenance. Bone names/hierarchy are an interoperability interface. Get a legal opinion before *redistributing the XML verbatim*; safest is to fetch it at build time and ship a generated derived table. |
| SL system `.llm` meshes / Linden morph data | The default Linden avatar | **[?]** unclear | **Do not ship.** Don't base our mesh on it. |
| **Ruth2 / Roth2** (RuthAndRoth org) | Open SL/OpenSim-compatible female/male mesh bodies, standard SL UVs, Bento-rigged, .blend + .dae | **AGPL-3.0 [V]** ("Ruth2 is AGPL licensed, other contents also AGPL unless indicated") | **Flagged — copyleft.** Anything derived (converted meshes, weights, slider targets) is AGPL, and AGPL's network clause could reach a hosted web app. **Do not bundle.** Options: (a) skip; (b) an *optional, user-supplied* import path (user downloads Ruth2 themselves; we only read it) — still needs counsel; (c) ship the whole app AGPL. Needs your decision. |
| **Ruth 2020 / Roth 2020** (ingen-lab) | Older Ruth variant | Marketplace snippet says "Creative Commons Avatar, full permissions" **[S]**; repo has a `Licenses.txt` + `Licenses/` folder I did not read **[?]** | Promising CC alternative but **unverified**. Read `Licenses.txt` before any use. |
| **MakeHuman** base mesh, targets, proxies, system assets | Parametric human, large target set | Since Sept 2020: assets/targets/base mesh are **CC0** ("no matter how you got hold of them") **[S]**; the application code is AGPL | **Best primary candidate.** Verify per-asset license metadata (community assets may be CC-BY or others). Don't use MakeHuman *code*. |
| **MPFB2** (MakeHuman plugin for Blender) | Blender add-on | Code GPLv3; core assets CC0; output CC0 **[S]** | Assets usable (CC0); code is a study reference only. |
| **MB-Lab** | Original Blender character tool | Code GPL-3; **data files AGPL-3**; generated characters inherit AGPL **[S]** | **Avoid** data/meshes. |
| **CharMorph-db** (our submodule) | Characters for CharMorph | Per character: **Vitruvian CC0**, Antonia CC-BY, Reom CC-BY, MB-Lab AGPL **[S]** | **Vitruvian (CC0)** is a strong second base mesh. Antonia/Reom OK with attribution. Never the MB-Lab character. |
| Other CC0 meshes (OpenGameArt, Quaternius, Kenney, etc.) | — | **[?] not researched** | Follow-up task; I won't claim anything about them yet. |

**Hard requirement we'd like but nobody gives us:** a *CC0/CC-BY mesh with SL-compatible UVs and SL-style weighting to mBones + collision volumes*. Ruth2 is the only open one found and it's AGPL. Practical path: **retarget** a CC0 base (MakeHuman or Vitruvian) onto the SL skeleton ourselves (auto-weight, then hand-tune to collision volumes), and provide an SL-UV bake/transfer step. This is real art+tech work and is the main schedule risk (see §7).

## 4. Proposed stack

**One TypeScript codebase, WebGL2 baseline with WebGPU opt-in:**

- **Language/build:** TypeScript, Vite, pnpm workspaces.
- **Rendering:** three.js — `MeshPhysicalMaterial` PBR (clearcoat, sheen, transmission for eyes/skin SSS approximation), custom shaders via `onBeforeCompile` / ShaderMaterial now, and node materials (TSL) once we move to `WebGPURenderer`. Studio lighting: HDRI environment (PMREM) + 3-point rig presets, soft shadows, tone mapping, turntable/orbit camera, background presets. WebGPU is an *upgrade path*, not a dependency, because WebGPU support inside embedded webviews (especially Android WebView) is uneven **[?]** — to be re-checked at M1.
- **Morph/skin engine (custom, not three's built-in morph targets):** sparse delta storage; evaluate in a Web Worker (WASM optional) and upload only dirty vertices, or sum a bounded active set on GPU from a data texture. three's per-target attribute model doesn't scale to hundreds of sliders.
- **UI:** React + a small state store (Zustand); virtualized slider panels; touch-first layout.
- **Shells (all share the same web build):**
  - Web: **PWA** (offline, installable). Ships first.
  - Desktop: **Tauri 2** (small, system webview). Fall back to Electron only if webview GPU quirks bite.
  - Mobile: **Tauri 2 mobile or Capacitor** — decide at M8 after testing the PWA on real devices.
- **Persistence:** IndexedDB (project/characters), File System Access API where available, Tauri fs on desktop.
- **Retire:** the Kotlin/Filament Android app and Blender add-on move to `legacy/` and are frozen.

Why not Unity/Godot/native? They break the single-build-everywhere requirement or pull in large runtimes; web tech gives web + PWA + desktop + mobile with one renderer.

## 5. Core architecture: the parameter graph

```
Slider (UI value, clamped, symmetric/ asymmetric, groups)
   │  drivers (linear / piecewise / expression, like lad.xml param_driver)
   ▼
Parameter graph  ──► morph weights (sparse vertex deltas)
                 ──► bone deltas (offset, scale on bones & collision volumes)   ← SL "shape"
                 ──► material params (skin tone, eye color, roughness, …)
                 ──► alpha/clothing masks
```

Concrete model:

- **MorphTarget**: `{ id, baseMeshId, indices: Uint32Array, deltas: Float32Array, tangent/normal recompute policy, license/provenance }`. Sparse; typically <10 % of vertices.
- **Slider**: `{ id, label, group, min, max, default, symmetry, targets: [{ target, curve }], boneDeltas: [...], materialBindings: [...], sl?: { paramId, name } }` — bipolar sliders map to two targets (−/+).
- **Drivers**: slider A can contribute to slider B's targets (e.g. `Height` → leg length + torso length), mirroring SL's 164 drivers.
- **Layers**: base shape → macro (age/gender/weight/muscle, MakeHuman-style multilinear blend) → region (face/body) → fine detail. Presets = sparse maps of slider→value.
- **Topology independence**: morphs are authored per `BaseMesh`; an `ExtraMesh` (clothes, hair, SL-UV body) follows via a precomputed surface-binding (barycentric on base) — the same idea CharMorph's "alternative topology / fitting" uses, reimplemented.
- **Skeleton module**: loads the generated SL skeleton table; supports FK posing, bone-scale/offset deltas (SL `param_skeleton` semantics, including the 0.1 mm threshold), collision-volume bones, base vs. extended (Bento) toggles; optional IK later.
- **Two export tiers:** (1) *SL-fitted*: bake final vertex positions, weight to mBones + CVs, emit COLLADA/glTF **and** the slider values as an SL shape (for the SL-mapped subset); (2) *general*: full glTF/GLB with morph targets and skeleton for any engine.

## 6. Repo layout (new monorepo, alongside `legacy/`)

```
/
├─ apps/
│  ├─ web/                 # Vite + React PWA (the product)
│  ├─ desktop/             # Tauri 2 shell
│  └─ mobile/              # Tauri-mobile or Capacitor shell
├─ packages/
│  ├─ core/                # parameter graph, sliders, drivers, presets, serialization
│  ├─ morph/               # sparse targets, worker/WASM evaluator, normals
│  ├─ skeleton/            # SL skeleton model, deformation, FK, collision volumes
│  ├─ render/              # three.js engine, PBR materials, shaders, lighting rigs
│  ├─ io/                  # glTF/GLB, COLLADA(.dae), BVH, SL .anim, SL shape, OBJ, MakeHuman .target
│  ├─ assets/              # asset-pack loader + license/provenance manifest schema
│  └─ ui/                  # slider panels, viewport chrome, mobile layouts
├─ tools/
│  ├─ import-sl-skeleton/  # build-time: viewer XML → generated skeleton + param tables
│  ├─ convert-makehuman/   # .target/.obj → our sparse format, with provenance
│  └─ retarget-to-sl/      # auto-weight + collision-volume weighting helper
├─ assets/                 # only CC0 / CC-BY packs, each with LICENSE + MANIFEST.json
├─ docs/
└─ legacy/                 # frozen Blender add-on + Android app (GPL/AGPL contained here)
```

Every shipped asset has a manifest entry (`source URL, license SPDX, author, attribution text, commit/hash`) and CI fails if an asset lacks one or has a disallowed license (AGPL/GPL/unknown) in `assets/`.

## 7. Milestones

| # | Milestone | Done when | Main risk |
|---|---|---|---|
| **M0** | Foundation: monorepo, CI, license gate, move old code to `legacy/`, provenance schema | CI green, license check blocks bad assets | Decide app license (Q1) |
| **M1** | Viewport: three.js scene, PBR material, HDRI + studio lighting rigs, orbit/turntable, test mesh | Smooth on desktop + a mid-range phone | WebGPU-in-webview behavior (decide baseline) |
| **M2** | SL skeleton: import tool generates skeleton + collision volumes from viewer XML; render/pose it; automated test vs XML | Bone/CV counts, hierarchy and rest pose match file | 106-vs-133 reconciliation; glb vs dae axis conventions |
| **M3** | Morph engine + slider framework: sparse targets, worker eval, ~20 body sliders from a CC0 base | 60 fps while dragging on mobile | Normals/tangents recompute cost |
| **M4** | Base content: MakeHuman CC0 base converted; macro + face + detail sliders; presets; save/load | Full slider set round-trips through save/load | Per-asset license auditing |
| **M5** | SL binding: retarget base to SL skeleton, weights to mBones + CVs, bone-delta sliders (`param_skeleton` subset), Height/body-fat etc. mapped to SL IDs | Shape changes move SL bones the same way as SL for mapped sliders | **Biggest risk** — no open CC0 SL-weighted body exists; weighting is hand work |
| **M6** | Export: GLB (with morphs), COLLADA for SL upload, BVH import, SL shape export | Test body uploads to SL and deforms with the SL shape sliders | Verify against a real SL grid (needs your test account or OpenSim) |
| **M7** | Materials & shaders: skin/eye/hair PBR, SSS approximation, custom shader hooks, texture painting basics | Visual quality target signed off | Scope creep |
| **M8** | Packaging: PWA install/offline, Tauri desktop builds, mobile shell, touch UX | Installable on Win/Mac/Linux, iOS/Android | Mobile store/webview constraints |
| **M9+** | Animation playback (SL `.anim`), clothing fitting, hair, Bento animation checks, optional Ruth2 import | — | — |

## 8. Decisions I need from you

1. **License of the new app.** Recommended: permissive (MIT or Apache-2.0) code + CC0/CC-BY assets only. If you *want* Ruth2/Roth2 bundled, the whole product (and any hosted instance) must go AGPL — your call.
2. **Primary base mesh:** MakeHuman CC0 (best slider coverage) vs. Vitruvian CC0 (more modern look). Recommendation: MakeHuman first, Vitruvian as a second character.
3. **SL scope:** Second Life only, or also OpenSimulator (which Ruth2 targets)? Affects testing and export priorities.
4. **SL-weighted body:** are you OK with me retargeting a CC0 base to the SL skeleton myself (M5, weights by hand/auto), rather than waiting for an open SL-weighted body?
5. **Legacy code:** freeze Blender add-on and Android app in `legacy/` (my recommendation) or delete?
6. **Test access to Second Life / OpenSim** to validate uploads (M6)?

## 9. Open items / things I did not verify

- Ruth 2020/Roth 2020 exact license (read `Licenses.txt` + folder).
- Legal status of redistributing viewer `avatar_skeleton.xml`/`avatar_lad.xml` and Linden `.llm` data.
- Avastar's licensing and exact rig layout (site unreachable from here).
- Whether current SL accepts glTF mesh upload directly (I'm planning on COLLADA as the safe path).
- Current WebGPU availability in iOS WKWebView and Android WebView.
- Other CC0 base-mesh sources (OpenGameArt, Quaternius, etc.).

## Sources

- [secondlife/viewer](https://github.com/secondlife/viewer) — `indra/newview/character/avatar_skeleton.xml`, `avatar_lad.xml` (parsed directly)
- [Project Bento Resources and Information](https://wiki.secondlife.com/wiki/Project_Bento_Resources_and_Information)
- [RuthAndRoth/Ruth2](https://github.com/RuthAndRoth/Ruth2) · [ingen-lab/Ruth](https://github.com/ingen-lab/Ruth)
- [MakeHuman: what changed regarding the license in 2020](https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html) · [MakeHuman license page](https://static.makehumancommunity.org/about/license.html)
- [MPFB2 coverage (CG Channel)](https://www.cgchannel.com/2025/03/check-out-open-source-blender-character-generation-plugin-mpfb-2)
- [MB-Lab (Wikipedia)](https://en.wikipedia.org/wiki/MB-Lab) · [CharMorph v0.4.0 (BlenderNation)](https://www.blendernation.com/2025/03/19/charmorph-v0-4-0-character-creator-released/) · [CharMorph docs](https://charmorph-docs.readthedocs.io/en/main/Introduction.html)
- [Vitruvian Project CC0](https://withinamnesia.itch.io/vitruvian-project-cc0)
