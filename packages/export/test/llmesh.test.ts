import { describe, expect, it } from "vitest";
import { decodeLlMesh, encodeLlMesh, LlMeshError, type LlFace, type LlMeshInput } from "../src/llmesh.ts";
import { parseBinary, type LlInt, type Llsd } from "../src/llsd.ts";

// A small two-joint "limb": 8 vertices (a box), weights blending joint 0 (bottom) to joint 1 (top).
const box = (): LlFace => {
  const p: number[] = [], w: number[] = [], j: number[] = [], uv: number[] = [], n: number[] = [];
  for (const z of [0, 1]) for (const y of [-0.5, 0.5]) for (const x of [-0.5, 0.5]) {
    p.push(x * 2, y * 2 + 3, z * 4 + 10); // deliberately off-origin and anisotropic: 2 x 2 x 4 at (0,3,12)
    n.push(0, 0, z ? 1 : -1);
    uv.push(x + 0.5, z);
    j.push(0, 1, 0, 0); w.push(1 - z * 0.75, z * 0.75, 0, 0);
  }
  const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  return { positions: Float32Array.from(p), normals: Float32Array.from(n), uvs: Float32Array.from(uv), indices: idx, influences: { joints: j, weights: w } };
};
// Joints at rest: j0 at (0,3,10), j1 at (0,3,14). Inverse bind = translate(-P) (column-major, translation in 12..14).
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const P = [[0, 3, 10], [0, 3, 14]];
const invBind = P.map((q) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -q[0]!, -q[1]!, -q[2]!, 1]);
const input = (over: Partial<LlMeshInput> = {}): LlMeshInput => ({
  lods: { high: [box()] },
  skin: { jointNames: ["mPelvis", "mTorso"], inverseBind: invBind },
  ...over,
});

/** The viewer's rendering formula for one vertex in column-vector form: world · invBind · bindShape · v. */
const mulv = (m: ArrayLike<number>, v: number[]) => [0, 1, 2].map((r) => m[r]! * v[0]! + m[4 + r]! * v[1]! + m[8 + r]! * v[2]! + m[12 + r]!);
const mulm = (a: ArrayLike<number>, b: ArrayLike<number>) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!; return o; };
const translate = (p: number[]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0]!, p[1]!, p[2]!, 1];

describe("file layout", () => {
  const { bytes, info } = encodeLlMesh(input());
  const { value, end } = parseBinary(bytes);
  const h = value as Record<string, Record<string, LlInt>>;

  it("starts with a binary-LLSD map header (no text prefix) listing skin and high_lod with contiguous offsets", () => {
    expect(bytes[0]).toBe(0x7b);
    expect(Object.keys(h).sort()).toEqual(["high_lod", "skin"]);
    expect(h.skin!.offset!.value).toBe(0);
    expect(h.high_lod!.offset!.value).toBe(h.skin!.size!.value);
    expect(end + h.skin!.size!.value + h.high_lod!.size!.value).toBe(bytes.length);
    expect(info.bytes).toBe(bytes.length);
  });
  it("compresses blocks as zlib streams (0x78 header)", () => {
    expect(bytes[end]).toBe(0x78);
    expect(bytes[end + h.high_lod!.offset!.value]).toBe(0x78);
  });
  it("writes only the levels it was given, in the viewer's order (skin, then lowest → high)", () => {
    const f = input().lods.high;
    const all = encodeLlMesh({ ...input(), lods: { lowest: f, low: f, medium: f, high: f } });
    const hh = parseBinary(all.bytes).value as Record<string, Record<string, LlInt>>;
    const order = Object.entries(hh).sort((a, b) => a[1]!.offset!.value - b[1]!.offset!.value).map(([k]) => k);
    expect(order).toEqual(["skin", "lowest_lod", "low_lod", "medium_lod", "high_lod"]);
  });
  it("is deterministic", () => {
    expect(encodeLlMesh(input()).bytes).toEqual(bytes);
  });
});

describe("geometry round trip", () => {
  const { bytes, info } = encodeLlMesh(input());
  const d = decodeLlMesh(bytes);
  const face = d.lods.high_lod![0]!;

  it("reports the bounds the normalization removed", () => {
    expect(info.center).toEqual([0, 3, 12]);
    expect(info.size).toEqual([2, 2, 4]);
    expect(info.triangles.high_lod).toBe(12);
    expect(info.vertices.high_lod).toBe(8);
  });
  it("stores positions in the unit cube and indices exactly", () => {
    for (const v of face.positions) expect(Math.abs(v)).toBeLessThanOrEqual(0.5 + 1e-4);
    expect([...face.indices]).toEqual(box().indices as number[]);
    expect(face.normalizedScale).toEqual([2, 2, 4]);
  });
  it("keeps UVs and (size-scaled, renormalized) normals", () => {
    expect([...face.uvs!].every((x, i) => Math.abs(x - box().uvs![i]!) < 1e-4)).toBe(true);
    for (let i = 0; i < 8; i++) expect(face.normals![i * 3 + 2]).toBeCloseTo(box().normals![i * 3 + 2]!, 3);
  });
});

describe("skin block: the viewer's rendering formula gives back the original vertices", () => {
  const { bytes } = encodeLlMesh(input());
  const d = decodeLlMesh(bytes);
  const face = d.lods.high_lod![0]!;
  const original = box().positions;

  it("with joints at their bind pose: world · invBind · bindShape · v == original (normalization is compensated)", () => {
    const worlds = P.map(translate);
    const mats = d.skin!.inverseBind.map((inv, j) => mulm(worlds[j]!, inv));
    for (let v = 0; v < 8; v++) {
      let acc = [0, 0, 0];
      // the viewer's getPerVertexSkinMatrix renormalizes the (clamped) weights by their sum
      const total = [0, 1, 2, 3].reduce((t, k) => t + face.weights![v * 4 + k]!, 0);
      for (let s = 0; s < 4; s++) {
        const w = face.weights![v * 4 + s]! / total;
        if (w === 0) continue;
        const bound = mulv(d.skin!.bindShape, [face.positions[v * 3]!, face.positions[v * 3 + 1]!, face.positions[v * 3 + 2]!]);
        const m = mulv(mats[face.joints![v * 4 + s]!]!, bound);
        acc = acc.map((a, i) => a + w * m[i]!);
      }
      for (let a = 0; a < 3; a++) expect(acc[a]).toBeCloseTo(original[v * 3 + a]!, 3);
    }
  });
  it("moves with the skeleton: raising joint 1 by 2 m lifts a fully-weighted top vertex by ~2 m", () => {
    const worlds = [translate(P[0]!), translate([0, 3, 16])];
    const mats = d.skin!.inverseBind.map((inv, j) => mulm(worlds[j]!, inv));
    const v = 7; // top vertex, weight 0.75 on joint 1 and 0.25 on joint 0
    const bound = mulv(d.skin!.bindShape, [face.positions[v * 3]!, face.positions[v * 3 + 1]!, face.positions[v * 3 + 2]!]);
    let z = 0, total = 0;
    for (let k = 0; k < 4; k++) { // slots are ordered strongest first, so go by the decoded joint id
      const w = face.weights![v * 4 + k]!;
      if (w === 0) continue;
      z += w * mulv(mats[face.joints![v * 4 + k]!]!, bound)[2]!;
      total += w;
    }
    z /= total;
    expect(z).toBeCloseTo(original[v * 3 + 2]! + 0.75 * 2, 2);
  });
  it("lists the joints and carries one inverse bind matrix of 16 numbers per joint", () => {
    expect(d.skin!.jointNames).toEqual(["mPelvis", "mTorso"]);
    expect(d.skin!.inverseBind).toHaveLength(2);
    d.skin!.inverseBind[1]!.slice(12, 15).forEach((x, i) => expect(x).toBeCloseTo([0, -3, -14][i]!, 12));
    expect(d.skin!.altInverseBind).toBeUndefined();
    expect(d.skin!.pelvisOffset).toBeUndefined();
  });
});

describe("weights", () => {
  const w = (f: (face: LlFace) => void) => { const b = box(); f(b); return decodeLlMesh(encodeLlMesh({ ...input(), lods: { high: [b] } }).bytes).lods.high_lod![0]!; };
  it("encodes (joint, u16) pairs, ends short vertices with 0xFF, and quantizes to a sum of exactly 1", () => {
    const face = w(() => {});
    for (let v = 0; v < 8; v++) {
      let s = 0; for (let k = 0; k < 4; k++) s += face.weights![v * 4 + k]!;
      expect(s).toBeCloseTo(1, 2);
    }
    expect(face.joints![0]).toBe(0); // bottom vertex: only joint 0
    expect(face.weights![1]).toBe(0);  // no second influence
  });
  it("keeps the four strongest influences, drops zero weights, and renormalizes", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    const identity = six.map(() => IDENT);
    const b = box();
    // vertex 0: influences on joints 0..5 with weights .05 .3 .2 .25 0 .2 -> strongest four are joints 1, 3, 2, 5
    const joints = new Array(32).fill(0), weights = new Array(32).fill(0);
    joints.splice(0, 4, 1, 3, 2, 5); weights.splice(0, 4, 0.3, 0.25, 0.2, 0.2);
    for (let v = 1; v < 8; v++) { joints[v * 4] = 0; weights[v * 4] = 1; }
    b.influences = { joints: [1, 3, 2, 5, ...joints.slice(4)], weights: [0.3, 0.25, 0.2, 0.2, ...weights.slice(4)] };
    const face = decodeLlMesh(encodeLlMesh({ lods: { high: [b] }, skin: { jointNames: six, inverseBind: identity } }).bytes).lods.high_lod![0]!;
    expect([...face.joints!.slice(0, 4)]).toEqual([1, 3, 2, 5]);
    expect(face.weights![0]! + face.weights![1]! + face.weights![2]! + face.weights![3]!).toBeCloseTo(1, 3);
    // a fifth non-zero influence is dropped, not an error
    const c = box();
    const cw: number[] = [0.4, 0.3, 0.2, 0.1, ...new Array<number>(28).fill(0)];
    for (let v = 1; v < 8; v++) cw[v * 4] = 1;
    c.influences = { joints: [0, 1, 2, 3, ...new Array<number>(28).fill(0)], weights: cw };
    expect(() => encodeLlMesh({ lods: { high: [c] }, skin: { jointNames: six, inverseBind: identity } })).not.toThrow();
  });
  it("rejects vertices without influences, unknown joints, and rigged faces without influence data", () => {
    expect(() => w((b) => { b.influences = { joints: new Array(32).fill(0), weights: new Array(32).fill(0) }; })).toThrow(/no joint influence/);
    expect(() => w((b) => { b.influences = { joints: new Array(32).fill(5), weights: new Array(32).fill(1) }; })).toThrow(/out of range/);
    expect(() => w((b) => { delete b.influences; })).toThrow(/no joint influences/);
  });
});

describe("joint overrides and options", () => {
  it("writes alt_inverse_bind_matrix = inverse bind with the joint's local position as translation, plus pelvis offset and scale lock", () => {
    const local = [[0, 0, 1.067], [0, 0, 0.2]];
    const { bytes } = encodeLlMesh(input({ skin: { jointNames: ["mPelvis", "mTorso"], inverseBind: invBind, jointPositions: local, pelvisOffset: 0.016, lockScaleIfJointPosition: true } }));
    const s = decodeLlMesh(bytes).skin!;
    expect(s.altInverseBind).toHaveLength(2);
    expect(s.altInverseBind![1]!.slice(12, 15)).toEqual([0, 0, 0.2]);
    expect(s.altInverseBind![1]!.slice(0, 12)).toEqual(s.inverseBind[1]!.slice(0, 12));
    expect(s.pelvisOffset).toBeCloseTo(0.016, 12);
    expect(s.lockScaleIfJointPosition).toBe(true);
  });
  it("omits the override block entirely when no joint positions are given", () => {
    const s = decodeLlMesh(encodeLlMesh(input({ skin: { jointNames: ["a", "b"], inverseBind: invBind, pelvisOffset: 1, lockScaleIfJointPosition: true } })).bytes).skin!;
    expect(s.altInverseBind).toBeUndefined();
    expect(s.pelvisOffset).toBeUndefined();
  });
  it("applies a caller bind-shape matrix after un-normalization", () => {
    const shift = translate([0, 0, -1]);
    const d = decodeLlMesh(encodeLlMesh(input({ skin: { jointNames: ["a", "b"], inverseBind: invBind, bindShape: shift } })).bytes);
    const p = mulv(d.skin!.bindShape, [0, 0, 0]); // the centre of the normalized cube
    expect(p).toEqual([0, 3, 11]); // original centre (0,3,12), shifted down by 1
  });
});

describe("limits", () => {
  it("rejects what the format or the viewer cannot take", () => {
    expect(() => encodeLlMesh({ lods: { high: [] } })).toThrow(LlMeshError);
    expect(() => encodeLlMesh({ lods: { high: new Array(9).fill(box()) }, skin: input().skin! })).toThrow(/at most 8 faces/);
    const big: LlFace = { positions: new Float32Array(65536 * 3), indices: [0, 1, 2] };
    expect(() => encodeLlMesh({ lods: { high: [big] } })).toThrow(/at most 65535/);
    expect(() => encodeLlMesh({ lods: { high: [{ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), indices: [0, 1, 5] }] } })).toThrow(/outside/);
    expect(() => encodeLlMesh({ lods: { high: [{ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), indices: [0, 1] }] } })).toThrow(/multiple of 3/);
    expect(() => encodeLlMesh({ lods: { high: [box()] }, skin: { jointNames: new Array(111).fill("x"), inverseBind: new Array(111).fill(invBind[0]!) } })).toThrow(/1\.\.110 joints/);
    expect(() => encodeLlMesh({ lods: { high: [box()] }, skin: { jointNames: ["a", "b"], inverseBind: invBind, jointPositions: [[0, 0, 0]] } })).toThrow(/one entry per joint/);
    expect(() => encodeLlMesh({ lods: { high: [{ positions: Float32Array.of(NaN, 0, 0, 1, 0, 0, 0, 1, 0), indices: [0, 1, 2] }] } })).toThrow(/non-finite/);
  });
  it("decodes a mesh without skin or normals", () => {
    const d = decodeLlMesh(encodeLlMesh({ lods: { high: [{ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), indices: [0, 1, 2] }] } }).bytes);
    expect(d.skin).toBeUndefined();
    expect(d.lods.high_lod![0]!.normals).toBeUndefined();
    expect(d.lods.high_lod![0]!.weights).toBeUndefined();
  });
});
