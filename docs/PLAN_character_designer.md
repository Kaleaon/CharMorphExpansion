# Character Designer — Research Summary & Proposed Architecture

Status: **APPROVED. M0 done; M1 (viewport) implemented, on-device performance check pending; M2 (SL skeleton) implemented; M3 (morph engine + sliders) implemented, on-device performance check pending; M4 (lazy packs, full slider set, library) implemented; M5 (SL binding) implemented except fitted-mesh weights and any in-world verification; M6 (export) next.**

Decisions (approved): MIT code + CC0/CC-BY assets only · MakeHuman CC0 first, Vitruvian second · Second Life only (OpenSim out of scope for now) · SL retarget of a CC0 base done in-house (M5) · old Blender add-on and Android app frozen in `legacy/` · no SL/OpenSim test account yet, so M6 upload validation stays offline until one is available.
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
- Bone count (resolved in M2, viewer commit `18648fc5`): the file has **133 joints = 26 classic (`support="base"`) + 107 Bento (`extended`)**, plus **26 collision volumes**, and the header agrees with the parsed content. The wiki's "106 bones" figure does not match the file; I could not explain it, so the file is treated as the source of truth. Rest data facts (asserted in tests): every joint has zero rest rotation and unit scale, `pos == pivot` except the two toe joints, and the rest pose is left/right symmetric to within 1 cm.

**Avastar**: I could not reach avastar.rocks from this environment, and search results had no licensing details **[?]**. From general knowledge, Avastar is a paid, proprietary Blender add-on that provides an SL rig with deform bones (`m*` names) plus control bones. Treat it as a *functional reference only*: do not copy or redistribute its rig, and don't depend on it. Everything we need (names, hierarchy, offsets, collision volumes) is in the viewer's open XML.

## 3. Asset & license research

| Source | What it is | License | Verdict |
|---|---|---|---|
| **SL viewer** `avatar_skeleton.xml`, `avatar_lad.xml` | Skeleton + slider definitions | Repo is **LGPL-2.1 [V]**. The two XML files have no per-file license header **[V]**. No stated carve-out for character data **[V]**. | **Use as a build-time input** (parse, don't fork). Record provenance. Bone names/hierarchy are an interoperability interface. Get a legal opinion before *redistributing the XML verbatim*; safest is to fetch it at build time and ship a generated derived table. |
| SL system `.llm` meshes / Linden morph data | The default Linden avatar | **[?]** unclear | **Do not ship.** Don't base our mesh on it. |
| **Ruth2 / Roth2** (RuthAndRoth org) | Open SL/OpenSim-compatible female/male mesh bodies, standard SL UVs, Bento-rigged, .blend + .dae | **AGPL-3.0 [V]** ("Ruth2 is AGPL licensed, other contents also AGPL unless indicated") | **Flagged — copyleft.** Anything derived (converted meshes, weights, slider targets) is AGPL, and AGPL's network clause could reach a hosted web app. **Do not bundle.** Options: (a) skip; (b) an *optional, user-supplied* import path (user downloads Ruth2 themselves; we only read it) — still needs counsel; (c) ship the whole app AGPL. Needs your decision. |
| **Ruth 2020 / Roth 2020** (ingen-lab) | Older Ruth variant | Marketplace snippet says "Creative Commons Avatar, full permissions" **[S]**; repo has a `Licenses.txt` + `Licenses/` folder I did not read **[?]** | Promising CC alternative but **unverified**. Read `Licenses.txt` before any use. |
| **MakeHuman** base mesh, targets, proxies, system assets | Parametric human, large target set | Since Sept 2020: assets/targets/base mesh are **CC0** — **[V] in M3**: `LICENSE.md` §C and `LICENSE.ASSETS.md` of `makehumancommunity/makehuman` (commit `a8bc2d5`), and every `base.obj`/`.target` header says "explicitly released as CC0 in september 2020". The application code is AGPL (not used) | **Best primary candidate.** Verify per-asset license metadata (community assets may be CC-BY or others). Don't use MakeHuman *code*. |
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


## M2 notes (SL skeleton) — assumptions to re-verify

- `packages/skeleton/src/generated/sl-skeleton.json` is a **derived table** (names, hierarchy, rest transforms) generated by `tools/import-sl-skeleton` from the pinned viewer commit, with source URL, commit and SHA-256 recorded inside. It is committed so the app builds offline. The LGPL-2.1 status of the XML itself is still unreviewed by counsel (see §3).
- Shape deltas are modelled as **additive** per-joint `scale` and `offset` on top of the rest values (the structure of `param_skeleton` in `avatar_lad.xml`). Whether the viewer applies them exactly this way (including scale propagating to child offsets) is inferred, not verified; M5 must check against the viewer source.
- Collision-volume `scale` is drawn as ellipsoid **semi-axes**; chosen because the result looks anatomically right (pelvis ≈ 0.32 m wide), not from documentation. Euler order for CV rotations is assumed XYZ; all joint rotations are zero so only CV display depends on it.
- Coordinates inside `packages/skeleton` are SL-native (+X forward, +Y left, +Z up); the viewport applies a fixed basis change (`SL_TO_THREE`).
- Not done yet: glTF vs COLLADA bone-axis round-trip (M6), the `avatar_lad.xml` slider import (M3/M5).


## M3 notes (morph engine + sliders)

**What exists**
- `packages/core`: `CharacterModel` — sliders (bipolar/unipolar, multi-binding so one slider can drive left+right limbs), multilinear **macro groups** over shared variables (scalar with anchors, or *simplex* such as ethnicity whose components stay normalized), presets (`cm-preset/1`, only non-defaults stored), validation.
- `packages/morph`: binary pack formats (`cm-mesh/1`, `cm-targets/1`, int16-quantized sparse deltas), `MorphEngine` (incremental weight deltas, dirty-region normals, drift guard, exact reset), and a worker client with latest-wins coalescing and buffer recycling.
- `tools/convert-makehuman`: converts the pinned MakeHuman commit's CC0 `base.obj` + selected targets into `assets/makehuman-hm08/` (body group only, metres, feet at y=0) with a per-file provenance manifest checked by the license gate.
- `apps/web`: Shape tab with 26 controls (gender, 3 ethnicity components, muscle, weight, 20 regional sliders), reset, preset save/load.

**Scope decisions**
- **Age is fixed at "young adult"** in this pack. MakeHuman's full macro set is 106 MB of text targets, so child/old/baby (and the height macro) need a size strategy first: M4.
- The base mesh *is* the neutral shape; gender/ethnicity come from the 6 `{race}-{gender}-young` targets and muscle/weight/gender from 18 `universal-*` targets, blended multilinearly as in MakeHuman. Defaults (gender 0.5, ethnicity ⅓ each, muscle/weight 0.5) therefore give MakeHuman's default look.
- Slider names and groupings are ours; only target files come from MakeHuman. `hip-waist` has no `decr/incr` pair upstream and was left out.

**Measured (informational; not the M3 exit criterion)**
- Engine on the real 13,380-vertex mesh, Node on this container's CPU: regional slider 0.2 ms, weight slider ≈1 ms, gender macro ≈3 ms per update.
- Headless Chromium with software GL: worker round trip ≈4 ms; the main thread's software rendering (~7 fps at 1100×800) was the bottleneck, so **"60 fps while dragging on a mobile device" is still unverified** and needs a real phone.

**Known gaps / follow-ups**
- Body is not yet skinned or fitted to the SL skeleton (M5); the skeleton overlay deliberately doesn't match it.
- No textures yet (flat skin material); UVs are carried through.
- Camera framing uses a bounding sphere, so portrait phones show the figure smaller than necessary (M8 mobile polish).
- Helper geometry (eyes, teeth, lashes, tights) in `base.obj` was dropped; eyes etc. return in M4/M7.


## M4 notes (lazy packs, full slider set, library)

**Lazy packs** — the core pack (mesh, young-adult macros, 20 regional sliders, 2.5 MB) loads at startup; everything else is a separate download triggered by a button or by a saved character that needs it:

| Pack | Adds | Download |
|---|---|---|
| `age` | Age slider (baby → child → young → old; readout 1 / 25 / 90 years) by replacing the two macro groups with age-aware versions | 3.6 MB |
| `face` | 109 sliders: head shape, forehead, eyebrows, eyes, nose, mouth, ears, chin, cheeks, neck | 1.0 MB |
| `body` | 46 sliders: fine torso/hip/stomach/pelvis/chest, arms, legs, hands, feet | 1.3 MB |

Verified in headless Chromium: at startup only the core files are requested; downloading *Face* requests exactly the face files; after a page reload a saved character that uses age + face fetches only those two packs. "Hosted" currently means static files served next to the app (same origin); a CDN or service-worker cache is an M8 deployment concern.

**Architecture**
- `packages/packs` `PackManager`: fetch → validate (mesh name/vertex count, fragment ↔ pack) → dry-run `model.checkExtend` → `worker.addTargets` → `model.extend`. Concurrent requests share one load; a failure leaves model and worker untouched and is retryable.
- Packs are pure data: `targets.json/bin` + `fragment.json` (sliders, variables, macro groups; same-id macro groups are *replaced*) + `pack.json` (label, size, slider count). Face/body sliders are **generated** from MakeHuman's `modeling_modifiers.json` (CC0 asset) by `tools/convert-makehuman/modifiers.ts`; left/right pairs become one symmetric slider; labels are derived from target names (ours, not MakeHuman's UI text).
- Presets list the packs they need (`packs`), so loading a character fetches exactly those.
- `packages/storage`: library in IndexedDB with an in-memory fallback (private windows), thumbnails, same contract tests run against both stores (`fake-indexeddb` in tests).
- `weights()` returns targets sorted by id, so the same sliders give a **bit-identical body** regardless of pack load order (tested).

**Bugs found by the new round-trip test and fixed**: applying a preset set ethnicity components one by one, each renormalizing the others (values drifted); and float summation order depended on pack load order.

**Scope decisions / not done**
- **Eyes deferred.** MakeHuman's eyes are a separate low-poly mesh bound to the body by its clothing-fitting format; the in-body "helper" eyes are too crude. Eyes (and teeth, lashes, hair, clothes) belong with the fitting work (M9); the face currently has empty sockets.
- **Left out on purpose:** genital targets; the `Height` and `BodyProportions` macros and breast size/firmness macros (hundreds of combination targets: ~100 MB of text) — individual length sliders (arm/leg/torso/neck) cover height for now.
- Slider labels are machine-generated from target names ("Scale width", "Lowerarm fat", "Eye bag (in/out)") and need a copy-edit pass; asymmetry (`asym` targets) isn't exposed.
- Tests: the full set (>170 values across core + 3 packs) round-trips through preset JSON into a fresh app and reproduces the identical mesh; the same flow works in the browser through the Library tab.
- Still unverified on real devices: download behaviour on slow mobile networks (no progress bar yet), IndexedDB quota behaviour with many thumbnails.


## M5 notes (Second Life binding)

### What was verified against the viewer source (commit `18648fc5`)
Read directly from `secondlife/viewer`: `llpolyskeletaldistortion.cpp`, `llpolymorph.cpp`, `lldriverparam.cpp`, `llvisualparam.cpp`, `llavatarappearance.cpp`, `lljoint.cpp`, `xform.cpp`, `llquaternion.cpp`.
- A skeletal parameter with weight `w` adds `w·scale` / `w·offset` to its bones (the viewer applies increments, so the net is `w·delta` since weights start at 0). `value_default` is **0 when absent** (not the minimum) and weights are clamped to `[min,max]`.
- `volume_morph` adds `w·scale` / `w·pos` to a collision volume; collision volumes under a scaled bone additionally get `restScale ⊙ boneScaleDelta · w` (`inheritScale`).
- Driver parameters set their driven parameters through a trapezoid (`min1→max1` up, hold to `max2`, down to `min2`); omitted attributes default to the driver's `min`/`max`.
- **Transform rules (this corrected an M2 mistake):** a child's offset is scaled by its *direct* parent's own scale only, and a joint's matrix carries only its *own* scale — scale does **not** accumulate down the hierarchy as in an ordinary scene graph. `computeBodySize`'s formula (`hip.z·pelvisScale.z − knee.z·hipScale.z − …`) confirms it.
- `rot="x y z"` is `mayaQ(…, XYZ)` = `xQ*yQ*zQ` with LLQuaternion's reversed product, i.e. **Rz·Ry·Rx** in the usual convention (M2 had Rx·Ry·Rz).
- Cross-check: Linkpoint's hand-written `AvatarSkeleton.kt` (37 bones, 27 collision volumes) is a subset of the generated table, except `BACK`, which is not in the viewer file at this commit.

### Still inferred, not verified
- Sex gating (`sex="male|female"` params) uses the `male` parameter (id 80) ≥ 0.5; the viewer's `getSex()` was not read.
- That Second Life honours **joint-position overrides** from a rigged mesh the way this app's "joint overrides" mode assumes (the Project Bento notes say so; not tested in-world or on OpenSim).
- Collision-volume `scale` as ellipsoid half-axes (M2 assumption; the viewer draws them as unit spheres scaled by it).

### What was built
- `tools/import-sl-skeleton` also extracts 186 shape parameters (82 bone-moving, 30 volume-morphing, 73 drivers, plus `Hover`) from `avatar_lad.xml`; `SlShape` evaluates them; `pelvisToFoot` and `computeBodyHeight` are ports of the viewer's.
- **Rig data (CC0):** MakeHuman's default skeleton and skin weights (both files state `"license": "CC0"`) merged onto 53 SL joints (top-4 weights per vertex, bytes; `rig.json`/`rig.bin`, 105 KB). Toes weight to `mFoot` (SL bends toes at the ball of the foot; `mToe` is the end joint).
- **Helper vertices:** the 448 vertices MakeHuman defines its joints from are appended to the morph mesh as non-rendered helpers, so joints follow every morph. The worker returns their positions with each frame.
- **`packages/rig`:** SL↔MakeHuman joint correspondences; A→T-pose retarget (limb directions from SL's rest skeleton, the character's own bone lengths); linear-blend skinning; a custom rest skeleton (joint-position overrides) derived from the morphed body; skeleton-driven deform that is the identity at rest; `fitShape` — the SL body sliders that best reproduce the character's joints (exact bounded least squares, re-linearized because drivers make the response piecewise-affine).
- **App:** an *SL* tab (T-pose skinned view, the 12 SL body sliders as 0–100 %, "fit SL sliders", two skeleton modes) and a skeleton overlay on the character's own skeleton.

### Measured
- Fit of the default MakeHuman character with SL sliders alone: **4.9 cm RMS, 8.5 cm worst joint** (toes, collars); Thickness, Hip Length and Leg Length pin at 0 %, Shoulders at 100 %. So SL sliders alone cannot reproduce this body; joint overrides give an exact fit by construction.
- Cost on this container's CPU (Node): full SL frame (retarget + skin + deform + normals) 5 ms; slider/pose change 3 ms. It runs on the main thread; on a phone it may deserve a worker.
- Visual checks (headless Chromium): T-pose arms level with the shoulders, shoulders/neck clean, feet grounded, SL Height 100 % stretches the skinned body (viewer height estimate 1.59 → 1.80 m), elbow bend follows the skeleton.

### OpenSim harness (`tools/opensim`, adapted from Kaleaon/React-Linkpoint)
Runs a real OpenSimulator 0.9.3 locally (no Docker): `start` downloads/configures/boots it and creates a test avatar, `login` performs the XML-RPC viewer login (verified here: valid agent id, seed capability, 21-folder inventory skeleton), `console` sends any OpenSim console command, `stop`. `.github/workflows/live.yml` runs the same in CI (**not yet run on Actions**).
What it can and cannot do for this project: OpenSim has no renderer, so it **cannot show deformation**, and standalone mode exposes no HTTP avatar-service endpoint. It *can* check what a grid does with our assets: `load oar`/`load iar` and `dump asset` exist, and Linkpoint's Kotlin core (login, UDP circuit, CAPS, an LL-mesh decoder with rig and weights already verified against OpenSim) can fetch and decode them. That is the plan for M6's round-trip test of exported rigged meshes.

### Not done / next
- **Fitted-mesh weights.** Weights go to mBones only. Weighting to collision volumes (so SL's fat/muscle/breast sliders deform the body) is designed (mBone→CV map) but not generated.
- No Bento face bones are weighted (the head moves rigidly); no export yet (M6); the toes tilt ~1 cm vs. MakeHuman's pose because the foot is re-aimed to SL's orientation.
- Weights are MakeHuman's; quality was inspected at a few poses only. Legs end up touching at the thighs because SL's hips are straight below the pelvis.
- Not verifiable here: how SL itself renders the result (no account; OpenSim cannot render).
