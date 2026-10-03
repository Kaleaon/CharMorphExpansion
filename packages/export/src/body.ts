import { NormalSolver, type MorphMesh } from "@charmorph/morph";
import type { BodyFrame, BodyRig } from "@charmorph/rig";
import { SL_SKELETON_DATA } from "@charmorph/skeleton";
import { buildCollada } from "./collada.ts";
import { encodeLlMesh, type LlFace, type LlMeshInfo } from "./llmesh.ts";

export interface BodyExportOptions {
  /** Carry the character's own joint positions in the mesh (Second Life "joint positions" / Bento overrides). Default true. */
  jointOverrides?: boolean;
  /** With overrides: keep default joint scale wherever a position is overridden (the uploader's "Lock scale if joint position defined"). Default true. */
  lockScale?: boolean;
  /** Raises the avatar by this many metres (the viewer's pelvis fix-up). Default 0 — see the notes on foot height. */
  pelvisOffset?: number;
  /**
   * Levels of detail: "copies" writes the high level four times (always valid, big); "high" writes only `high_lod`.
   * Default "copies". Real decimated levels are future work.
   */
  lods?: "copies" | "high";
}

export interface BodyExport {
  bytes: Uint8Array;
  info: LlMeshInfo;
  /** Joints the mesh is weighted to, in file order. */
  joints: string[];
  /** The character's joint positions in SL space (what the inverse bind matrices are built from). */
  bindPositions: Map<string, [number, number, number]>;
  triangles: number;
  vertices: number;
}

/** Viewport space (x = avatar left, y up, z forward) → Second Life space (x forward, y left, z up): a proper rotation, so winding is kept. */
const toSl = (src: Float32Array): Float32Array => {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) { out[i] = src[i + 2]!; out[i + 1] = src[i]!; out[i + 2] = src[i + 1]!; }
  return out;
};

/** Everything both file formats need from the character, in Second Life space. */
export interface BodyData {
  face: LlFace;
  joints: string[];
  bind: Map<string, [number, number, number]>;
  /** Local rest offset of every SL joint for this character (SL space). */
  rest: Record<string, [number, number, number]>;
  triangles: number;
  vertices: number;
}

/** T-pose the body, solve its normals and gather the joints that carry weight. */
export function prepareBody(frame: BodyFrame, rig: BodyRig, mesh: MorphMesh): BodyData {
  const rt = rig.retarget(frame);
  const tposed = new Float32Array(frame.positions.length);
  rig.tpose(frame, rt, tposed);
  const normals = new Float32Array(tposed.length);
  new NormalSolver(mesh).compute(tposed, normals);

  // Joints that actually carry weight, in a stable order.
  const used = new Set<number>();
  const { indices, weights } = rig.skin;
  for (let m = 0; m < indices.length / 4; m++) for (let k = 0; k < 4; k++) if (weights[m * 4 + k]! > 0) used.add(indices[m * 4 + k]!);
  const order = [...used].sort((a, b) => a - b);
  const remap = new Map(order.map((j, i) => [j, i]));
  const joints = order.map((j) => rig.skin.joints[j]!);

  const nv = mesh.renderToMorph.length;
  const infJoints = new Uint8Array(nv * 4), infWeights = new Float32Array(nv * 4);
  for (let r = 0; r < nv; r++) {
    const m = mesh.renderToMorph[r]!;
    for (let k = 0; k < 4; k++) {
      const w = weights[m * 4 + k]!;
      if (w > 0) { infJoints[r * 4 + k] = remap.get(indices[m * 4 + k]!)!; infWeights[r * 4 + k] = w; }
    }
  }
  const face: LlFace = {
    positions: toSl(tposed),
    normals: toSl(normals),
    uvs: mesh.uvs,
    indices: mesh.indices,
    influences: { joints: infJoints, weights: infWeights },
  };
  return {
    face, joints,
    bind: rig.bindPositions(rt) as BodyData["bind"],
    rest: rig.customRest(rt) as BodyData["rest"],
    triangles: mesh.indices.length / 3,
    vertices: nv,
  };
}

/**
 * Export the current character as a rigged Second Life mesh asset: the T-posed body, weighted to the SL joints it uses, with
 * inverse bind matrices for the character's own skeleton and (optionally) that skeleton as joint-position overrides.
 */
export function exportBodyMesh(frame: BodyFrame, rig: BodyRig, mesh: MorphMesh, opts: BodyExportOptions = {}): BodyExport {
  const d = prepareBody(frame, rig, mesh);
  const { face, joints, bind, rest } = d;
  const overrides = opts.jointOverrides ?? true;
  const { bytes, info } = encodeLlMesh({
    lods: opts.lods === "high" ? { high: [face] } : { lowest: [face], low: [face], medium: [face], high: [face] },
    skin: {
      jointNames: joints,
      inverseBind: joints.map((j) => { const p = bind.get(j)!; return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1]; }),
      ...(overrides ? { jointPositions: joints.map((j) => rest[j]!), lockScaleIfJointPosition: opts.lockScale ?? true, pelvisOffset: opts.pelvisOffset ?? 0 } : {}),
    },
  });
  return { bytes, info, joints, bindPositions: bind, triangles: d.triangles, vertices: d.vertices };
}

export interface ColladaExportOptions {
  /** Write this character's joint positions; otherwise the stock SL positions (which the uploader treats as "no override"). Default true. */
  jointOverrides?: boolean;
  /** Name of the mesh and its material in the file. Default "body". */
  name?: string;
}

export function exportBodyCollada(frame: BodyFrame, rig: BodyRig, mesh: MorphMesh, opts: ColladaExportOptions = {}): { xml: string; joints: string[]; triangles: number; vertices: number } {
  const d = prepareBody(frame, rig, mesh);
  const overrides = opts.jointOverrides ?? true;
  const stock: Record<string, [number, number, number]> = {};
  for (const j of SL_SKELETON_DATA.joints) stock[j.name] = [...j.pos] as [number, number, number];
  const xml = buildCollada({
    name: opts.name ?? "body",
    face: d.face,
    joints: d.joints,
    bindPositions: d.joints.map((j) => d.bind.get(j)!),
    hierarchy: SL_SKELETON_DATA.joints.map((j) => ({ name: j.name, parent: j.parent, position: (overrides ? d.rest : stock)[j.name]! })),
  });
  return { xml, joints: d.joints, triangles: d.triangles, vertices: d.vertices };
}
