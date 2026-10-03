# New feature design: furry / anatomy / modular parts / skin / VRM

Approved by project owner 2026-10-03. Greenlit: all new feature work, CC-BY-SA
exception for Z-Anatomy-derived geometry, Z-Anatomy as anatomical foundation
("do what works best and easiest").

This document is the design authority for the five feature areas below. It is
grounded in the M0–M5 codebase on `claude/gifted-noether-bawbce`
(`packages/core` parameter graph, `packages/morph` sparse engine,
`packages/skeleton` SL rig, `packages/assets` license gate).

---

## 1. Base mesh decision: MakeHuman stays the deformable base

**Decision:** The MakeHuman CC0 base mesh (M3/M4/M5) remains the real-time
deformable substrate. Z-Anatomy becomes the **anatomical reference and overlay
layer**, not the base mesh. This is the "works best and easiest" reading of the
owner's directive, for these reasons:

- M3/M4/M5 are built and working on MakeHuman: converted base, 170+ sliders,
  sparse `cm-targets/1` packs, SL rigging to 53 joints, `fitShape` bounded
  least-squares. Re-basing discards all of it.
- Z-Anatomy is an anatomical **atlas**, not a character base: extremely dense
  medical-visualization meshes, organized as layered systems (skin / muscle /
  skeleton / organ layers, not one deformable surface), a 237-bone anatomical
  armature (not the SL 133-joint rig), and topology never authored for
  morph-target deformation. Making it a real-time base means full retopology
  before a single slider works.
- What Z-Anatomy is *good* at is anatomical correctness. It therefore serves
  as: (a) the sculpting reference for morph targets (muscle shapes, genital
  anatomy), and (b) the source of separate **CC-BY-SA overlay packs**
  (muscles, organs, genital modules — §4) that attach to the base.

"Z-Anatomy is the anatomical foundation" is honored: it defines what is
*correct*. MakeHuman is just the deformable substrate it corrects.

---

## 2. License: CC-BY-SA anatomy-pack exception (IMPLEMENTED)

`packages/assets/src/manifest.ts`: `CC-BY-SA-3.0` and `CC-BY-SA-4.0` added to
`ALLOWED_LICENSES`, attribution mandatory (the existing `CC-BY` attribution
regex already covers the SA variants). AGPL/GPL/LGPL/NC remain rejected.

Rules for CC-BY-SA packs (enforced by convention + review, CI later):
- Live under `assets/anatomy/` as **separate packs** with their own
  `MANIFEST.json` (source URL, author, SPDX, sha256, attribution text naming
  Z-Anatomy contributors).
- Geometry is **never baked into code** and **never mixed into a CC0/CC-BY
  pack** — no single distributed GLB contains both CC-BY-SA and CC-BY
  geometry. Code that *loads* the packs keeps its own license.
- Derivatives we sculpt (genital modules, muscle overlays) are new
  CC-BY-SA-4.0 files with attribution to Z-Anatomy. Share-alike is satisfied
  because the derivatives stay CC-BY-SA.

---

## 3. Skin slack / tightness sliders

New slider group `skin`, shipped as a `SpecFragment` pack (`skin-regions`).
Bipolar sliders (`min: -1`, `max: 1`, default `0`): negative = tight,
positive = loose/slack.

| id | label | group | drives |
|---|---|---|---|
| `skin.slack_ears` | Ear slack | skin | morph targets: ear droop/sag deltas (L/R bindings) |
| `skin.slack_jowls` | Jowl slack | skin | morph targets: jowl sag + fold deltas |
| `skin.slack_neck` | Neck / dewlap slack | skin | morph targets: dewlap sag deltas |
| `skin.slack_torso` | Torso skin slack | skin | morph targets: belly/chest sag deltas |
| `skin.slack_limbs` | Limb skin slack | skin | morph targets: limb fold deltas |

Each slider drives **two** outputs (the parameter graph already supports this
via `bindings` + the planned material-param channel from §4 of the plan):
1. **Morph targets** — sculpted sag deltas per region (sparse, like all
   targets). Positive side adds droop/fold volume; negative side pulls taut.
2. **Material param `wrinkleNormalStrength`** — scales the wrinkle/fold normal
   detail with `|slack|` on the positive side. Tight skin (negative) flattens
   it toward 0.

Region masks: vertex groups on the base mesh (`mask_ears`, `mask_jowls`,
`mask_neck`, `mask_torso`, `mask_limbs`) author where each target applies;
targets stay sparse because masks are sparse.

Reference endpoints (ship as presets):
- **Golden retriever** (loose): ears +0.8, jowls +0.7, neck +0.6, torso +0.3,
  limbs +0.2.
- **Doberman** (tight): ears −0.6, jowls −0.5, neck −0.4, torso −0.3,
  limbs −0.3.

UI: `skin` group renders in its own collapsible section (progressive
disclosure — the group metadata the plan already has; add `order`/`tier`
fields to `SliderDef` if needed for basic/advanced tiers).

---

## 4. Genital modules (procedural species modules)

**Pack:** `anatomy-genitals`, CC-BY-SA-4.0, lives under `assets/anatomy/`.
Never in the core CC0 spec. Loaded as a `SpecFragment`; sliders appear only
when the pack is loaded (progressive disclosure by pack).

**Two layers:**

### 4a. Base humanoid genital morph targets
Sculpted **from Z-Anatomy reference** (TA2-verified structures: penis, glans,
scrotum, testis, vulva, clitoris, prostate) as new CC-BY-SA geometry on a
genital sub-mesh that surface-binds to the base (ExtraMesh mechanism).
Sliders (group `genitals`, bipolar where sensible):
- `genital.size` (unipolar 0..1), `genital.girth`, `genital.testis_size`,
  `genital.labia_fullness`, etc. — ordinary morph-target sliders.

### 4b. Species modules (the furry procedural layer)
Each module is a morph target (or small target set) on the genital sub-mesh,
driven by a unipolar slider (0 = absent, 1 = full expression):

| id | label | effect |
|---|---|---|
| `genital.knot` | Knot size | canine knot swell at base |
| `genital.sheath` | Sheath coverage | sheath length / coverage |
| `genital.barbs` | Barb texture | keratin barb ridges (also drives a roughness/bump material param) |
| `genital.taper` | Taper | tip taper profile |
| `genital.ridge` | Corona ridge | ridge prominence |
| `genital.corkscrew` | Corkscrew | spiral twist (porcine) |

Modules compose: `weights()` already sums bindings, so knot + sheath + taper
combine naturally. Per-species **presets** bundle module values
(e.g. canine: knot 0.7, sheath 0.8, taper 0.6, barbs 0).

**Sculpting sources:** Z-Anatomy (base correctness) + Schlongs of Skyrim
meshes as **study reference only** — permission from VectorPlexus covers
*derivatives*, not verbatim redistribution. Credit VectorPlexus, Smurf,
b3lisario in the pack manifest attribution. All shipped geometry is original
sculpts.

**Drivers:** species preset can also drive non-genital sliders (e.g. a
"canine" preset nudges `skin.slack_ears` + tail part visibility) via the
`param_driver`-style driver mechanism (§4 of the plan).

---

## 5. Modular body parts (Spore-like)

New package `packages/parts`. A **part** is a pack-level unit:

```ts
interface PartManifest {
  id: string;            // e.g. "tail.canine", "ears.feline_flop"
  label: string;
  pack: string;
  species: string[];     // tags for filtering: ["canine", "feline", ...]
  socket: {
    bone: string;        // SL joint, e.g. "mTail1", "mHead" — Bento extended
                         // bones (wings, tail, hind limbs) already exist in
                         // the rig format
    offset: [number, number, number];
  };
  /** Rigid parts (horns, claws) parent to the bone; fleshy parts (muzzles,
      ears) surface-bind to the base mesh via barycentric binding. */
  attach: "bone" | "surface";
  meshes: string[];      // GLB paths inside the pack
  morphTargets?: TargetId[];
  sliders?: SliderDef[]; // part-local sliders, merged as SpecFragment
}
```

- **Catalog UI** follows the CharacterStudio trait/manifest pattern (ids,
  thumbnails, required/restricted traits) — port the concept, not the code.
- **Procedural skinning:** new parts auto-weight to the SL skeleton with the
  existing `tools/retarget-to-sl` (auto-weight + collision-volume helper),
  then hand-tune. Parts ship weighted to mBones.
- **Part sliders** merge via `SpecFragment.extend()` — e.g. `tail.length`,
  `tail.fluff` ride the same parameter graph, so presets capture them.
- Starter set (sculpt as CC0 or CC-BY): canine tail, feline tail, floppy ear,
  prick ear, digitigrade leg shells (§6), basic muzzle, wings (membrane),
  horns. Furry CC0 itch.io assets already collected (cat-person, styloo
  animals) are **reference**, not parts — retopologize/sculpt originals.

---

## 6. Furry / non-humanoid pipeline (MorphoMesh integration)

MorphoMesh (`~/workspace/research/morphomesh`, Apache-2.0) is an **authoring
backend**, not runtime code. Lift as `tools/` Python modules:

| Module | Use |
|---|---|
| digitigrade vs plantigrade templates | author the `furry-digitigrade` SpecFragment: leg morph targets + Bento hind-limb bone adjustments |
| creature PBR material defs (SSS skin, anisotropic fur, keratin, wet rhinarium) | design reference for `packages/render` three.js materials (M7) |
| dual-coat grooming | fur-shell / texture authoring reference |
| Rigify metarigs + heat-map skinning | reference for the retarget tool |
| visual QA (penetration, proportion, deformation checks) | CI checks for furry packs |

**Phasing:** biped anthro first (digitigrade legs + tail + ears + muzzle on the
humanoid base — all expressible with Bento extended bones). Full quadrupeds
are a later milestone: they need a quadruped base mesh and skeleton profile,
which the `packages/skeleton` module must be extended to support (skeleton
profiles beyond SL-133, with the SL rig remaining the default/export target).

---

## 7. VRM export (CharacterStudio port)

New package `packages/io-vrm` (waits on M6 export scaffolding — coordinate,
don't collide). Port CharacterStudio's `VRMExporter.js`
(`~/workspace/research/character-studio/src/library/VRMExporter.js`, MIT) to
TypeScript against our outputs:

- Morph targets → VRM blendshape proxies (the engine's `weights()` map is the
  source of truth).
- SL skeleton → VRM humanoid bone mapping (names → VRM `humanBone` slots;
  Bento extras → VRM extras / spring bones for tails/ears).
- Materials → VRM MToon or standard PBR fallback.
- Presets → VRM default blendshape values.

CharacterStudio also contributes the **trait/manifest concept** for the part
catalog (§5) and its mesh-merge/texture-atlas approach for reducing draw
calls — adopt the ideas, port selectively.

---

## 8. Work split with the Claude Code session

The session owns M6 (export) and the core packages. This branch
(`work/new-features`) carries: the license-gate change (§2, done), this
design doc, and future part/authoring specs. Suggested session-side picks,
in order:

1. `SliderDef` UI tiers (`order`/`tier` fields) + `skin` group rendering.
2. Material-param channel on sliders (needed by §3 wrinkle normals and §4b
   barb roughness) — the plan's parameter graph already names it.
3. `packages/parts` scaffold + part catalog UI.
4. `packages/io-vrm` after M6 lands.
5. `tools/` MorphoMesh ports for furry authoring.

Asset sculpting (genital targets, skin-sag deltas, starter parts) is Blender
work that follows these specs; Z-Anatomy + SoS (study-only) are the
references.
