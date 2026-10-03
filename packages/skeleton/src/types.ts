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

// ---------------------------------------------------------------------------------------------------------------------
// Shape model (derived from avatar_lad.xml)
// ---------------------------------------------------------------------------------------------------------------------

export interface ShapeBoneEffect { name: string; scale?: Vec3; offset?: Vec3 }
export interface ShapeVolumeEffect { name: string; scale?: Vec3; pos?: Vec3 }
export interface ShapeDriven { id: number; min1: number; max1: number; max2: number; min2: number }

/** One visual parameter that affects the skeleton / collision volumes directly or by driving another one. */
export interface ShapeParam {
  id: number;
  name: string;
  /** Viewer's label, if any ("Height", "Leg Length"…). */
  label?: string;
  /** 0 = tweakable (stored in the shape), 1 = driven/derived. */
  group: number;
  wearable?: string;
  editGroup?: string;
  min: number;
  max: number;
  /** `value_default`, or 0 when the file does not give one (the viewer's rule). */
  default: number;
  /** The viewer applies a sex-limited parameter only to avatars of that sex. */
  sex?: "male" | "female";
  bones?: ShapeBoneEffect[];
  volumes?: ShapeVolumeEffect[];
  driven?: ShapeDriven[];
}

export interface ShapeData {
  source?: { repo: string; ref: string; file: string; sha256: string; license: string; note: string };
  params: ShapeParam[];
}
