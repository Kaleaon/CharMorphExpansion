import type { MorphMesh, MorphTarget } from "../src/pack.ts";

/** Deterministic PRNG so tests are reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** (n+1)² grid in the XY plane. Vertices on column x=n/2 are split in two render vertices (a UV seam). */
export function gridMesh(n = 8): MorphMesh & { seamColumn: number; vid: (i: number, j: number) => number } {
  const c = n / 2;
  const vid = (i: number, j: number) => j * (n + 1) + i;
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.set([i / n, j / n, 0], vid(i, j) * 3);
  const renderToMorph: number[] = [];
  const left = new Map<number, number>(); // morph -> render (for seam verts: left copy)
  const right = new Map<number, number>();
  for (let m = 0; m < (n + 1) * (n + 1); m++) {
    left.set(m, renderToMorph.length);
    renderToMorph.push(m);
  }
  for (let j = 0; j <= n; j++) { right.set(vid(c, j), renderToMorph.length); renderToMorph.push(vid(c, j)); }
  const pick = (i: number, j: number, cellI: number) => (i === c && cellI >= c ? right.get(vid(i, j))! : left.get(vid(i, j))!);
  const indices: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = pick(i, j, i), b = pick(i + 1, j, i), d = pick(i, j + 1, i), e = pick(i + 1, j + 1, i);
    indices.push(a, b, e, a, e, d);
  }
  const uvs = new Float32Array(renderToMorph.length * 2);
  renderToMorph.forEach((m, r) => uvs.set([positions[m * 3]!, positions[m * 3 + 1]!], r * 2));
  return { name: "grid", positions, uvs, renderToMorph: Uint32Array.from(renderToMorph), indices: Uint32Array.from(indices), seamColumn: c, vid };
}

export function randomTarget(id: string, mv: number, density: number, amp: number, r: () => number): MorphTarget {
  const idx: number[] = [];
  const del: number[] = [];
  for (let v = 0; v < mv; v++) if (r() < density) { idx.push(v); del.push((r() - 0.5) * amp, (r() - 0.5) * amp, (r() - 0.5) * amp); }
  return { id, indices: Uint32Array.from(idx), deltas: Float32Array.from(del) };
}
