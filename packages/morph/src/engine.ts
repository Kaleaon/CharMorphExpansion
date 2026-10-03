import type { MorphMesh, MorphTarget } from "./pack.ts";

export class UnknownTargetError extends Error {}

export interface UpdateStats {
  changedTargets: number;
  dirtyVertices: number;
  /** True when positions were rebuilt from scratch (drift guard / reset to base). */
  rebuilt: boolean;
}

const WEIGHT_EPS = 1e-7;
/** Rebuild from the base shape after this many incremental updates to bound float drift. */
const REBUILD_EVERY = 256;
/** Above this share of dirty vertices, recompute all normals instead of the dirty region. */
const FULL_NORMALS_FRACTION = 0.4;

/**
 * Applies weighted sparse targets to a base mesh incrementally: only the *change* in each target's weight is added, so
 * the cost of an update is proportional to the targets that moved. Normals are recomputed only around moved vertices.
 */
export class MorphEngine {
  /** Render-order outputs (what you upload to the GPU). */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Live view of the helper (non-rendered) vertices' current positions, xyz interleaved; empty without helpers. */
  readonly helperPositions: Float32Array;
  /** Index of the first helper morph vertex. */
  readonly helperStart: number;

  private readonly mv: number;
  private readonly rv: number;
  private readonly base: Float32Array;
  private readonly morphPos: Float32Array;
  private readonly morphNormals: Float32Array;
  private readonly targets = new Map<string, MorphTarget>();
  private readonly applied = new Map<string, number>();
  private readonly renderToMorph: Uint32Array;
  // morph vertex -> render vertices (CSR)
  private readonly m2rStart: Uint32Array;
  private readonly m2rList: Uint32Array;
  // triangles over morph vertices, and vertex -> triangles (CSR)
  private readonly tri: Uint32Array;
  private readonly vfStart: Uint32Array;
  private readonly vfList: Uint32Array;
  private readonly faceNormals: Float32Array;
  private readonly dirtyFlag: Uint8Array;
  private readonly faceStamp: Int32Array;
  private readonly vertStamp: Int32Array;
  private stamp = 0;
  private incremental = 0;

  constructor(mesh: MorphMesh, targets: Iterable<MorphTarget>) {
    this.mv = mesh.positions.length / 3;
    this.rv = mesh.renderToMorph.length;
    this.base = mesh.positions;
    this.morphPos = Float32Array.from(mesh.positions);
    this.helperStart = mesh.helperStart ?? this.mv;
    this.helperPositions = this.morphPos.subarray(this.helperStart * 3);
    this.morphNormals = new Float32Array(this.mv * 3);
    this.renderToMorph = mesh.renderToMorph;
    for (const t of targets) this.targets.set(t.id, t);

    this.m2rStart = new Uint32Array(this.mv + 1);
    for (const m of mesh.renderToMorph) this.m2rStart[m + 1]!++;
    for (let i = 0; i < this.mv; i++) this.m2rStart[i + 1]! += this.m2rStart[i]!;
    this.m2rList = new Uint32Array(this.rv);
    const fill = this.m2rStart.slice(0, this.mv);
    for (let r = 0; r < this.rv; r++) this.m2rList[fill[mesh.renderToMorph[r]!]!++] = r;

    const tc = mesh.indices.length / 3;
    this.tri = new Uint32Array(tc * 3);
    for (let i = 0; i < this.tri.length; i++) this.tri[i] = mesh.renderToMorph[mesh.indices[i]!]!;
    this.vfStart = new Uint32Array(this.mv + 1);
    for (const v of this.tri) this.vfStart[v + 1]!++;
    for (let i = 0; i < this.mv; i++) this.vfStart[i + 1]! += this.vfStart[i]!;
    this.vfList = new Uint32Array(this.tri.length);
    const vf = this.vfStart.slice(0, this.mv);
    for (let f = 0; f < tc; f++) for (let k = 0; k < 3; k++) this.vfList[vf[this.tri[f * 3 + k]!]!++] = f;

    this.faceNormals = new Float32Array(tc * 3);
    this.dirtyFlag = new Uint8Array(this.mv);
    this.faceStamp = new Int32Array(tc);
    this.vertStamp = new Int32Array(this.mv);
    this.positions = new Float32Array(this.rv * 3);
    this.normals = new Float32Array(this.rv * 3);
    this.rebuildAll();
  }

  get targetIds(): string[] { return [...this.targets.keys()]; }

  /** Register more targets at runtime (lazy packs). Their weight starts at 0; duplicate ids or out-of-range indices throw and add nothing. */
  addTargets(more: Iterable<MorphTarget>): void {
    const list = [...more];
    const seen = new Set<string>();
    for (const t of list) {
      if (this.targets.has(t.id) || seen.has(t.id)) throw new Error(`duplicate morph target "${t.id}"`);
      seen.add(t.id);
      if (t.indices.length && t.indices[t.indices.length - 1]! >= this.mv) throw new Error(`target "${t.id}" has a vertex index beyond the mesh`);
    }
    for (const t of list) this.targets.set(t.id, t);
  }
  get renderVertexCount(): number { return this.rv; }

  /** Move to the given target weights (absent = 0). Unknown target ids throw. */
  setWeights(next: ReadonlyMap<string, number> | Record<string, number>): UpdateStats {
    const want = next instanceof Map ? next : new Map(Object.entries(next));
    for (const id of want.keys()) if (!this.targets.has(id)) throw new UnknownTargetError(`unknown morph target "${id}"`);

    const changes: [string, number][] = [];
    for (const [id, w] of want) {
      const d = w - (this.applied.get(id) ?? 0);
      if (Math.abs(d) > WEIGHT_EPS) changes.push([id, d]);
    }
    for (const [id, w] of this.applied) if (!want.has(id) && Math.abs(w) > WEIGHT_EPS) changes.push([id, -w]);
    if (changes.length === 0) return { changedTargets: 0, dirtyVertices: 0, rebuilt: false };

    this.applied.clear();
    for (const [id, w] of want) if (Math.abs(w) > WEIGHT_EPS) this.applied.set(id, w);

    if (this.applied.size === 0 || ++this.incremental >= REBUILD_EVERY) {
      this.rebuildAll();
      return { changedTargets: changes.length, dirtyVertices: this.mv, rebuilt: true };
    }

    const dirty: number[] = [];
    for (const [id, d] of changes) {
      const t = this.targets.get(id)!;
      for (let i = 0; i < t.indices.length; i++) {
        const v = t.indices[i]!;
        this.morphPos[v * 3]! += t.deltas[i * 3]! * d;
        this.morphPos[v * 3 + 1]! += t.deltas[i * 3 + 1]! * d;
        this.morphPos[v * 3 + 2]! += t.deltas[i * 3 + 2]! * d;
        if (!this.dirtyFlag[v]) { this.dirtyFlag[v] = 1; dirty.push(v); }
      }
    }
    this.refresh(dirty);
    return { changedTargets: changes.length, dirtyVertices: dirty.length, rebuilt: false };
  }

  /** Discard incremental state and recompute everything from base + current weights (also used to bound drift). */
  rebuildAll(): void {
    this.morphPos.set(this.base);
    for (const [id, w] of this.applied) {
      const t = this.targets.get(id)!;
      for (let i = 0; i < t.indices.length; i++) {
        const v = t.indices[i]!;
        this.morphPos[v * 3]! += t.deltas[i * 3]! * w;
        this.morphPos[v * 3 + 1]! += t.deltas[i * 3 + 1]! * w;
        this.morphPos[v * 3 + 2]! += t.deltas[i * 3 + 2]! * w;
      }
    }
    this.incremental = 0;
    this.dirtyFlag.fill(0);
    for (let r = 0; r < this.rv; r++) {
      const m = this.renderToMorph[r]!;
      this.positions[r * 3] = this.morphPos[m * 3]!; this.positions[r * 3 + 1] = this.morphPos[m * 3 + 1]!; this.positions[r * 3 + 2] = this.morphPos[m * 3 + 2]!;
    }
    this.allNormals();
  }

  private refresh(dirty: number[]): void {
    for (const v of dirty) {
      this.dirtyFlag[v] = 0;
      for (let k = this.m2rStart[v]!; k < this.m2rStart[v + 1]!; k++) {
        const r = this.m2rList[k]!;
        this.positions[r * 3] = this.morphPos[v * 3]!; this.positions[r * 3 + 1] = this.morphPos[v * 3 + 1]!; this.positions[r * 3 + 2] = this.morphPos[v * 3 + 2]!;
      }
    }
    if (dirty.length > this.mv * FULL_NORMALS_FRACTION) { this.allNormals(); return; }

    const s = ++this.stamp;
    const faces: number[] = [];
    for (const v of dirty) {
      for (let k = this.vfStart[v]!; k < this.vfStart[v + 1]!; k++) {
        const f = this.vfList[k]!;
        if (this.faceStamp[f] !== s) { this.faceStamp[f] = s; faces.push(f); this.faceNormal(f); }
      }
    }
    const verts: number[] = [];
    for (const f of faces) for (let k = 0; k < 3; k++) {
      const v = this.tri[f * 3 + k]!;
      if (this.vertStamp[v] !== s) { this.vertStamp[v] = s; verts.push(v); }
    }
    for (const v of verts) this.vertexNormal(v);
  }

  private faceNormal(f: number): void {
    const a = this.tri[f * 3]! * 3, b = this.tri[f * 3 + 1]! * 3, c = this.tri[f * 3 + 2]! * 3;
    const p = this.morphPos;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    this.faceNormals[f * 3] = uy * vz - uz * vy;
    this.faceNormals[f * 3 + 1] = uz * vx - ux * vz;
    this.faceNormals[f * 3 + 2] = ux * vy - uy * vx;
  }

  private vertexNormal(v: number): void {
    let x = 0, y = 0, z = 0;
    for (let k = this.vfStart[v]!; k < this.vfStart[v + 1]!; k++) {
      const f = this.vfList[k]!;
      x += this.faceNormals[f * 3]!; y += this.faceNormals[f * 3 + 1]!; z += this.faceNormals[f * 3 + 2]!;
    }
    const len = Math.hypot(x, y, z);
    if (len > 0) { x /= len; y /= len; z /= len; } else { x = 0; y = 1; z = 0; }
    this.morphNormals[v * 3] = x; this.morphNormals[v * 3 + 1] = y; this.morphNormals[v * 3 + 2] = z;
    for (let k = this.m2rStart[v]!; k < this.m2rStart[v + 1]!; k++) {
      const r = this.m2rList[k]!;
      this.normals[r * 3] = x; this.normals[r * 3 + 1] = y; this.normals[r * 3 + 2] = z;
    }
  }

  private allNormals(): void {
    const tc = this.tri.length / 3;
    for (let f = 0; f < tc; f++) this.faceNormal(f);
    for (let v = 0; v < this.mv; v++) this.vertexNormal(v);
  }
}
