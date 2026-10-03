import { describe, expect, it } from "vitest";
import { decodeMeshPack, decodeTargetPack, encodeMeshPack, encodeTargetPack, PackError } from "../src/pack.ts";
import { gridMesh, randomTarget, rng } from "./helpers.ts";

const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe("mesh pack", () => {
  it("round-trips exactly", () => {
    const m = gridMesh(6);
    const { meta, bin } = encodeMeshPack(m, { origin: "test" });
    expect(meta.indexBytes).toBe(2);
    expect(meta.morphVertexCount).toBe(49);
    const back = decodeMeshPack(JSON.parse(JSON.stringify(meta)), ab(bin));
    expect(back.positions).toEqual(m.positions);
    expect(back.uvs).toEqual(m.uvs);
    expect(back.renderToMorph).toEqual(m.renderToMorph);
    expect(back.indices).toEqual(m.indices);
  });
  it("round-trips helper vertices and rejects a bad helperStart", () => {
    const m = gridMesh(4);
    const mv = m.positions.length / 3;
    const withHelpers = { ...m, helperStart: mv, positions: Float32Array.from([...m.positions, 1, 2, 3]) };
    const { meta, bin } = encodeMeshPack(withHelpers);
    expect(meta.helperStart).toBe(mv);
    const back = decodeMeshPack(JSON.parse(JSON.stringify(meta)), ab(bin));
    expect(back.helperStart).toBe(mv);
    expect(back.positions.length).toBe((mv + 1) * 3);
    expect(encodeMeshPack(m).meta.helperStart).toBeUndefined();
    expect(() => encodeMeshPack({ ...m, helperStart: mv + 5 })).toThrow(/helperStart/);
  });
  it("rejects inconsistent or truncated data", () => {
    const m = gridMesh(4);
    expect(() => encodeMeshPack({ ...m, uvs: new Float32Array(3) })).toThrow(PackError);
    expect(() => encodeMeshPack({ ...m, indices: Uint32Array.from([0, 1, 9999]) })).toThrow(PackError);
    const { meta, bin } = encodeMeshPack(m);
    expect(() => decodeMeshPack(meta, ab(bin.subarray(0, 16)))).toThrow(/too short/);
    expect(() => decodeMeshPack({ ...meta, format: "x" as never }, ab(bin))).toThrow(/unsupported/);
  });
});

describe("target pack", () => {
  it("round-trips within the int16 quantization step", () => {
    const m = gridMesh(8);
    const mv = m.positions.length / 3;
    const ts = [randomTarget("a", mv, 0.5, 0.3, rng(1)), randomTarget("b", mv, 0.2, 0.01, rng(2)), { id: "empty", indices: new Uint32Array(0), deltas: new Float32Array(0) }];
    const { meta, bin } = encodeTargetPack(ts, mv);
    const back = decodeTargetPack(JSON.parse(JSON.stringify(meta)), ab(bin));
    expect(back.map((t) => t.id)).toEqual(["a", "b", "empty"]);
    for (const [i, t] of ts.entries()) {
      expect(back[i]!.indices).toEqual(t.indices);
      const step = meta.targets[i]!.scale;
      for (let k = 0; k < t.deltas.length; k++) expect(Math.abs(back[i]!.deltas[k]! - t.deltas[k]!)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
  });
  it("rejects unsorted/out-of-range indices and duplicate ids", () => {
    const bad = { id: "x", indices: Uint32Array.from([3, 2]), deltas: new Float32Array(6) };
    expect(() => encodeTargetPack([bad], 10)).toThrow(/ascending/);
    expect(() => encodeTargetPack([{ ...bad, indices: Uint32Array.from([1, 99]) }], 10)).toThrow(/range/);
    const ok = { id: "x", indices: Uint32Array.from([1]), deltas: new Float32Array(3) };
    const { meta, bin } = encodeTargetPack([ok, { ...ok }], 10);
    expect(() => decodeTargetPack(meta, ab(bin))).toThrow(/duplicate/);
  });
});
