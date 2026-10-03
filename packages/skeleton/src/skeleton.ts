import { compose, type Mat4, mul, type Quat, quatFromEulerXYZ, translationOf } from "./math.ts";
import type { SkeletonData, Vec3 } from "./types.ts";

/** Additive per-joint shape deltas, the way Second Life's `param_skeleton` sliders apply them (already weighted by the caller). */
export interface JointDelta {
  scale?: Vec3;
  offset?: Vec3;
}

/** SL ignores joint offsets smaller than this (Project Bento notes: 0.1 mm). */
export const MIN_JOINT_OFFSET = 0.0001;

export class SkeletonError extends Error {}

/** Check structural invariants of a skeleton table; returns human-readable problems (empty = valid). */
export function validateSkeletonData(d: SkeletonData): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  for (const j of d.joints) {
    if (names.has(j.name)) out.push(`duplicate joint name ${j.name}`);
    names.add(j.name);
  }
  for (const [i, j] of d.joints.entries()) {
    if (j.parent === null) { if (i !== 0) out.push(`${j.name}: extra root`); }
    else if (!seen.has(j.parent)) out.push(`${j.name}: parent ${j.parent} missing or listed after child`);
    seen.add(j.name);
  }
  const cvNames = new Set<string>();
  for (const c of d.collisionVolumes) {
    if (cvNames.has(c.name)) out.push(`duplicate collision volume ${c.name}`);
    cvNames.add(c.name);
    if (names.has(c.name)) out.push(`collision volume ${c.name} clashes with a joint name`);
    if (!names.has(c.parent)) out.push(`collision volume ${c.name}: unknown parent ${c.parent}`);
  }
  return out;
}

/**
 * Renderer-agnostic skeleton: rest data + pose (joint rotations) + shape deltas → world matrices.
 * All space is Second Life native (+X forward, +Y left, +Z up).
 */
export class Skeleton {
  readonly count: number;
  readonly names: string[];
  readonly parents: Int32Array;
  readonly cvCount: number;
  readonly cvNames: string[];
  readonly cvParents: Int32Array;
  /** World matrices, 16 doubles per joint, column-major. Valid after `update()`. */
  readonly world: Float64Array;
  readonly cvWorld: Float64Array;

  private readonly index = new Map<string, number>();
  private readonly cvIndex = new Map<string, number>();
  private readonly rotation: Quat[];
  private readonly deltas: JointDelta[];
  private readonly cvLocal: Mat4[];
  private readonly scratch: Mat4 = new Float64Array(16);

  constructor(readonly data: SkeletonData) {
    const problems = validateSkeletonData(data);
    if (problems.length) throw new SkeletonError(`invalid skeleton: ${problems.slice(0, 5).join("; ")}`);
    this.count = data.joints.length;
    this.names = data.joints.map((j) => j.name);
    this.parents = new Int32Array(this.count);
    data.joints.forEach((j, i) => {
      this.index.set(j.name, i);
      for (const a of j.aliases) if (!this.index.has(a)) this.index.set(a, i);
      this.parents[i] = j.parent === null ? -1 : this.index.get(j.parent)!;
    });
    this.rotation = data.joints.map((j) => quatFromEulerXYZ(j.rot));
    this.deltas = data.joints.map(() => ({}));
    this.world = new Float64Array(16 * this.count);

    this.cvCount = data.collisionVolumes.length;
    this.cvNames = data.collisionVolumes.map((c) => c.name);
    this.cvParents = new Int32Array(this.cvCount);
    this.cvLocal = data.collisionVolumes.map((c, i) => {
      this.cvIndex.set(c.name, i);
      this.cvParents[i] = this.index.get(c.parent)!;
      return compose(c.pos, quatFromEulerXYZ(c.rot), [1, 1, 1]);
    });
    this.cvWorld = new Float64Array(16 * this.cvCount);
    this.update();
  }

  /** Joint index by name or alias (e.g. `hip` → `mPelvis`); -1 if unknown. */
  indexOf(name: string): number { return this.index.get(name) ?? -1; }
  cvIndexOf(name: string): number { return this.cvIndex.get(name) ?? -1; }

  private need(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new SkeletonError(`unknown joint "${name}"`);
    return i;
  }

  /** Set a joint's local rotation as Euler degrees *added to its rest rotation*. */
  setPoseEuler(name: string, euler: Vec3): void {
    const i = this.need(name);
    const r = this.data.joints[i]!.rot;
    this.rotation[i] = quatFromEulerXYZ([r[0] + euler[0], r[1] + euler[1], r[2] + euler[2]]);
  }

  resetPose(): void {
    this.data.joints.forEach((j, i) => { this.rotation[i] = quatFromEulerXYZ(j.rot); });
  }

  /** Replace all shape deltas. Joints not mentioned return to rest. Unknown joint names throw. */
  setDeltas(deltas: Record<string, JointDelta>): void {
    for (let i = 0; i < this.count; i++) this.deltas[i] = {};
    for (const [name, d] of Object.entries(deltas)) this.deltas[this.need(name)] = d;
  }

  /** Recompute world matrices for all joints and collision volumes. */
  update(): void {
    const joints = this.data.joints;
    const local = this.scratch;
    for (let i = 0; i < this.count; i++) {
      const j = joints[i]!;
      const d = this.deltas[i]!;
      const o = d.offset;
      const s = d.scale;
      compose(
        [j.pos[0] + (o?.[0] ?? 0), j.pos[1] + (o?.[1] ?? 0), j.pos[2] + (o?.[2] ?? 0)],
        this.rotation[i]!,
        [j.scale[0] + (s?.[0] ?? 0), j.scale[1] + (s?.[1] ?? 0), j.scale[2] + (s?.[2] ?? 0)],
        local,
      );
      const p = this.parents[i]!;
      if (p < 0) this.world.set(local, i * 16);
      else this.world.set(mul(this.world.subarray(p * 16, p * 16 + 16), local), i * 16);
    }
    for (let c = 0; c < this.cvCount; c++) {
      const p = this.cvParents[c]!;
      this.cvWorld.set(mul(this.world.subarray(p * 16, p * 16 + 16), this.cvLocal[c]!), c * 16);
    }
  }

  worldPosition(name: string): Vec3 {
    const i = this.need(name);
    return translationOf(this.world.subarray(i * 16, i * 16 + 16));
  }
}
