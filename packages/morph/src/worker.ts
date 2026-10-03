import { MorphEngine, type UpdateStats } from "./engine.ts";
import { decodeMeshPack, decodeTargetPack, type MeshPackMeta, type TargetPackMeta } from "./pack.ts";

export type ToWorker =
  | { type: "init"; meshMeta: MeshPackMeta; meshBin: ArrayBuffer; targetMeta: TargetPackMeta; targetBin: ArrayBuffer }
  | { type: "weights"; seq: number; weights: [string, number][]; recycle?: { positions: Float32Array; normals: Float32Array } };

export type FromWorker =
  | { type: "ready"; targetIds: string[] }
  | { type: "frame"; seq: number; positions: Float32Array; normals: Float32Array; stats: UpdateStats }
  | { type: "error"; seq?: number; message: string };

export interface MorphFrame {
  seq: number;
  positions: Float32Array;
  normals: Float32Array;
  stats: UpdateStats;
}

/** The worker-side message handler, independent of any Worker global so it can be tested in-process. */
export function createWorkerHandler(post: (msg: FromWorker, transfer: Transferable[]) => void): (msg: ToWorker) => void {
  let engine: MorphEngine | null = null;
  const pool: { positions: Float32Array; normals: Float32Array }[] = [];
  return (msg) => {
    try {
      if (msg.type === "init") {
        engine = new MorphEngine(decodeMeshPack(msg.meshMeta, msg.meshBin), decodeTargetPack(msg.targetMeta, msg.targetBin));
        post({ type: "ready", targetIds: engine.targetIds }, []);
      } else if (msg.type === "weights") {
        if (!engine) throw new Error("worker not initialised");
        if (msg.recycle) pool.push(msg.recycle);
        let stats: UpdateStats;
        try { stats = engine.setWeights(new Map(msg.weights)); } catch (e) { post({ type: "error", seq: msg.seq, message: (e as Error).message }, []); return; }
        const out = pool.pop() ?? { positions: new Float32Array(engine.positions.length), normals: new Float32Array(engine.normals.length) };
        out.positions.set(engine.positions);
        out.normals.set(engine.normals);
        post({ type: "frame", seq: msg.seq, positions: out.positions, normals: out.normals, stats }, [out.positions.buffer, out.normals.buffer]);
      }
    } catch (e) {
      post({ type: "error", message: (e as Error).message }, []);
    }
  };
}

/** Minimal Worker-like surface so tests can inject a loopback. */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate?(): void;
}

/**
 * Main-thread client. Keeps at most one request in flight; while busy, only the newest weights are remembered, so dragging
 * a slider never builds a queue (latest wins).
 */
export class MorphWorkerClient {
  onFrame: ((f: MorphFrame) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  targetIds: string[] = [];
  private seq = 0;
  private inFlight = false;
  private pending: [string, number][] | null = null;
  private recycle: { positions: Float32Array; normals: Float32Array } | undefined;
  private readyResolve!: () => void;
  readonly ready = new Promise<void>((r) => { this.readyResolve = r; });

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = (e) => this.handle(e.data);
  }

  init(meshMeta: MeshPackMeta, meshBin: ArrayBuffer, targetMeta: TargetPackMeta, targetBin: ArrayBuffer): void {
    this.worker.postMessage({ type: "init", meshMeta, meshBin, targetMeta, targetBin }, [meshBin, targetBin]);
  }

  setWeights(weights: ReadonlyMap<string, number>): void {
    this.pending = [...weights];
    if (!this.inFlight) this.send();
  }

  /** Hand a consumed frame's buffers back so the worker can reuse them instead of allocating. */
  release(frame: MorphFrame): void { this.recycle = { positions: frame.positions, normals: frame.normals }; }

  get busy(): boolean { return this.inFlight || this.pending !== null; }

  terminate(): void { this.worker.terminate?.(); }

  private send(): void {
    const weights = this.pending!;
    this.pending = null;
    this.inFlight = true;
    const recycle = this.recycle;
    this.recycle = undefined;
    this.worker.postMessage({ type: "weights", seq: ++this.seq, weights, recycle }, recycle ? [recycle.positions.buffer, recycle.normals.buffer] : []);
  }

  private handle(msg: FromWorker): void {
    if (msg.type === "ready") { this.targetIds = msg.targetIds; this.readyResolve(); return; }
    if (msg.type === "error") { this.inFlight = false; this.onError?.(msg.message); if (this.pending) this.send(); return; }
    this.inFlight = false;
    this.onFrame?.({ seq: msg.seq, positions: msg.positions, normals: msg.normals, stats: msg.stats });
    if (this.pending) this.send();
  }
}

/** Create the real browser worker. Call only in a browser. */
export function createBrowserMorphWorker(): WorkerLike {
  return new Worker(new URL("./worker.entry.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}
