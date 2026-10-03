/**
 * Binary pack formats for base meshes and sparse morph targets.
 *
 * cm-mesh/1: one JSON header + one .bin. "Morph vertices" are the unique positions the targets move; "render vertices"
 * additionally split at UV seams, each pointing at its morph vertex via `renderToMorph`.
 * cm-targets/1: sparse per-target deltas over morph vertices, quantized to int16 with a per-target scale.
 */

export interface MorphMesh {
  name: string;
  /** Rest positions of the morph vertices, metres, xyz interleaved. */
  positions: Float32Array;
  /** Render-vertex UVs, uv interleaved. */
  uvs: Float32Array;
  renderToMorph: Uint32Array;
  /** Triangle list over render vertices. */
  indices: Uint32Array;
}

export interface MorphTarget {
  id: string;
  /** Ascending morph-vertex indices. */
  indices: Uint32Array;
  /** xyz deltas in metres, 3 per index. */
  deltas: Float32Array;
}

export interface MeshPackMeta {
  format: "cm-mesh/1";
  name: string;
  units: "m";
  morphVertexCount: number;
  renderVertexCount: number;
  triangleCount: number;
  indexBytes: 2 | 4;
  /** Byte offsets into the .bin. */
  sections: { positions: number; uvs: number; renderToMorph: number; indices: number };
  source: Record<string, string>;
}

export interface TargetPackMeta {
  format: "cm-targets/1";
  targets: { id: string; count: number; scale: number; indexOffset: number; deltaOffset: number; source?: string }[];
  source: Record<string, string>;
}

export class PackError extends Error {}

const align4 = (n: number) => (n + 3) & ~3;

class Writer {
  private chunks: Uint8Array[] = [];
  size = 0;
  add(bytes: Uint8Array): number {
    const at = this.size;
    this.chunks.push(bytes);
    const pad = align4(bytes.byteLength) - bytes.byteLength;
    if (pad) this.chunks.push(new Uint8Array(pad));
    this.size = align4(at + bytes.byteLength);
    return at;
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.byteLength; }
    return out;
  }
}

const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export function encodeMeshPack(mesh: MorphMesh, source: Record<string, string> = {}): { meta: MeshPackMeta; bin: Uint8Array } {
  const morphVertexCount = mesh.positions.length / 3;
  const renderVertexCount = mesh.renderToMorph.length;
  if (mesh.uvs.length !== renderVertexCount * 2) throw new PackError("uvs length does not match render vertex count");
  if (mesh.indices.length % 3 !== 0) throw new PackError("indices length is not a multiple of 3");
  const indexBytes: 2 | 4 = renderVertexCount <= 65536 ? 2 : 4;
  const w = new Writer();
  const sections = {
    positions: w.add(bytesOf(mesh.positions)),
    uvs: w.add(bytesOf(mesh.uvs)),
    renderToMorph: w.add(bytesOf(indexBytes === 2 ? Uint16Array.from(mesh.renderToMorph) : mesh.renderToMorph)),
    indices: w.add(bytesOf(indexBytes === 2 ? Uint16Array.from(mesh.indices) : mesh.indices)),
  };
  for (const i of mesh.renderToMorph) if (i >= morphVertexCount) throw new PackError("renderToMorph points outside the morph vertices");
  for (const i of mesh.indices) if (i >= renderVertexCount) throw new PackError("triangle index outside the render vertices");
  return {
    meta: { format: "cm-mesh/1", name: mesh.name, units: "m", morphVertexCount, renderVertexCount, triangleCount: mesh.indices.length / 3, indexBytes, sections, source },
    bin: w.finish(),
  };
}

export function decodeMeshPack(meta: MeshPackMeta, bin: ArrayBuffer): MorphMesh {
  if (meta.format !== "cm-mesh/1") throw new PackError(`unsupported mesh format ${String(meta.format)}`);
  const { sections: s, morphVertexCount: mv, renderVertexCount: rv, triangleCount: tc } = meta;
  const idxSize = meta.indexBytes;
  const need = Math.max(s.positions + mv * 12, s.uvs + rv * 8, s.renderToMorph + rv * idxSize, s.indices + tc * 3 * idxSize);
  if (bin.byteLength < need) throw new PackError(`mesh bin too short (${bin.byteLength} < ${need})`);
  const wide = (off: number, n: number) => (idxSize === 2 ? Uint32Array.from(new Uint16Array(bin, off, n)) : new Uint32Array(bin.slice(off, off + n * 4)));
  return {
    name: meta.name,
    positions: new Float32Array(bin.slice(s.positions, s.positions + mv * 12)),
    uvs: new Float32Array(bin.slice(s.uvs, s.uvs + rv * 8)),
    renderToMorph: wide(s.renderToMorph, rv),
    indices: wide(s.indices, tc * 3),
  };
}

export function encodeTargetPack(targets: (MorphTarget & { source?: string })[], morphVertexCount: number, source: Record<string, string> = {}): { meta: TargetPackMeta; bin: Uint8Array } {
  if (morphVertexCount > 65536) throw new PackError("target pack uses 16-bit indices; too many vertices");
  const w = new Writer();
  const entries = targets.map((t) => {
    const n = t.indices.length;
    if (t.deltas.length !== n * 3) throw new PackError(`${t.id}: deltas length mismatch`);
    for (let i = 0; i < n; i++) {
      if (t.indices[i]! >= morphVertexCount) throw new PackError(`${t.id}: index out of range`);
      if (i > 0 && t.indices[i]! <= t.indices[i - 1]!) throw new PackError(`${t.id}: indices must be strictly ascending`);
    }
    let max = 0;
    for (const d of t.deltas) max = Math.max(max, Math.abs(d));
    const scale = max > 0 ? max / 32767 : 1;
    const q = new Int16Array(n * 3);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(t.deltas[i]! / scale);
    const indexOffset = w.add(bytesOf(Uint16Array.from(t.indices)));
    const deltaOffset = w.add(bytesOf(q));
    return t.source === undefined ? { id: t.id, count: n, scale, indexOffset, deltaOffset } : { id: t.id, count: n, scale, indexOffset, deltaOffset, source: t.source };
  });
  return { meta: { format: "cm-targets/1", targets: entries, source }, bin: w.finish() };
}

export function decodeTargetPack(meta: TargetPackMeta, bin: ArrayBuffer): MorphTarget[] {
  if (meta.format !== "cm-targets/1") throw new PackError(`unsupported target format ${String(meta.format)}`);
  const seen = new Set<string>();
  return meta.targets.map((t) => {
    if (seen.has(t.id)) throw new PackError(`duplicate target ${t.id}`);
    seen.add(t.id);
    if (bin.byteLength < Math.max(t.indexOffset + t.count * 2, t.deltaOffset + t.count * 6)) throw new PackError(`${t.id}: bin too short`);
    const q = new Int16Array(bin.slice(t.deltaOffset, t.deltaOffset + t.count * 6));
    const deltas = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) deltas[i] = q[i]! * t.scale;
    return { id: t.id, indices: Uint32Array.from(new Uint16Array(bin, t.indexOffset, t.count)), deltas };
  });
}
