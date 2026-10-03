import type { JointDelta, Skeleton } from "./skeleton.ts";
import type { ShapeData, ShapeDriven, ShapeParam, SkeletonData, Vec3 } from "./types.ts";

export class ShapeError extends Error {}

const add3 = (a: Vec3 | undefined, b: Vec3, k: number): Vec3 => [(a?.[0] ?? 0) + k * b[0], (a?.[1] ?? 0) + k * b[1], (a?.[2] ?? 0) + k * b[2]];

/**
 * Weight of a driven parameter for a driver weight: the viewer's trapezoid (indra/llappearance/lldriverparam.cpp,
 * LLDriverParam::getDrivenWeight). Ramp up over [min1,max1], plateau to max2, ramp down to min2; the edge cases for
 * degenerate (step) ramps are kept as in the source.
 */
export function drivenWeight(e: ShapeDriven, input: number, driver: { min: number; max: number }, driven: { min: number; max: number }): number {
  if (input <= e.min1) return e.min1 === e.max1 && e.min1 <= driver.min ? driven.max : driven.min;
  if (input <= e.max1) return driven.min + ((input - e.min1) / (e.max1 - e.min1)) * (driven.max - driven.min);
  if (input <= e.max2) return driven.max;
  if (input <= e.min2) return driven.max + ((input - e.max2) / (e.min2 - e.max2)) * (driven.min - driven.max);
  return e.max2 >= driver.max ? driven.max : driven.min;
}

export interface ShapeResult {
  /** Joint and collision-volume deltas ready for `Skeleton.setDeltas` (collision-volume `offset` is the viewer's `pos`). */
  deltas: Record<string, JointDelta>;
  /** `Hover` parameter: vertical avatar offset, metres. */
  hover: number;
  /** Effective weight of every parameter after drivers, by id. */
  weights: Map<number, number>;
}

/**
 * Second Life body shape as bone / collision-volume deformation. Exactly the viewer's rules (verified against
 * llpolyskeletaldistortion.cpp, llpolymorph.cpp, lldriverparam.cpp, llvisualparam.cpp):
 *  - a parameter with weight w adds `w·scale` / `w·offset` to its bones (net effect of the viewer's incremental updates);
 *  - collision volumes parented to a scaled bone also receive `restScale ⊙ boneScaleDelta · w`;
 *  - `volume_morph` adds `w·scale` / `w·pos` to a collision volume;
 *  - driver parameters set their driven parameters through a trapezoid curve;
 *  - weights are clamped to the parameter's range, and an unset parameter has its default weight (0 unless specified).
 * Sex gating (`sex="male|female"`) uses the `male` parameter (id 80): an avatar is male if it is ≥ 0.5. That rule is inferred
 * (the viewer's `getSex()` is outside the files read), not verified.
 */
export class SlShape {
  readonly params: ShapeParam[];
  private readonly byId = new Map<number, ShapeParam>();
  private readonly byName = new Map<string, ShapeParam[]>();
  private readonly weights = new Map<number, number>();
  private readonly cvRest = new Map<string, Vec3>();
  private readonly cvParent = new Map<string, string>();
  private readonly cvChildren = new Map<string, string[]>();

  constructor(shape: ShapeData, skeleton: SkeletonData) {
    this.params = shape.params;
    for (const p of shape.params) {
      if (this.byId.has(p.id)) throw new ShapeError(`duplicate param id ${p.id}`);
      this.byId.set(p.id, p);
      this.byName.set(p.name, [...(this.byName.get(p.name) ?? []), p]);
      this.weights.set(p.id, p.default);
    }
    const joints = new Set(skeleton.joints.map((j) => j.name));
    for (const c of skeleton.collisionVolumes) {
      this.cvRest.set(c.name, c.scale);
      this.cvParent.set(c.name, c.parent);
      this.cvChildren.set(c.parent, [...(this.cvChildren.get(c.parent) ?? []), c.name]);
    }
    for (const p of shape.params) {
      for (const b of p.bones ?? []) if (!joints.has(b.name)) throw new ShapeError(`param ${p.id}: unknown joint ${b.name}`);
      for (const v of p.volumes ?? []) if (!this.cvRest.has(v.name)) throw new ShapeError(`param ${p.id}: unknown collision volume ${v.name}`);
      for (const d of p.driven ?? []) if (!shape.params.some((q) => q.id === d.id)) throw new ShapeError(`param ${p.id}: drives unknown param ${d.id}`);
    }
  }

  param(idOrName: number | string): ShapeParam {
    if (typeof idOrName === "number") {
      const p = this.byId.get(idOrName);
      if (!p) throw new ShapeError(`unknown shape param id ${idOrName}`);
      return p;
    }
    const list = this.byName.get(idOrName);
    if (!list) throw new ShapeError(`unknown shape param "${idOrName}"`);
    if (list.length > 1) throw new ShapeError(`shape param name "${idOrName}" is ambiguous (ids ${list.map((p) => p.id).join(", ")}); use the id`);
    return list[0]!;
  }

  /** Set a parameter's weight (clamped to its range, as the viewer does). */
  set(idOrName: number | string, weight: number): void {
    if (!Number.isFinite(weight)) throw new RangeError("weight must be finite");
    const p = this.param(idOrName);
    this.weights.set(p.id, Math.min(p.max, Math.max(p.min, weight)));
  }

  get(idOrName: number | string): number { return this.weights.get(this.param(idOrName).id)!; }

  reset(): void { for (const p of this.params) this.weights.set(p.id, p.default); }

  /** All current weights, to put back later with `restore`. */
  snapshot(): Map<number, number> { return new Map(this.weights); }

  restore(snapshot: ReadonlyMap<number, number>): void {
    for (const [id, w] of snapshot) if (this.byId.has(id)) this.weights.set(id, w);
  }

  /** Effective weights after drivers have set their driven parameters. */
  effectiveWeights(): Map<number, number> {
    const w = new Map(this.weights);
    for (const p of this.params) {
      if (!p.driven) continue;
      const input = this.weights.get(p.id)!;
      for (const d of p.driven) w.set(d.id, drivenWeight(d, input, p, this.byId.get(d.id)!));
    }
    return w;
  }

  evaluate(): ShapeResult {
    const w = this.effectiveWeights();
    const male = (w.get(80) ?? 0) >= 0.5;
    const deltas: Record<string, JointDelta> = {};
    const bump = (name: string, scale: Vec3 | undefined, offset: Vec3 | undefined, k: number) => {
      const d = (deltas[name] ??= {});
      if (scale) d.scale = add3(d.scale, scale, k);
      if (offset) d.offset = add3(d.offset, offset, k);
    };
    for (const p of this.params) {
      if (!p.bones && !p.volumes) continue;
      const gated = p.sex !== undefined && (p.sex === "male") !== male;
      const k = gated ? p.default : (w.get(p.id) ?? p.default);
      if (k === 0) continue;
      for (const b of p.bones ?? []) {
        bump(b.name, b.scale, b.offset, k);
        if (b.scale) for (const cv of this.cvChildren.get(b.name) ?? []) {
          const rest = this.cvRest.get(cv)!;
          bump(cv, [rest[0] * b.scale[0], rest[1] * b.scale[1], rest[2] * b.scale[2]], undefined, k); // LLAvatarJointCollisionVolume::inheritScale
        }
      }
      for (const v of p.volumes ?? []) bump(v.name, v.scale, v.pos, k);
    }
    return { deltas, hover: w.get(11001) ?? 0, weights: w };
  }
}

/**
 * Distance from the pelvis down to the sole, as the viewer computes it (LLAvatarAppearance::computeBodySize).
 * The viewer lifts the avatar by this much so the feet stay on the ground when shape sliders change leg length.
 * Reads the skeleton's cached state: call `skeleton.update()` after changing deltas.
 */
export function pelvisToFoot(s: Skeleton): number {
  const z = (n: string) => s.localPositionOf(n)[2];
  const sz = (n: string) => s.scaleOf(n)[2];
  return z("mHipLeft") * sz("mPelvis") - z("mKneeLeft") * sz("mHipLeft") - z("mAnkleLeft") * sz("mKneeLeft") - z("mFootLeft") * sz("mAnkleLeft");
}

/**
 * The viewer's own estimate of avatar height (LLAvatarAppearance::computeBodySize): pelvis-to-foot plus the upper body,
 * with the head term scaled by √2 "to get to the top of the head". Uses local joint positions and own scales, which is
 * exactly why a bone's scale only affects its direct children's offsets. Call `skeleton.update()` first.
 */
export function computeBodyHeight(s: Skeleton): number {
  const z = (n: string) => s.localPositionOf(n)[2];
  const sz = (n: string) => s.scaleOf(n)[2];
  return (
    pelvisToFoot(s) +
    Math.SQRT2 * (z("mSkull") * sz("mHead")) +
    z("mHead") * sz("mNeck") +
    z("mNeck") * sz("mChest") +
    z("mChest") * sz("mTorso") +
    z("mTorso") * sz("mPelvis")
  );
}
