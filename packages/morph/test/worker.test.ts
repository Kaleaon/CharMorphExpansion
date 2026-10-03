import { describe, expect, it } from "vitest";
import { MorphEngine } from "../src/engine.ts";
import { encodeMeshPack, encodeTargetPack } from "../src/pack.ts";
import { createWorkerHandler, MorphWorkerClient, type FromWorker, type MorphFrame, type ToWorker, type WorkerLike } from "../src/worker.ts";
import { gridMesh, randomTarget, rng } from "./helpers.ts";

const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** In-process stand-in for a Worker: runs the real handler asynchronously, like a message hop would. */
function loopback() {
  const log: ToWorker[] = [];
  const w: WorkerLike & { replies: number } = {
    onmessage: null,
    replies: 0,
    postMessage(msg) {
      log.push(msg);
      queueMicrotask(() => queueMicrotask(() => handler(msg)));
    },
  };
  const handler = createWorkerHandler((reply: FromWorker) => { w.replies++; w.onmessage?.({ data: reply }); });
  return { w, log };
}

function fixture() {
  const mesh = gridMesh(8);
  const mv = mesh.positions.length / 3;
  const r = rng(3);
  const targets = [randomTarget("a", mv, 0.5, 0.2, r), randomTarget("b", mv, 0.5, 0.2, r)];
  const mp = encodeMeshPack(mesh);
  const tp = encodeTargetPack(targets, mv);
  return { mesh, targets, mp, tp };
}
const settle = async (c: MorphWorkerClient) => { for (let i = 0; i < 50 && c.busy; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("MorphWorkerClient", () => {
  it("initialises and returns frames equal to a direct engine evaluation", async () => {
    const { mesh, targets, mp, tp } = fixture();
    const { w } = loopback();
    const c = new MorphWorkerClient(w);
    const frames: MorphFrame[] = [];
    c.onFrame = (f) => frames.push(f);
    c.init(mp.meta, ab(mp.bin), tp.meta, ab(tp.bin));
    await c.ready;
    expect(c.targetIds).toEqual(["a", "b"]);
    c.setWeights(new Map([["a", 0.7]]));
    await settle(c);
    const direct = new MorphEngine(mesh, targets.map((t) => ({ ...t })));
    direct.setWeights({ a: 0.7 });
    expect(frames).toHaveLength(1);
    // the worker decodes quantized targets, so allow the quantization error
    let m = 0; for (let i = 0; i < direct.positions.length; i++) m = Math.max(m, Math.abs(direct.positions[i]! - frames[0]!.positions[i]!));
    expect(m).toBeLessThan(1e-4);
  });

  it("coalesces rapid requests: only the newest weights are sent while one is in flight", async () => {
    const { mp, tp } = fixture();
    const { w, log } = loopback();
    const c = new MorphWorkerClient(w);
    const seen: number[] = [];
    c.onFrame = (f) => seen.push(f.seq);
    c.init(mp.meta, ab(mp.bin), tp.meta, ab(tp.bin));
    await c.ready;
    for (let i = 1; i <= 20; i++) c.setWeights(new Map([["a", i / 20]]));
    await settle(c);
    const sent = log.filter((m) => m.type === "weights") as Extract<ToWorker, { type: "weights" }>[];
    expect(sent.length).toBe(2); // first request, then only the latest
    expect(sent[1]!.weights).toEqual([["a", 1]]);
    expect(seen).toEqual([1, 2]);
  });

  it("recycles released buffers and reports errors without wedging the queue", async () => {
    const { mp, tp } = fixture();
    const { w } = loopback();
    const c = new MorphWorkerClient(w);
    const frames: MorphFrame[] = [];
    const errors: string[] = [];
    c.onFrame = (f) => { frames.push(f); c.release(f); };
    c.onError = (m) => errors.push(m);
    c.init(mp.meta, ab(mp.bin), tp.meta, ab(tp.bin));
    await c.ready;
    c.setWeights(new Map([["nope", 1]]));
    await settle(c);
    expect(errors[0]).toMatch(/unknown morph target/);
    c.setWeights(new Map([["a", 0.5]]));
    await settle(c);
    expect(frames).toHaveLength(1);
  });

  it("adds targets after init: resolves when ready, later weights can use them, failures reject", async () => {
    const mesh = gridMesh(8);
    const mv = mesh.positions.length / 3;
    const r = rng(5);
    const first = [randomTarget("a", mv, 0.5, 0.2, r)];
    const second = [randomTarget("late", mv, 0.5, 0.2, r)];
    const mp = encodeMeshPack(mesh);
    const tp1 = encodeTargetPack(first, mv);
    const tp2 = encodeTargetPack(second, mv);
    const { w } = loopback();
    const c = new MorphWorkerClient(w);
    const frames: MorphFrame[] = [];
    const errors: string[] = [];
    c.onFrame = (f) => frames.push(f);
    c.onError = (m) => errors.push(m);
    c.init(mp.meta, ab(mp.bin), tp1.meta, ab(tp1.bin));
    await c.ready;
    c.setWeights(new Map([["late", 1]]));
    await settle(c);
    expect(errors[0]).toMatch(/unknown morph target/); // not there yet
    await c.addTargets(tp2.meta, ab(tp2.bin));
    expect(c.targetIds.sort()).toEqual(["a", "late"]);
    c.setWeights(new Map([["late", 1]]));
    await settle(c);
    expect(frames).toHaveLength(1);
    await expect(c.addTargets(tp2.meta, ab(tp2.bin))).rejects.toThrow(/duplicate/);
  });
});
