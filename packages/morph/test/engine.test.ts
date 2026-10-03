import { describe, expect, it } from "vitest";
import { MorphEngine, UnknownTargetError } from "../src/engine.ts";
import { gridMesh, randomTarget, rng } from "./helpers.ts";

const maxDiff = (a: Float32Array, b: Float32Array) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

function setup(n = 8, nTargets = 6, density = 0.4) {
  const mesh = gridMesh(n);
  const r = rng(7);
  const mv = mesh.positions.length / 3;
  const targets = Array.from({ length: nTargets }, (_, i) => randomTarget(`t${i}`, mv, density, 0.2, r));
  return { mesh, targets, r };
}

describe("MorphEngine", () => {
  it("starts at the base shape with upward normals on a flat plane", () => {
    const { mesh, targets } = setup();
    const e = new MorphEngine(mesh, targets);
    for (let r = 0; r < e.renderVertexCount; r++) {
      const m = mesh.renderToMorph[r]!;
      expect(e.positions[r * 3]).toBe(mesh.positions[m * 3]);
    }
    expect(Math.abs(e.normals[2]!)).toBeCloseTo(1, 5); // ±Z
  });

  it("incremental updates match a from-scratch evaluation (positions and normals)", () => {
    const { mesh, targets, r } = setup(10, 8);
    const inc = new MorphEngine(mesh, targets);
    for (let step = 0; step < 60; step++) {
      const w: Record<string, number> = {};
      for (const t of targets) if (r() < 0.5) w[t.id] = r();
      inc.setWeights(w);
      const fresh = new MorphEngine(mesh, targets);
      fresh.setWeights(w);
      expect(maxDiff(inc.positions, fresh.positions)).toBeLessThan(1e-5);
      expect(maxDiff(inc.normals, fresh.normals)).toBeLessThan(1e-4);
    }
  });

  it("returns exactly to the base shape when all weights go back to zero", () => {
    const { mesh, targets } = setup();
    const e = new MorphEngine(mesh, targets);
    const base = Float32Array.from(e.positions);
    const baseN = Float32Array.from(e.normals);
    e.setWeights({ t0: 0.9, t1: 0.3 });
    expect(maxDiff(e.positions, base)).toBeGreaterThan(1e-3);
    const stats = e.setWeights({});
    expect(stats.rebuilt).toBe(true);
    expect(maxDiff(e.positions, base)).toBe(0);
    expect(maxDiff(e.normals, baseN)).toBe(0);
  });

  it("moves both render copies of a UV-seam vertex together and shares their normal", () => {
    const { mesh, targets } = setup();
    const e = new MorphEngine(mesh, targets);
    e.setWeights({ t0: 1, t1: 1, t2: 1 });
    const byMorph = new Map<number, number[]>();
    mesh.renderToMorph.forEach((m, r) => byMorph.set(m, [...(byMorph.get(m) ?? []), r]));
    const dupes = [...byMorph.values()].filter((v) => v.length === 2);
    expect(dupes.length).toBeGreaterThan(0);
    for (const [a, b] of dupes) {
      for (let k = 0; k < 3; k++) {
        expect(e.positions[a! * 3 + k]).toBe(e.positions[b! * 3 + k]);
        expect(e.normals[a! * 3 + k]).toBe(e.normals[b! * 3 + k]);
      }
    }
  });

  it("only touches vertices of the targets that changed", () => {
    const { mesh, targets } = setup(12, 4, 0.1);
    const e = new MorphEngine(mesh, targets);
    e.setWeights({ t0: 0.5, t1: 0.5 });
    const stats = e.setWeights({ t0: 0.5, t1: 0.7 });
    expect(stats.changedTargets).toBe(1);
    expect(stats.dirtyVertices).toBe(targets[1]!.indices.length);
    expect(e.setWeights({ t0: 0.5, t1: 0.7 })).toEqual({ changedTargets: 0, dirtyVertices: 0, rebuilt: false });
  });

  it("rejects unknown target ids without changing state", () => {
    const { mesh, targets } = setup();
    const e = new MorphEngine(mesh, targets);
    e.setWeights({ t0: 0.4 });
    const before = Float32Array.from(e.positions);
    expect(() => e.setWeights({ t0: 1, nope: 1 })).toThrow(UnknownTargetError);
    expect(maxDiff(e.positions, before)).toBe(0);
  });

  it("does not drift over thousands of incremental updates", () => {
    const { mesh, targets, r } = setup(8, 5);
    const e = new MorphEngine(mesh, targets);
    let w: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) { w = { t0: r(), t1: r() * 0.5, t2: r() }; e.setWeights(w); }
    const fresh = new MorphEngine(mesh, targets);
    fresh.setWeights(w);
    expect(maxDiff(e.positions, fresh.positions)).toBeLessThan(1e-4);
  });

  it("addTargets makes new targets usable without disturbing the current shape, and rejects duplicates/bad indices atomically", () => {
    const { mesh, targets, r } = setup();
    const e = new MorphEngine(mesh, targets.slice(0, 3));
    e.setWeights({ t0: 0.6 });
    const before = Float32Array.from(e.positions);
    e.addTargets(targets.slice(3));
    expect(maxDiff(e.positions, before)).toBe(0);
    expect(e.targetIds).toHaveLength(6);
    e.setWeights({ t0: 0.6, t4: 0.5 });
    const fresh = new MorphEngine(mesh, targets);
    fresh.setWeights({ t0: 0.6, t4: 0.5 });
    expect(maxDiff(e.positions, fresh.positions)).toBeLessThan(1e-5);
    const bad = { id: "far", indices: Uint32Array.from([9999]), deltas: new Float32Array(3) };
    expect(() => e.addTargets([randomTarget("ok", 10, 1, 0.1, r), bad])).toThrow(/beyond the mesh/);
    expect(e.targetIds).not.toContain("ok");
    expect(() => e.addTargets([targets[0]!])).toThrow(/duplicate/);
  });

  it("helper vertices (never rendered) morph with the body and are exposed live", () => {
    const base = gridMesh(6);
    const mv = base.positions.length / 3;
    const mesh = { ...base, helperStart: mv, positions: Float32Array.from([...base.positions, 5, 5, 5, 6, 6, 6]) };
    const target = { id: "h", indices: Uint32Array.from([0, mv, mv + 1]), deltas: Float32Array.from([0, 0, 1, 1, 0, 0, 0, 2, 0]) };
    const e = new MorphEngine(mesh, [target]);
    expect(e.helperStart).toBe(mv);
    expect([...e.helperPositions]).toEqual([5, 5, 5, 6, 6, 6]);
    e.setWeights({ h: 0.5 });
    expect([...e.helperPositions]).toEqual([5.5, 5, 5, 6, 7, 6]);
    e.setWeights({});
    expect([...e.helperPositions]).toEqual([5, 5, 5, 6, 6, 6]);
    expect(e.renderVertexCount).toBe(base.renderToMorph.length); // helpers add no render vertices
    expect(Math.abs(e.normals[2]!)).toBeCloseTo(1, 5);
  });
});

import { NormalSolver } from "../src/normals.ts";
describe("NormalSolver", () => {
  it("reproduces the engine's normals for the engine's own positions, including across UV seams", () => {
    const { mesh, targets } = setup(10, 5);
    const e = new MorphEngine(mesh, targets);
    e.setWeights({ t0: 0.8, t3: 0.5 });
    const out = new Float32Array(e.normals.length);
    new NormalSolver(mesh).compute(e.positions, out);
    expect(maxDiff(out, e.normals)).toBeLessThan(1e-4);
  });
});
