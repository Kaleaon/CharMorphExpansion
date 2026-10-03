/** Coordinates are Second Life native: right-handed, +X forward, +Y left, +Z up, metres. */
export type Vec3 = [number, number, number];
export type Support = "base" | "extended";

export interface JointDef {
  name: string;
  parent: string | null;
  aliases: string[];
  /** Rest offset from the parent joint. */
  pos: Vec3;
  /** Pivot as listed in the source (equals `pos` except for the two toe bones). */
  pivot: Vec3;
  /** Tip of the bone relative to the joint (for drawing). */
  end: Vec3;
  /** Rest rotation, Euler degrees (all zero in the current source). */
  rot: Vec3;
  /** Rest scale (all one in the current source). */
  scale: Vec3;
  connected: boolean;
  group: string;
  /** `base` = classic pre-Bento bone, `extended` = Bento addition. */
  support: Support;
}

export interface CollisionVolumeDef {
  name: string;
  parent: string;
  group: string;
  support: Support;
  pos: Vec3;
  /** Euler degrees. */
  rot: Vec3;
  /** Ellipsoid axis lengths. */
  scale: Vec3;
  end: Vec3;
}

export interface SkeletonData {
  version: string;
  source?: { repo: string; ref: string; file: string; sha256: string; license: string; note: string };
  /** Parent-before-child order. */
  joints: JointDef[];
  collisionVolumes: CollisionVolumeDef[];
}
