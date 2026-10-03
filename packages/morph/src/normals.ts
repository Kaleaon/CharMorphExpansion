import type { MorphMesh } from "./pack.ts";

/**
 * Smooth vertex normals for arbitrary render-order positions of a mesh (e.g. after skinning). Faces are averaged per *morph*
 * vertex, so normals stay continuous across UV seams exactly like the morph engine's. Not incremental: O(triangles).
 */
export class NormalSolver {
  private readonly tri: Uint32Array;
  private readonly renderToMorph: Uint32Array;
  private readonly mv: number;
  private readonly tmp: Float32Array;

  constructor(mesh: MorphMesh) {
    this.renderToMorph = mesh.renderToMorph;
    this.mv = mesh.positions.length / 3;
    this.tri = mesh.indices;
    this.tmp = new Float32Array(this.mv * 3);
  }

  /** `positions` and `out` are render-order, 3 floats per render vertex. */
  compute(positions: Float32Array, out: Float32Array): void {
    const acc = this.tmp;
    acc.fill(0);
    const { tri, renderToMorph: m } = this;
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
      const ux = positions[b * 3]! - positions[a * 3]!, uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!, uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
      const vx = positions[c * 3]! - positions[a * 3]!, vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!, vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const r of [a, b, c]) { const k = m[r]! * 3; acc[k]! += nx; acc[k + 1]! += ny; acc[k + 2]! += nz; }
    }
    for (let r = 0; r < m.length; r++) {
      const k = m[r]! * 3;
      const x = acc[k]!, y = acc[k + 1]!, z = acc[k + 2]!;
      const len = Math.hypot(x, y, z);
      if (len > 0) { out[r * 3] = x / len; out[r * 3 + 1] = y / len; out[r * 3 + 2] = z / len; }
      else { out[r * 3] = 0; out[r * 3 + 1] = 1; out[r * 3 + 2] = 0; }
    }
  }
}
