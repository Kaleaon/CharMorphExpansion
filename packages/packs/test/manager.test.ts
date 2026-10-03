import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CharacterModel, parsePreset, type CharacterSpec } from "../../core/src/index.ts";
import { createWorkerHandler, MorphWorkerClient, type FromWorker, type MeshPackMeta, type MorphFrame, type TargetPackMeta, type ToWorker, type WorkerLike } from "../../morph/src/index.ts";
import { PackManager, type PackInfo, type PackSource } from "../src/manager.ts";

const assets = new URL("../../../assets/", import.meta.url);
const file = (dir: string, f: string) => readFileSync(new URL(`${dir}/${f}`, assets));
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const fsSource = (over: Partial<PackSource> = {}): PackSource & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    list: () => readdirSync(assets).filter((d) => d.startsWith("makehuman-hm08-")).map((d) => JSON.parse(file(d, "pack.json").toString()) as PackInfo),
    readJson: async (id, f) => { reads.push(`${id}/${f}`); return JSON.parse(file(`makehuman-hm08-${id}`, f).toString()); },
    readBin: async (id, f) => { reads.push(`${id}/${f}`); return ab(file(`makehuman-hm08-${id}`, f)); },
    ...over,
  };
};

function pipeline(source: PackSource = fsSource()) {
  const spec = JSON.parse(file("makehuman-hm08", "spec.json").toString()) as CharacterSpec;
  const targetMeta = JSON.parse(file("makehuman-hm08", "targets.json").toString()) as TargetPackMeta;
  const meshMeta = JSON.parse(file("makehuman-hm08", "mesh.json").toString()) as MeshPackMeta;
  const model = new CharacterModel(spec, new Set(targetMeta.targets.map((t) => t.id)));

  const w: WorkerLike = {
    onmessage: null,
    postMessage(msg: ToWorker) { queueMicrotask(() => handler(msg)); },
  };
  const handler = createWorkerHandler((reply: FromWorker) => w.onmessage?.({ data: reply }));
  const worker = new MorphWorkerClient(w);
  const frames: MorphFrame[] = [];
  worker.onFrame = (f) => frames.push({ ...f, positions: Float32Array.from(f.positions), normals: Float32Array.from(f.normals) });
  worker.init(meshMeta, ab(file("makehuman-hm08", "mesh.bin")), targetMeta, ab(file("makehuman-hm08", "targets.bin")));
  const packs = new PackManager({ model, worker, source, mesh: { name: meshMeta.name, morphVertexCount: meshMeta.morphVertexCount } });
  const render = async () => {
    const n = frames.length;
    worker.setWeights(model.weights());
    for (let i = 0; i < 200 && frames.length === n; i++) await new Promise((r) => setTimeout(r, 1));
    return frames[frames.length - 1]!;
  };
  return { model, worker, packs, render, ready: worker.ready };
}

const rand = (seed: number) => { let s = seed; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; };

describe("PackManager", () => {
  it("finds the three lazy packs and reports their sizes", () => {
    const { packs } = pipeline();
    expect(packs.available.map((p) => p.id).sort()).toEqual(["age", "body", "face"]);
    for (const p of packs.available) { expect(p.bytes).toBeGreaterThan(10_000); expect(p.sections.length + p.sliderCount).toBeGreaterThan(0); }
    expect(packs.state("face").state).toBe("idle");
  });

  it("loads a pack on demand: adds its sliders, keeps existing values, notifies listeners", async () => {
    const src = fsSource();
    const { model, packs, ready } = pipeline(src);
    await ready;
    expect(src.reads).toEqual([]); // nothing fetched until asked
    model.set("gender", 0.2);
    const states: string[] = [];
    packs.onChange(() => states.push(packs.state("face").state));
    const before = model.ids.length;
    await packs.ensure("face");
    expect(model.hasPack("face")).toBe(true);
    expect(model.ids.length).toBe(before + packs.info("face")!.sliderCount);
    expect(model.get("gender")).toBe(0.2);
    expect(model.has("eye-bag")).toBe(true);
    expect(states).toEqual(["loading", "ready"]);
    expect(src.reads.every((r) => r.startsWith("face/"))).toBe(true);
  });

  it("de-duplicates concurrent loads and is a no-op once loaded", async () => {
    const src = fsSource();
    const { packs, ready } = pipeline(src);
    await ready;
    await Promise.all([packs.ensure("body"), packs.ensure("body"), packs.ensure("body")]);
    expect(src.reads.filter((r) => r.endsWith("targets.bin"))).toHaveLength(1);
    await packs.ensure("body");
    expect(src.reads.filter((r) => r.endsWith("targets.bin"))).toHaveLength(1);
  });

  it("age pack widens the macros without changing the default look", async () => {
    const { model, packs, render, ready } = pipeline();
    await ready;
    model.set("gender", 0.7); model.set("weight", 0.3);
    const before = await render();
    await packs.ensure("age");
    expect(model.has("age")).toBe(true);
    expect(model.get("age")).toBe(0.5);
    const after = await render();
    let d = 0; for (let i = 0; i < before.positions.length; i++) d = Math.max(d, Math.abs(before.positions[i]! - after.positions[i]!));
    expect(d).toBeLessThan(1e-5);
    // and age actually moves the body: a baby is much smaller than the young adult
    const height = (f: MorphFrame) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < f.positions.length; i += 3) { lo = Math.min(lo, f.positions[i]!); hi = Math.max(hi, f.positions[i]!); } return hi - lo; };
    const adult = height(after);
    model.set("age", 0);
    expect(height(await render())).toBeLessThan(adult * 0.6);
    model.set("age", 1);
    expect(height(await render())).toBeLessThan(adult); // the old-age targets shorten the body
  });

  it("fails cleanly and can be retried; wrong-mesh packs are refused", async () => {
    let broken = true;
    const base = fsSource();
    const src: PackSource = { ...base, readBin: async (id, f) => { if (broken && id === "face") throw new Error("network down"); return base.readBin(id, f); } };
    const { model, packs, ready } = pipeline(src);
    await ready;
    await expect(packs.ensure("face")).rejects.toThrow(/network down/);
    expect(packs.state("face")).toEqual({ state: "error", error: "network down" });
    expect(model.hasPack("face")).toBe(false);
    broken = false;
    await packs.ensure("face");
    expect(packs.state("face").state).toBe("ready");

    const wrongMesh: PackSource = { ...base, list: () => base.list().map((p) => ({ ...p, morphVertexCount: 5 })) };
    const p2 = pipeline(wrongMesh);
    await p2.ready;
    await expect(p2.packs.ensure("age")).rejects.toThrow(/was made for mesh/);
    await expect(p2.packs.ensure("nope")).rejects.toThrow(/unknown pack/);
  });
});

describe("full slider set round-trips through save / load", () => {
  it("every slider of every pack survives preset JSON and reproduces the exact same body", async () => {
    const a = pipeline();
    await a.ready;
    await a.packs.ensureAll(["age", "face", "body"]);
    const r = rand(42);
    for (const id of a.model.ids) {
      if (id.startsWith("ethnicity.")) continue; // simplex components renormalize; set separately below
      a.model.set(id, a.model.getDefault(id) + (r() * 2 - 1) * 0.9);
    }
    a.model.set("ethnicity.african", 0.6); a.model.set("ethnicity.asian", 0.1);
    const ids = a.model.ids;
    expect(ids.length).toBeGreaterThan(170);
    const frameA = await a.render();

    const json = JSON.stringify(a.model.toPreset("everything"));
    const preset = parsePreset(JSON.parse(json));
    expect(preset.packs).toEqual(["age", "body", "face"]);

    // Fresh app, nothing loaded: applying the preset loads the packs it needs.
    const b = pipeline();
    await b.ready;
    expect(b.model.ids.length).toBeLessThan(40);
    expect(await b.packs.applyPreset(preset)).toEqual([]);
    for (const id of ids) expect(b.model.get(id)).toBeCloseTo(a.model.get(id), 12);
    const frameB = await b.render();
    expect(frameB.positions).toEqual(frameA.positions);
    expect(frameB.normals).toEqual(frameA.normals);
  });

  it("a preset that only needs one pack loads only that pack", async () => {
    const a = pipeline();
    await a.ready;
    await a.packs.ensure("face");
    a.model.set("eye-bag", 0.7);
    const preset = a.model.toPreset("eyes");
    expect(preset.packs).toEqual(["face"]);
    const src = fsSource();
    const b = pipeline(src);
    await b.ready;
    await b.packs.applyPreset(preset);
    expect(b.model.hasPack("face")).toBe(true);
    expect(b.model.hasPack("age")).toBe(false);
    expect(src.reads.every((x) => x.startsWith("face/"))).toBe(true);
  });
});
