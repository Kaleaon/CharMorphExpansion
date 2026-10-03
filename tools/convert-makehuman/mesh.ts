import type { MorphMesh } from "../../packages/morph/src/pack.ts";
import { parseObj } from "./obj.ts";

/** MakeHuman uses decimetres. */
export const UNIT = 0.1;

/**
 * Build the body-only render mesh from base.obj. Returns the source-vertex → morph-vertex map used to remap targets.
 * `helperSource` are extra base.obj vertices (not part of the body, e.g. skeleton joint references) that are appended as
 * non-rendered helper morph vertices after the body vertices, so they follow every morph.
 */
export function buildMesh(objText: string, helperSource: ReadonlySet<number> = new Set()): { mesh: MorphMesh; toMorph: Map<number, number>; offsetY: number } {
  const obj = parseObj(objText);
  const faces = obj.groups.get("body");
  if (!faces?.length) throw new Error("base.obj has no 'body' group");

  // Morph vertices = unique source vertices used by the body, in source order.
  const used = new Set<number>();
  for (const f of faces) for (const c of f) used.add(c.v);
  const body = [...used].sort((a, b) => a - b);
  const helpers = [...helperSource].filter((v) => !used.has(v)).sort((a, b) => a - b);
  const sorted = [...body, ...helpers];
  const toMorph = new Map(sorted.map((v, i) => [v, i]));

  let minY = Infinity;
  for (const v of body) minY = Math.min(minY, obj.v[v * 3 + 1]!); // feet on y=0 comes from the body, not the helpers
  const positions = new Float32Array(sorted.length * 3);
  sorted.forEach((v, i) => positions.set([obj.v[v * 3]! * UNIT, (obj.v[v * 3 + 1]! - minY) * UNIT, obj.v[v * 3 + 2]! * UNIT], i * 3));

  // Render vertices split on (vertex, uv) pairs.
  const renderKey = new Map<string, number>();
  const renderToMorph: number[] = [];
  const uvs: number[] = [];
  const renderOf = (c: { v: number; vt: number }): number => {
    const key = `${c.v}/${c.vt}`;
    let r = renderKey.get(key);
    if (r === undefined) {
      r = renderToMorph.length;
      renderKey.set(key, r);
      renderToMorph.push(toMorph.get(c.v)!);
      uvs.push(c.vt >= 0 ? obj.vt[c.vt * 2]! : 0, c.vt >= 0 ? obj.vt[c.vt * 2 + 1]! : 0);
    }
    return r;
  };
  const indices: number[] = [];
  for (const f of faces) for (let k = 1; k < f.length - 1; k++) indices.push(renderOf(f[0]!), renderOf(f[k]!), renderOf(f[k + 1]!));

  // Winding: make triangles counter-clockwise seen from outside (positive signed volume).
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = renderToMorph[indices[i]!]! * 3, b = renderToMorph[indices[i + 1]!]! * 3, c = renderToMorph[indices[i + 2]!]! * 3;
    const p = positions;
    vol += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  if (vol < 0) for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = t; }

  return {
    mesh: { name: "makehuman-hm08-body", helperStart: body.length, positions, uvs: Float32Array.from(uvs), renderToMorph: Uint32Array.from(renderToMorph), indices: Uint32Array.from(indices) },
    toMorph,
    offsetY: -minY * UNIT,
  };
}
