import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CharacterModel, validateSpec, type CharacterSpec } from "../../core/src/index.ts";
import { MorphEngine } from "../src/engine.ts";
import { decodeMeshPack, decodeTargetPack, type MeshPackMeta, type TargetPackMeta } from "../src/pack.ts";

const dir = new URL("../../../assets/makehuman-hm08/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir));
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const mesh = decodeMeshPack(JSON.parse(read("mesh.json").toString()) as MeshPackMeta, ab(read("mesh.bin")));
const targets = decodeTargetPack(JSON.parse(read("targets.json").toString()) as TargetPackMeta, ab(read("targets.bin")));
const spec = JSON.parse(read("spec.json").toString()) as CharacterSpec;
const known = new Set(targets.map((t) => t.id));

const height = (pos: Float32Array) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]!); hi = Math.max(hi, pos[i]!); } return hi - lo; };
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("makehuman-hm08 pack", () => {
  it("spec is valid and every referenced target exists; every target is referenced", () => {
    expect(validateSpec(spec, known)).toEqual([]);
    const used = new Set<string>();
    for (const s of spec.sliders) for (const b of s.bindings) { if (b.neg) used.add(b.neg); if (b.pos) used.add(b.pos); }
    for (const m of spec.macros) for (const t of Object.values(m.targets)) used.add(t);
    expect([...known].filter((t) => !used.has(t))).toEqual([]);
  });

  it("base mesh is a human-sized body standing on y=0, facing +Z, with outward normals", () => {
    const h = height(mesh.positions);
    expect(h).toBeGreaterThan(1.5);
    expect(h).toBeLessThan(2.0);
    let minY = Infinity; for (let i = 1; i < mesh.positions.length; i += 3) minY = Math.min(minY, mesh.positions[i]!);
    expect(minY).toBeCloseTo(0, 5);
    // Winding: positive signed volume means triangles are counter-clockwise seen from outside, i.e. normals point out.
    const P = mesh.positions;
    let vol = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.renderToMorph[mesh.indices[i]!]! * 3, b = mesh.renderToMorph[mesh.indices[i + 1]!]! * 3, c = mesh.renderToMorph[mesh.indices[i + 2]!]! * 3;
      vol += P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
    }
    expect(vol / 6).toBeGreaterThan(0.02); // m³; a human body is roughly 0.06–0.09 m³
    expect(vol / 6).toBeLessThan(0.2);
    // Facing +Z: soles extend forward of the ankles (compare mean z of the sole band and the ankle band).
    const meanZ = (lo: number, hi: number) => { let sum = 0, n = 0; for (let i = 0; i < P.length; i += 3) if (P[i + 1]! >= lo && P[i + 1]! < hi) { sum += P[i + 2]!; n++; } return sum / n; };
    expect(meanZ(0, 0.03)).toBeGreaterThan(meanZ(0.1, 0.14));
  });

  it("default sliders produce macro weights that sum to 1 per macro group", () => {
    const m = new CharacterModel(spec, known);
    const w = m.weights();
    const raceGender = [...w].filter(([k]) => /-young$/.test(k) && !k.startsWith("universal"));
    const build = [...w].filter(([k]) => k.startsWith("universal"));
    expect(sum(raceGender.map(([, v]) => v))).toBeCloseTo(1, 9);
    expect(sum(build.map(([, v]) => v))).toBeCloseTo(1, 9);
  });

  it("gender, weight and limb sliders change the body in the expected direction", () => {
    const e = new MorphEngine(mesh, targets);
    const m = new CharacterModel(spec, known);
    const apply = () => e.setWeights(m.weights());
    const bbox = (axis: number, filter?: (y: number) => boolean) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < e.positions.length; i += 3) { if (Math.abs(e.positions[i]!) > 0.3) continue; /* torso/legs only, not hanging arms */ if (filter && !filter(e.positions[i + 1]!)) continue; lo = Math.min(lo, e.positions[i + axis]!); hi = Math.max(hi, e.positions[i + axis]!); } return hi - lo; };
    apply();
    const h0 = height(e.positions);
    m.set("gender", 1); apply();
    expect(height(e.positions)).toBeGreaterThan(h0); // male is taller than the androgynous default
    m.reset(); m.set("gender", 0); apply();
    expect(height(e.positions)).toBeLessThan(h0);
    m.reset(); apply();
    const w0 = bbox(0, (y) => y > h0 * 0.55 && y < h0 * 0.62);
    m.set("weight", 1); apply();
    expect(bbox(0, (y) => y > h0 * 0.55 && y < h0 * 0.62)).toBeGreaterThan(w0); // heavier = wider midsection
    m.reset(); apply();
    const leg0 = bbox(1);
    m.set("thigh-length", 1); m.set("shin-length", 1); apply();
    expect(bbox(1)).toBeGreaterThan(leg0 + 0.01);
    m.reset(); apply();
    expect(height(e.positions)).toBeCloseTo(h0, 5);
  });

  it("reports engine timings on the real mesh (informational)", () => {
    const e = new MorphEngine(mesh, targets);
    const m = new CharacterModel(spec, known);
    const time = (label: string, fn: () => void, n = 50) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); const ms = (performance.now() - t) / n; console.log(`  ${label}: ${ms.toFixed(2)} ms/update`); return ms; };
    let v = 0;
    time("regional slider (thigh-length, 2 targets)", () => { v = (v + 0.013) % 1; m.set("thigh-length", v); e.setWeights(m.weights()); });
    time("macro slider (gender → all race/build targets)", () => { v = (v + 0.013) % 1; m.set("gender", v); e.setWeights(m.weights()); });
    time("weight slider", () => { v = (v + 0.013) % 1; m.set("weight", v); e.setWeights(m.weights()); });
    expect(true).toBe(true);
  });
});
