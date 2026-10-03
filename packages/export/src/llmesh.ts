import { unzlibSync, zlibSync } from "fflate";
import { int, LlInt, parseBinary, serializeBinary, type Llsd } from "./llsd.ts";

/**
 * Second Life mesh assets ("LLMesh"): a binary-LLSD header with `{offset, size}` per block (offsets are from the end of the
 * header), then zlib-compressed binary-LLSD blocks: `skin`, optional `physics_convex`, and one array of faces per level of
 * detail. Written the way the viewer's own uploader does (indra/llprimitive/llmodel.cpp `writeModel`) and read the way
 * its mesh reader does (indra/llmath/llvolume.cpp `unpackVolumeFacesInternal`).
 *
 * Matrices are 16 numbers in file order: the same memory the viewer holds as row-vector matrices, i.e. a standard
 * *column-major* 4×4 for column vectors, with the translation in elements 12–14.
 */

export const LOD_NAMES = ["lowest_lod", "low_lod", "medium_lod", "high_lod"] as const;
export type LodName = (typeof LOD_NAMES)[number];

export class LlMeshError extends Error {}

export interface LlFace {
  /** xyz per vertex. */
  positions: Float32Array;
  normals?: Float32Array;
  /** uv per vertex. */
  uvs?: Float32Array;
  /** Triangle list; every index must be below the vertex count and fit 16 bits. */
  indices: ArrayLike<number>;
  /** Up to four joint influences per vertex (indices into the skin's joint list), 4 slots per vertex; zero weights are ignored. */
  influences?: { joints: ArrayLike<number>; weights: ArrayLike<number> };
}

export interface LlSkin {
  jointNames: string[];
  /** One 16-number inverse bind matrix per joint. */
  inverseBind: ArrayLike<number>[];
  /** Applied to the (de-normalized) vertex before the joint matrices; identity if omitted. */
  bindShape?: ArrayLike<number>;
  /**
   * Joint-position overrides: one local (parent-relative) position per joint. They travel as `alt_inverse_bind_matrix`, which is
   * the inverse bind matrix with its translation replaced by this position.
   */
  jointPositions?: ArrayLike<number>[];
  /** Raises the avatar by this many metres (the viewer's pelvis fix-up). */
  pelvisOffset?: number;
  /** Ask the viewer to keep the default joint scale wherever a joint position is overridden. */
  lockScaleIfJointPosition?: boolean;
}

export interface LlMeshInput {
  /** `high` is required; missing lower levels are simply left out of the asset. */
  lods: Partial<Record<"lowest" | "low" | "medium" | "high", LlFace[]>> & { high: LlFace[] };
  skin?: LlSkin;
}

export interface LlMeshInfo {
  /** Centre and size of the original bounds (what the normalization removed); needed to scale a non-rigged prim. */
  center: [number, number, number];
  size: [number, number, number];
  triangles: Record<string, number>;
  vertices: Record<string, number>;
  bytes: number;
}

const mul4 = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function u16(n: number): number { return Math.max(0, Math.min(65535, Math.round(n))); }
function le16(out: Uint8Array, at: number, v: number): void { out[at] = v & 255; out[at + 1] = v >> 8; }

/** Largest-remainder quantization of positive weights to u16 values summing to exactly 65535. */
function quantizeWeights(w: number[]): number[] {
  const sum = w.reduce((s, x) => s + x, 0);
  const exact = w.map((x) => (x / sum) * 65535);
  const q = exact.map((e) => Math.max(1, Math.floor(e)));
  let rest = 65535 - q.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0 && k < 1000; k++) {
    const [, i] = order[k % order.length]!;
    if (rest > 0) { q[i]!++; rest--; } else if (q[i]! > 1) { q[i]!--; rest++; }
  }
  return q;
}

function encodeWeights(face: LlFace, nVerts: number, jointCount: number): Uint8Array {
  const inf = face.influences!;
  const out: number[] = [];
  for (let v = 0; v < nVerts; v++) {
    const list: { j: number; w: number }[] = [];
    for (let s = 0; s < 4; s++) {
      const w = inf.weights[v * 4 + s]!;
      if (w > 0) list.push({ j: inf.joints[v * 4 + s]!, w });
    }
    list.sort((a, b) => b.w - a.w);
    const top = list.slice(0, 4);
    if (top.length === 0) throw new LlMeshError(`vertex ${v} has no joint influence`);
    for (const t of top) if (!Number.isInteger(t.j) || t.j < 0 || t.j >= jointCount || t.j >= 255) throw new LlMeshError(`vertex ${v}: joint index ${t.j} is out of range (0..${Math.min(jointCount, 255) - 1})`);
    const q = quantizeWeights(top.map((t) => t.w));
    top.forEach((t, i) => { out.push(t.j, q[i]! & 255, q[i]! >> 8); });
    if (top.length < 4) out.push(0xff);
  }
  return Uint8Array.from(out);
}

/** Encode a rigged (or plain) mesh. Positions are normalized to the unit cube exactly like the uploader does, and that is compensated in the bind-shape matrix. */
export function encodeLlMesh(input: LlMeshInput): { bytes: Uint8Array; info: LlMeshInfo } {
  const high = input.lods.high;
  if (high.length === 0) throw new LlMeshError("the high level of detail needs at least one face");
  if (high.length > 8) throw new LlMeshError(`a mesh has at most 8 faces (materials), got ${high.length}`);

  // Bounds of the high LOD define the normalization for all levels.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of high) for (let i = 0; i < f.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, f.positions[i + a]!); hi[a] = Math.max(hi[a]!, f.positions[i + a]!); }
  if (!lo.every(Number.isFinite) || !hi.every(Number.isFinite)) throw new LlMeshError("positions contain non-finite values");
  const center = lo.map((l, a) => (l + hi[a]!) / 2) as [number, number, number];
  const size = lo.map((l, a) => { const s = hi[a]! - l; return Math.abs(s) < 1e-6 ? 1 : s; }) as [number, number, number];

  const skin = input.skin;
  const jointCount = skin?.jointNames.length ?? 0;
  if (skin) {
    if (jointCount === 0 || jointCount > 110) throw new LlMeshError(`a rigged mesh needs 1..110 joints, got ${jointCount}`);
    if (skin.inverseBind.length !== jointCount) throw new LlMeshError("inverseBind must have one matrix per joint");
    if (skin.jointPositions && skin.jointPositions.length !== jointCount) throw new LlMeshError("jointPositions must have one entry per joint (the viewer ignores overrides otherwise)");
    for (const m of skin.inverseBind) if (m.length !== 16) throw new LlMeshError("matrices have 16 numbers");
  }

  const blocks: { name: string; data: Uint8Array }[] = [];
  const triangles: Record<string, number> = {}, vertices: Record<string, number> = {};

  const encodeLod = (name: string, faces: LlFace[]): void => {
    const lodLo = [Infinity, Infinity, Infinity], lodHi = [-Infinity, -Infinity, -Infinity];
    const norm = faces.map((f) => {
      const p = new Float32Array(f.positions.length);
      for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) {
        p[i + a] = (f.positions[i + a]! - center[a]!) / size[a]!;
        lodLo[a] = Math.min(lodLo[a]!, p[i + a]!); lodHi[a] = Math.max(lodHi[a]!, p[i + a]!);
      }
      return p;
    });
    const arr: Llsd[] = faces.map((f, fi) => {
      const n = f.positions.length / 3;
      if (!Number.isInteger(n) || n < 3) return { NoGeometry: true };
      if (n > 65535) throw new LlMeshError(`face ${fi} has ${n} vertices; a face holds at most 65535`);
      if (f.indices.length % 3 !== 0) throw new LlMeshError(`face ${fi}: index count is not a multiple of 3`);
      const p = norm[fi]!;
      const pos = new Uint8Array(n * 6);
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
        const range = lodHi[a]! - lodLo[a]!;
        le16(pos, (i * 3 + a) * 2, range > 0 ? u16(((p[i * 3 + a]! - lodLo[a]!) / range) * 65535) : 0);
      }
      const tri = new Uint8Array(f.indices.length * 2);
      for (let i = 0; i < f.indices.length; i++) {
        const ix = f.indices[i]!;
        if (!(ix >= 0 && ix < n)) throw new LlMeshError(`face ${fi}: index ${ix} is outside 0..${n - 1}`);
        le16(tri, i * 2, ix);
      }
      const face: { [k: string]: Llsd } = {
        PositionDomain: { Min: [...lodLo], Max: [...lodHi] },
        NormalizedScale: [...size],
        Position: pos,
        TriangleList: tri,
      };
      if (f.normals) {
        const nb = new Uint8Array(n * 6);
        for (let i = 0; i < n; i++) {
          // the uploader scales normals by the inverse of the position scale (i.e. by the size) and renormalizes
          const v = [0, 1, 2].map((a) => f.normals![i * 3 + a]! * size[a]!);
          const len = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
          for (let a = 0; a < 3; a++) le16(nb, (i * 3 + a) * 2, u16(((v[a]! / len + 1) * 0.5) * 65535));
        }
        face.Normal = nb;
      }
      if (f.uvs) {
        let mnu = Infinity, mnv = Infinity, mxu = -Infinity, mxv = -Infinity;
        for (let i = 0; i < n; i++) { mnu = Math.min(mnu, f.uvs[i * 2]!); mxu = Math.max(mxu, f.uvs[i * 2]!); mnv = Math.min(mnv, f.uvs[i * 2 + 1]!); mxv = Math.max(mxv, f.uvs[i * 2 + 1]!); }
        const ru = mxu - mnu, rv = mxv - mnv;
        const tb = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) {
          le16(tb, i * 4, ru > 0 ? u16(((f.uvs[i * 2]! - mnu) / ru) * 65535) : 0);
          le16(tb, i * 4 + 2, rv > 0 ? u16(((f.uvs[i * 2 + 1]! - mnv) / rv) * 65535) : 0);
        }
        face.TexCoord0Domain = { Min: [mnu, mnv], Max: [mxu, mxv] };
        face.TexCoord0 = tb;
      }
      if (skin) {
        if (!f.influences) throw new LlMeshError(`face ${fi} has no joint influences but the mesh is rigged`);
        face.Weights = encodeWeights(f, n, jointCount);
      }
      return face;
    });
    triangles[name] = faces.reduce((s, f) => s + f.indices.length / 3, 0);
    vertices[name] = faces.reduce((s, f) => s + f.positions.length / 3, 0);
    blocks.push({ name, data: zlibSync(serializeBinary(arr), { level: 9 }) });
  };

  if (skin) {
    // Bind shape: vertex (normalized) -> original coordinates -> caller's bind shape. Column-vector form: B · N.
    const N = [size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, center[0], center[1], center[2], 1];
    const bind = mul4(skin.bindShape ?? IDENTITY, N);
    const s: { [k: string]: Llsd } = {
      joint_names: [...skin.jointNames],
      inverse_bind_matrix: skin.inverseBind.map((m) => Array.from(m)),
      bind_shape_matrix: bind,
    };
    if (skin.jointPositions) {
      s.alt_inverse_bind_matrix = skin.inverseBind.map((m, i) => {
        const a = Array.from(m);
        const p = skin.jointPositions![i]!;
        a[12] = p[0]!; a[13] = p[1]!; a[14] = p[2]!;
        return a;
      });
      if (skin.lockScaleIfJointPosition) s.lock_scale_if_joint_position = true;
      s.pelvis_offset = skin.pelvisOffset ?? 0;
    }
    blocks.push({ name: "skin", data: zlibSync(serializeBinary(s), { level: 9 }) });
  }
  for (const [key, name] of [["lowest", "lowest_lod"], ["low", "low_lod"], ["medium", "medium_lod"], ["high", "high_lod"]] as const) {
    const faces = input.lods[key];
    if (faces && faces.length) encodeLod(name, faces);
  }

  // Header: blocks in the viewer's order (skin first, then LODs lowest → high), offsets measured from the end of the header.
  const header: { [k: string]: Llsd } = {};
  let off = 0;
  for (const b of blocks) { header[b.name] = { offset: int(off), size: int(b.data.length) }; off += b.data.length; }
  const head = serializeBinary(header);
  const bytes = new Uint8Array(head.length + off);
  bytes.set(head, 0);
  let o = head.length;
  for (const b of blocks) { bytes.set(b.data, o); o += b.data.length; }
  return { bytes, info: { center, size, triangles, vertices, bytes: bytes.length } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading (mirrors the viewer's reader; used to verify what we write)
// ---------------------------------------------------------------------------------------------------------------------

export interface DecodedFace {
  /** Positions in the file's normalized space (before the bind-shape matrix). */
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices: Uint16Array;
  /** Per vertex: up to 4 joint indices and their weights (clamped to [0.001, 0.999] like the viewer). Absent slots are weight 0. */
  joints?: Uint8Array;
  weights?: Float32Array;
  normalizedScale?: [number, number, number];
}

export interface DecodedSkin {
  jointNames: string[];
  inverseBind: number[][];
  bindShape: number[];
  altInverseBind?: number[][];
  pelvisOffset?: number;
  lockScaleIfJointPosition?: boolean;
}

export interface DecodedMesh {
  header: Record<string, { offset: number; size: number }>;
  lods: Partial<Record<LodName, DecodedFace[]>>;
  skin?: DecodedSkin;
}

const num = (v: Llsd | undefined): number => (v instanceof LlInt ? v.value : typeof v === "number" ? v : NaN);
const arrNums = (v: Llsd | undefined): number[] => (Array.isArray(v) ? v.map(num) : []);
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);

function decodeFace(f: Record<string, Llsd>): DecodedFace | null {
  if (f.NoGeometry) return null;
  const pos = f.Position as Uint8Array, tri = f.TriangleList as Uint8Array;
  const dom = f.PositionDomain as Record<string, Llsd>;
  const mn = arrNums(dom.Min), mx = arrNums(dom.Max);
  const n = pos.length / 6;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) positions[i * 3 + a] = mn[a]! + (u16le(pos, (i * 3 + a) * 2) / 65535) * (mx[a]! - mn[a]!);
  const indices = new Uint16Array(Math.floor(tri.length / 2 / 3) * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = u16le(tri, i * 2);
  const out: DecodedFace = { positions, indices };
  if (f.NormalizedScale) out.normalizedScale = arrNums(f.NormalizedScale) as [number, number, number];
  if (f.Normal) { const nb = f.Normal as Uint8Array; out.normals = new Float32Array(n * 3).map((_, i) => (u16le(nb, i * 2) / 65535) * 2 - 1); }
  if (f.TexCoord0) {
    const tb = f.TexCoord0 as Uint8Array, td = f.TexCoord0Domain as Record<string, Llsd>;
    const tmn = arrNums(td.Min), tmx = arrNums(td.Max);
    out.uvs = new Float32Array(n * 2).map((_, i) => tmn[i % 2]! + (u16le(tb, i * 2) / 65535) * (tmx[i % 2]! - tmn[i % 2]!));
  }
  if (f.Weights) {
    const w = f.Weights as Uint8Array;
    out.joints = new Uint8Array(n * 4);
    out.weights = new Float32Array(n * 4);
    let p = 0;
    for (let v = 0; v < n && p < w.length; v++) {
      let j = w[p++]!, k = 0;
      while (j !== 0xff && p < w.length) {
        const infl = u16le(w, p); p += 2;
        out.joints[v * 4 + k] = j; out.weights[v * 4 + k] = Math.min(0.999, Math.max(0.001, infl / 65535));
        k++;
        if (k >= 4) break;
        j = w[p++]!;
      }
    }
    if (p !== w.length) throw new LlMeshError("weight stream does not match the vertex count");
  }
  return out;
}

export function decodeLlMesh(bytes: Uint8Array): DecodedMesh {
  const { value, end } = parseBinary(bytes);
  const h = value as Record<string, Llsd>;
  const header: DecodedMesh["header"] = {};
  const block = (name: string): Llsd => {
    const e = h[name] as Record<string, Llsd>;
    const offset = num(e.offset), size = num(e.size);
    if (!(offset >= 0 && size > 0 && end + offset + size <= bytes.length)) throw new LlMeshError(`block ${name} lies outside the asset`);
    header[name] = { offset, size };
    return parseBinary(unzlibSync(bytes.subarray(end + offset, end + offset + size))).value;
  };
  const out: DecodedMesh = { header, lods: {} };
  for (const name of LOD_NAMES) if (h[name]) out.lods[name] = (block(name) as Record<string, Llsd>[]).map(decodeFace).filter((f): f is DecodedFace => f !== null);
  if (h.skin) {
    const s = block("skin") as Record<string, Llsd>;
    const skin: DecodedSkin = {
      jointNames: (s.joint_names as string[]) ?? [],
      inverseBind: ((s.inverse_bind_matrix as Llsd[]) ?? []).map(arrNums),
      bindShape: arrNums(s.bind_shape_matrix),
    };
    if (s.alt_inverse_bind_matrix) skin.altInverseBind = (s.alt_inverse_bind_matrix as Llsd[]).map(arrNums);
    if (s.pelvis_offset !== undefined) skin.pelvisOffset = num(s.pelvis_offset);
    if (s.lock_scale_if_joint_position !== undefined) skin.lockScaleIfJointPosition = s.lock_scale_if_joint_position === true;
    out.skin = skin;
  }
  return out;
}
