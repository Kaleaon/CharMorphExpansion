# Universal Skeleton Morphing Toolset Design

## Overview
- Deliver a canonical, parametric skeleton representation that covers vertebrate variation while remaining compatible with existing CharMorph tooling.
- Allow procedural morphing from the canonical skeleton to species-specific rigs, meshes, and asset fits with deterministic constraints.
- Enable progressive enhancement: start with rule-based solvers, unlock optional ML-driven refinements once sufficient datasets exist.

## Goals
- Support shared bone taxonomy spanning axial and appendicular structures common to vertebrates (spine, cranium, girdles, limbs, tail).
- Reduce bespoke rig authoring by re-using universal joint layouts and weight templates across species.
- Maintain compatibility with current humanoid workflows (`lib/morpher`, `lib/rigging`, `lib/fitting`) while adding hooks for non-humanoid morphs.
- Provide authoring tools for ingesting new skeleton references, annotating constraints, and debugging solver output inside Blender.

## Non-Goals
- Building a full biomechanics simulator (muscle dynamics, locomotion). The focus is on geometric morphing.
- Supporting invertebrate anatomy; appendicular/axial assumptions break for those classes.
- Automating species-level artistic styling (fur, skin textures); pipeline simply preserves hook points for downstream systems.

## Guiding Principles
- **Parametric over ad-hoc:** Represent variability through parameters (bone counts, proportions, curvature) instead of species-specific branches.
- **Topology-aware:** Respect differences in limb counts/segmentation without forcing retopology at run time.
- **Constraint-driven:** Express biological plausibility as solver constraints (joint limits, limb proportion ratios).
- **Interoperable:** Integrate through existing abstractions (`charlib.Character`, `lib/rigging.RigHandler`, `lib/morpher.Morpher`) to limit churn.

## Canonical Skeleton Representation

### Shared Bone Taxonomy
- Establish a minimal set of reusable segments:
  - Axial: `Cranium`, `Cervical`, `Thoracic`, `Lumbar`, `Sacral`, `Caudal`.
  - Girdles: `ShoulderGirdle`, `PelvicGirdle`.
  - Limbs: `Forelimb` (`Scapula`, `Humerus`, `Radius`, `Ulna`, `Carpal`, `Metacarpal`, `Phalanges`), `Hindlimb` (`Femur`, `Tibia`, `Fibula`, `Tarsal`, `Metatarsal`, `Phalanges`).
  - Accessory structures (optional counts): `Horns`, `WingMembrane`, `FinRays`.
- Each segment captures default joint order, orientation reference, and attachment points on the axial skeleton.

### Parametric Skeleton Schema
- Introduce `lib/skeletons.py` (new module) to host:
  - `SkeletonProfile`: top-level dataclass with metadata, canonical scale, taxonomy tags (e.g., `quadruped`, `avian`, `aquatic`).
  - `AxialProfile`, `LimbProfile`, `TailProfile`: nested dataclasses parameterizing segment counts, relative lengths, curvature splines, DoF limits.
  - `AttachmentMap`: describes how limbs attach to axial indices, enabling limb duplication (e.g., multi-wing species).
- Store authorable profiles in YAML under `data/skeletons/*.yaml` with schema roughly:

```yaml
name: CanineDefault
categories: [quadruped, cursorial]
scale:
  shoulder_height_m: 0.65
axial:
  cervical_count: 7
  thoracic_count: 13
  lumbar_count: 7
  sacral_count: 3
  tail:
    enabled: true
    vertebrae: 20
    taper_curve: [[0.0, 1.0], [1.0, 0.2]]
limbs:
  fore:
    enabled: true
    digits: 5
    segment_ratios: [0.32, 0.28, 0.17, 0.23]
  hind:
    enabled: true
    digits: 4
    segment_ratios: [0.34, 0.31, 0.14, 0.21]
constraints:
  scapula_glide_range: 0.08
  carpal_pitch_min: -65
  carpal_pitch_max: 40
```

### Joint Degrees of Freedom
- Encode DoFs by joint type with biomechanical ranges derived from literature; e.g., ball-and-socket for shoulder, hinge for elbow, universal for wrist.
- Represent orientation templates as quaternion bases stored alongside each joint for rig alignment.
- Provide fallback heuristics when species omit segments (e.g., fused radius/ulna).

### Soft Tissue & Muscle Anchors (Phase 3)
- Reserve placeholders for muscle origin/insertion metadata to support future skin/volume preservation systems.
- Store anchors relative to canonical bone frames to ease transfer when morphing.

## Data Ingestion
- **Reference Sources:** leverage publicly available skeletal datasets (e.g., Digimorph CT scans, OpenSim musculoskeletal models, academic morphometrics).
- **Capture Workflow:**
  1. Import source skeleton mesh or rig into Blender.
  2. Annotate correspondences using a new `Skeleton Mapper` panel (re-using `lib/utils` operators).
  3. Bake measurement data (segment lengths, joint angles) via a new operator storing JSON snapshots under `data/skeletons/reference/`.
- **Normalization:** Align imported skeleton to canonical axes, compute scale factors, classify taxonomy tags, and serialize as YAML via `lib/skeletons.export_profile`.

## Morphing Architecture

### Component Overview
- `lib/skeletons.SkeletonLibrary`
  - Loads YAML profiles at startup (lazy via `utils.named_lazyprop` similar to `charlib`).
  - Offers query API: `get_profile(name)`, `find_by_tags({"quadruped"})`, `canon_profile()`.
- `lib/skeletons.SkeletonGraph`
  - Graph structure with nodes = bones, edges = joints, storing param ranges, orientation frames, weighting groups.
  - Backed by `networkx`-like adjacency tables (pure Python to avoid dependency).
- `lib/skeletons.Solver`
  - Accepts canonical graph + target profile deltas.
  - Produces blended joint transforms and bone scales respecting constraints.
  - Exposes deterministic solver (Phase 1) plus optional ML inference hook (Phase 4).
- `lib/morpher_ext.UniversalMorpher` (new)
  - Wraps existing `lib/morpher.Morpher`, injecting skeleton-driven adjustments before mesh morph application.
  - Supplies bone transform deltas to `lib/rigging.Rigger`.
- `lib/rigging.UniversalRigHandler`
  - Extends `RigHandler` to map solver output into Blender bone transforms, including limb duplication/removal.
  - Coordinates with `sliding_joints.SJCalc` for scapula glide, tail articulation, etc.
- `lib/fitting.AssetRetargeter`
  - Bridges asset fitting to new limb variants (e.g., re-assigning vertex groups for wings).

### Data Flow
1. User selects canonical base (e.g., `HumanoidNeutral`) and a target skeleton profile (e.g., `CanineDefault`).
2. `UniversalMorpher` requests skeleton morph solution for the mesh's current L2 morph state.
3. Solver returns bone transforms & scale factors.
4. `RigHandler` updates armature (or generates new rig via template) with transforms, maintaining weight maps.
5. Mesh morphs (`lib/morpher`) and asset refits (`lib/fitting`) run with updated armature context.

### Constraint Solving Strategy
- Phase 1: deterministic solver using hierarchical propagation:
  - Solve axial column (cumulative curvature heuristics).
  - Attach girdles at defined vertebra indices with computed offsets.
  - Fit limb chain segments to desired ratios while enforcing joint limits.
- Phase 2: integrate optimization (e.g., least squares) to handle conflicting inputs (user overrides vs. canonical ratios).
- Phase 3+: optional ML approximator for rapid inference once dataset of solved skeletons exists (store TFLite model under `data/skeletons/models/`).

## Species Adaptation Pipeline

### Authoring New Species
1. Import scan/rig and run `Skeleton Mapper`.
2. Map bones to canonical taxonomy, annotate missing segments.
3. Export YAML profile + measurement bundle.
4. Generate initial mesh/rig by applying profile to canonical base mesh (optionally via procedural mesh adapters).

### Applying to Existing Characters
- UI exposes “Target Skeleton” selector in morph panel (`Morpher` UI).
- When user switches target:
  - `UniversalMorpher` triggers resampling of morph parameter set (limb thickness, digit count) aligned with new skeleton.
  - Rig regenerated or updated via `UniversalRigHandler`.
  - Registered assets re-fitted; warns if asset lacks required limb weight data.

### Hybrid/Intermediate Forms
- Allow continuous blending between profiles by mixing parameter vectors:
  - Example: 60% human + 40% avian yields long-armed biped with partial wing digits.
  - Constraints clamp invalid combos (e.g., negative vertebra count).

## UI & Workflow Updates
- Add `Skeleton` tab inside existing CharMorph panel:
  - Dropdown for canonical profile.
  - Sliders for high-level parameters (spine length, tail length, digit count).
  - Advanced drawer listing per-joint limits with visualization (uses `bpy.types.Gizmo` overlays).
- Provide `Profile Inspector` panel on Blender’s `N` sidebar (3D view):
  - Displays solver convergence, constraint violations.
  - Buttons to export snapshots (`.json`), re-run solver, or bake rig to keyframes for debugging.
- Extend `Finalize` operator to ensure universal rigs attach consistent naming conventions (prefix by profile ID) to avoid asset conflicts.

## Integration with Existing Modules
- `charlib.Character`: load `skeleton_profile` pointer from character config; default to humanoid if missing.
- `lib/morpher.Morpher`: add hook for skeleton morph events, enabling mesh morph updates when bone scale changes exceed threshold.
- `sliding_joints.SJCalc`: expand to handle species-specific joint slots (e.g., scapular glide for quadrupeds, wing folding).
- `fit_calc.RiggerFitCalculator`: teach to transfer weights for added/removed bones by referencing canonical bone groups from `SkeletonGraph`.
- `data/base_meshes`: extend XML presets to reference skeleton profiles to ensure mesh/rig alignment.

## Implementation Plan

### Phase 1 — Canonical Infrastructure
- Create `lib/skeletons.py`, YAML schema, and loader.
- Implement deterministic solver for axial + limb chains.
- Integrate with humanoid pipeline as optional preview (flagged experimental).

### Phase 2 — Rig & Asset Support
- Extend `lib/rigging` with `UniversalRigHandler`.
- Update `lib/fitting` and `sliding_joints` to honor new bone sets.
- Author 2–3 reference profiles (human, canine, avian) and create regression tests.

### Phase 3 — Mesh Adaptation & Soft Tissue
- Introduce mesh adapters (procedural volume preservation) using `fit_calc` and existing morph infrastructure.
- Add optional muscle/skin anchor metadata to improve deformation quality.

### Phase 4 — Intelligent Assistance
- Collect solved skeleton datasets, train lightweight TFLite regression model for rapid inference.
- Embed inference in solver fallback path for interactive performance.

## Testing & Validation
- **Unit Tests:** offline Python tests for solver correctness (expected bone lengths, joint limits). Store fixtures under `tests/skeletons/`.
- **Integration Tests:** Blender-headless scripts verifying rig generation and asset fitting across profiles.
- **Golden Profiles:** maintain curated snapshots per species (`tests/data/golden_profiles/*.json`) to detect regressions.
- **Performance Benchmarks:** track solver runtime vs. existing morph pipeline to ensure <20% overhead for mid-complex rigs.

## Risks & Mitigations
- **Complex limb topologies (e.g., wings, flippers):** Mitigate by modular limb descriptors with optional segments and modifiers (membranes, patagia).
- **Asset compatibility:** Provide compatibility shim that warns when asset lacks required weights and offers auto-generation using `fit_calc`.
- **Solver instability:** Start with deterministic heuristics before introducing optimization/ML; log constraint violations for user debugging.
- **Data scarcity:** Seed with literature-derived defaults; allow community contributions via YAML profiles.

## Open Questions
- How to streamline UI for species with >5 limbs (mythical forms)? Need scalable layout for limb selectors.
- Should canonical skeleton allow mirrored asymmetry (e.g., crabs)? Could be future extension.
- How to version skeleton profiles to guarantee reproducibility? Suggest semantic version fields inside YAML (`profile_version`).
- What’s the migration plan for existing characters stored without skeleton metadata? Likely fallback to `HumanoidNeutral` with manual opt-in.

