import { describe, expect, it } from "vitest";
import { loadBody } from "../../rig/test/helpers.ts";
import { decodeLlMesh, exportBodyMesh } from "../src/index.ts";

const { mesh, rig, model, frame } = loadBody();

/** Column-vector 4x4 (translation at 12..14) applied to a point. */
const xf = (m: number[], x: number, y: number, z: number): [number, number, number] => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
];

describe("exportBodyMesh on the MakeHuman body", () => {
  const f = frame();
  const out = exportBodyMesh(f, rig, mesh, { lods: "high" });
  const dec = decodeLlMesh(out.bytes);
  const face = dec.lods.high_lod![0]!;

  it("fits the format's limits", () => {
    expect(out.vertices).toBe(mesh.renderToMorph.length);
    expect(face.positions.length / 3).toBe(out.vertices);
    expect(out.joints.length).toBeGreaterThan(20);
    expect(out.joints.length).toBeLessThanOrEqual(110);
    expect(out.joints).toContain("mPelvis");
    expect(dec.skin!.jointNames).toEqual(out.joints);
  });

  it("reproduces the T-posed body through the viewer's skinning formula when joints sit at the bind pose", () => {
    const rt = rig.retarget(f);
    const t = new Float32Array(f.positions.length);
    rig.tpose(f, rt, t);
    const skin = dec.skin!;
    // joints at bind: world = translate(p), so invBind * world = identity and the result is the bind-shape-transformed vertex
    let worst = 0;
    for (let v = 0; v < out.vertices; v += 7) {
      const p = xf(skin.bindShape, face.positions[v * 3]!, face.positions[v * 3 + 1]!, face.positions[v * 3 + 2]!);
      const m = v; // frame positions are per render vertex
      const want = [t[m * 3 + 2]!, t[m * 3]!, t[m * 3 + 1]!]; // viewport -> SL
      for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(p[a]! - want[a]!));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("carries joint overrides, and omits them on request", () => {
    expect(dec.skin!.altInverseBind).toHaveLength(out.joints.length);
    expect(dec.skin!.lockScaleIfJointPosition).toBe(true);
    const plain = decodeLlMesh(exportBodyMesh(f, rig, mesh, { lods: "high", jointOverrides: false }).bytes);
    expect(plain.skin!.altInverseBind).toBeUndefined();
  });

  it("weights every vertex and sums to 1", () => {
    for (let v = 0; v < out.vertices; v += 11) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += face.weights![v * 4 + k]!;
      expect(s).toBeGreaterThan(0.99);
      expect(s).toBeLessThan(1.01);
    }
  });

  it("changes with the character and writes four LODs by default", () => {
    model.set("gender", 0.9);
    const tall = exportBodyMesh(frame(), rig, mesh);
    model.reset();
    expect(tall.bytes.length).toBeGreaterThan(out.bytes.length * 3);
    expect(Object.keys(decodeLlMesh(tall.bytes).lods)).toHaveLength(4);
  });
});
