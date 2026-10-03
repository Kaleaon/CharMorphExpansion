import { compose, type Mat4, quatFromMayaXYZ, quatMul, quatRotate, type Quat } from "./math.ts";
import type { SkeletonData, Vec3 } from "./types.ts";

/**
 * Additive shape deltas on top of a joint's (or collision volume's) rest values, exactly as the viewer applies its
 * `param_skeleton` / `volume_morph` entries: `joint.scale += weight * scale`, `joint.pos += weight * offset`.
 * Already weighted by the caller.
 */
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
 *
 * Transform rules follow the viewer (indra/llmath/xform.cpp, indra/llcharacter/lljoint.cpp):
 *   worldRot(j)  = worldRot(parent) · rot(j)
 *   worldPos(j)  = worldPos(parent) + worldRot(parent) · ( scale(parent) ⊙ pos(j) )     // only the *direct* parent's own scale
 *   worldMatrix  = T(worldPos) · R(worldRot) · S(scale(j))                              // only the joint's *own* scale
 * so a bone's scale does not accumulate down the hierarchy, unlike an ordinary scene graph.
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
  /** Collision-volume world matrices; their scale (the ellipsoid half-axes) is included. */
  readonly cvWorld: Float64Array;

  private readonly index = new Map<string, number>();
  private readonly cvIndex = new Map<string, number>();
  private readonly rotation: Quat[];
  private readonly restRot: Quat[];
  private readonly cvRot: Quat[];
  private readonly deltas: JointDelta[];
  private readonly cvDeltas: JointDelta[];
  private readonly worldRot: Quat[];
  private readonly scales: Vec3[];
  private readonly worldPos: Vec3[];
  private readonly localPos: Vec3[];

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
    this.restRot = data.joints.map((j) => quatFromMayaXYZ(j.rot));
    this.rotation = this.restRot.map((q) => [...q] as Quat);
    this.deltas = data.joints.map(() => ({}));
    this.worldRot = data.joints.map(() => [0, 0, 0, 1] as Quat);
    this.scales = data.joints.map(() => [1, 1, 1] as Vec3);
    this.worldPos = data.joints.map(() => [0, 0, 0] as Vec3);
    this.localPos = data.joints.map((j) => [...j.pos] as Vec3);
    this.world = new Float64Array(16 * this.count);

    this.cvCount = data.collisionVolumes.length;
    this.cvNames = data.collisionVolumes.map((c) => c.name);
    this.cvParents = new Int32Array(this.cvCount);
    this.cvRot = data.collisionVolumes.map((c, i) => {
      this.cvIndex.set(c.name, i);
      this.cvParents[i] = this.index.get(c.parent)!;
      return quatFromMayaXYZ(c.rot);
    });
    this.cvDeltas = data.collisionVolumes.map(() => ({}));
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

  /** Set a joint's local rotation as Euler degrees *added to its rest rotation* (viewer XYZ order). */
  setPoseEuler(name: string, euler: Vec3): void {
    const i = this.need(name);
    const r = this.data.joints[i]!.rot;
    this.rotation[i] = quatFromMayaXYZ([r[0] + euler[0], r[1] + euler[1], r[2] + euler[2]]);
  }

  resetPose(): void {
    this.rotation.forEach((_, i) => { this.rotation[i] = [...this.restRot[i]!] as Quat; });
  }

  /** Replace all shape deltas for joints and collision volumes. Names not mentioned return to rest; unknown names throw. */
  setDeltas(deltas: Record<string, JointDelta>): void {
    for (let i = 0; i < this.count; i++) this.deltas[i] = {};
    for (let c = 0; c < this.cvCount; c++) this.cvDeltas[c] = {};
    for (const [name, d] of Object.entries(deltas)) {
      const j = this.index.get(name);
      const c = j === undefined ? this.cvIndex.get(name) : undefined;
      if (j !== undefined) this.deltas[j] = d;
      else if (c !== undefined) this.cvDeltas[c] = d;
      else throw new SkeletonError(`unknown joint "${name}"`);
    }
  }

  /** Recompute world matrices for all joints and collision volumes. */
  update(): void {
    const joints = this.data.joints;
    const tmp: Mat4 = new Float64Array(16);
    for (let i = 0; i < this.count; i++) {
      const j = joints[i]!;
      const d = this.deltas[i]!;
      const pos: Vec3 = [j.pos[0] + (d.offset?.[0] ?? 0), j.pos[1] + (d.offset?.[1] ?? 0), j.pos[2] + (d.offset?.[2] ?? 0)];
      const scale: Vec3 = [j.scale[0] + (d.scale?.[0] ?? 0), j.scale[1] + (d.scale?.[1] ?? 0), j.scale[2] + (d.scale?.[2] ?? 0)];
      this.scales[i] = scale;
      this.localPos[i] = pos;
      const p = this.parents[i]!;
      if (p < 0) {
        this.worldPos[i] = pos;
        this.worldRot[i] = this.rotation[i]!;
      } else {
        const ps = this.scales[p]!, pw = this.worldPos[p]!;
        const off = quatRotate(this.worldRot[p]!, [ps[0] * pos[0], ps[1] * pos[1], ps[2] * pos[2]]);
        this.worldPos[i] = [pw[0] + off[0], pw[1] + off[1], pw[2] + off[2]];
        this.worldRot[i] = quatMul(this.worldRot[p]!, this.rotation[i]!);
      }
      this.world.set(compose(this.worldPos[i]!, this.worldRot[i]!, scale, tmp), i * 16);
    }
    for (let c = 0; c < this.cvCount; c++) {
      const cv = this.data.collisionVolumes[c]!;
      const d = this.cvDeltas[c]!;
      const p = this.cvParents[c]!;
      const pos: Vec3 = [cv.pos[0] + (d.offset?.[0] ?? 0), cv.pos[1] + (d.offset?.[1] ?? 0), cv.pos[2] + (d.offset?.[2] ?? 0)];
      const scale: Vec3 = [cv.scale[0] + (d.scale?.[0] ?? 0), cv.scale[1] + (d.scale?.[1] ?? 0), cv.scale[2] + (d.scale?.[2] ?? 0)];
      const ps = this.scales[p]!, pw = this.worldPos[p]!;
      const off = quatRotate(this.worldRot[p]!, [ps[0] * pos[0], ps[1] * pos[1], ps[2] * pos[2]]);
      this.cvWorld.set(compose([pw[0] + off[0], pw[1] + off[1], pw[2] + off[2]], quatMul(this.worldRot[p]!, this.cvRot[c]!), scale, tmp), c * 16);
    }
  }

  worldPosition(name: string): Vec3 {
    const i = this.need(name);
    return [...this.worldPos[i]!] as Vec3;
  }

  /** Current local offset from the parent (rest + deltas). */
  localPositionOf(name: string): Vec3 { return [...this.localPos[this.need(name)]!] as Vec3; }

  /** Current own scale of a joint (rest + deltas). */
  scaleOf(name: string): Vec3 { return [...this.scales[this.need(name)]!] as Vec3; }
}
