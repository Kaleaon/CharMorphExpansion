import { CharacterModel, parsePreset, type CharacterSpec } from "@charmorph/core";
import { createBrowserMorphWorker, decodeMeshPack, MorphWorkerClient, type MeshPackMeta, type MorphFrame, type MorphMesh, type TargetPackMeta } from "@charmorph/morph";
import { PackManager } from "@charmorph/packs";
import { BodyRig, decodeRig, type RigMeta } from "@charmorph/rig";
import { MorphMeshView } from "@charmorph/render";
import { SL_SKELETON_DATA } from "@charmorph/skeleton";
import { openCharacterStore, type CharacterStore } from "@charmorph/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import meshBinUrl from "../../../../assets/makehuman-hm08/mesh.bin?url";
import meshJsonUrl from "../../../../assets/makehuman-hm08/mesh.json?url";
import rigBinUrl from "../../../../assets/makehuman-hm08/rig.bin?url";
import rigJsonUrl from "../../../../assets/makehuman-hm08/rig.json?url";
import specUrl from "../../../../assets/makehuman-hm08/spec.json?url";
import targetsBinUrl from "../../../../assets/makehuman-hm08/targets.bin?url";
import targetsJsonUrl from "../../../../assets/makehuman-hm08/targets.json?url";
import { appPackSource } from "./packSource.ts";

export interface MorphStats {
  /** Round trip main → worker → main, ms (smoothed). */
  latencyMs: number;
  frames: number;
}

export interface Character {
  status: "loading" | "ready" | "error";
  error?: string;
  model: CharacterModel | null;
  view: MorphMeshView | null;
  packs: PackManager | null;
  store: CharacterStore | null;
  stats: MorphStats;
  /** The MakeHuman body as a Second Life rigged mesh (null until loaded). */
  rig: BodyRig | null;
  mesh: MorphMesh | null;
  /**
   * Route every morph frame through `fn` before it reaches the display; `fn` returns the positions/normals to show, or null to
   * show the frame unchanged. Passing null restores the plain view. Re-applies the latest frame immediately.
   */
  setFrameProcessor: (fn: ((f: MorphFrame) => { positions: Float32Array; normals: Float32Array } | null) | null) => void;
  /** The latest morph frame (positions of the shown character, before any SL processing), or null before the first. */
  latestFrame: () => MorphFrame | null;
  /** Bumps whenever the model or a pack changed, to re-render sliders. */
  version: number;
  set: (id: string, v: number) => void;
  reset: () => void;
  ensurePack: (id: string) => Promise<void>;
  savePreset: (name: string) => string;
  /** Loads any packs the preset needs, then applies it. Returns ids that could not be applied. */
  loadPreset: (json: string) => Promise<string[]>;
}

const fetchJson = async <T,>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;
const fetchBin = async (url: string): Promise<ArrayBuffer> => (await fetch(url)).arrayBuffer();

declare global {
  interface Window { __character?: { model: CharacterModel; worker: MorphWorkerClient; packs: PackManager; stats: () => MorphStats } }
}

/** Loads the core pack, owns the worker, the lazy-pack manager and the library, and keeps the view in sync with the slider model. */
export function useCharacter(): Character {
  const [status, setStatus] = useState<Character["status"]>("loading");
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const modelRef = useRef<CharacterModel | null>(null);
  const viewRef = useRef<MorphMeshView | null>(null);
  const workerRef = useRef<MorphWorkerClient | null>(null);
  const packsRef = useRef<PackManager | null>(null);
  const storeRef = useRef<CharacterStore | null>(null);
  const rigRef = useRef<BodyRig | null>(null);
  const meshRef = useRef<MorphMesh | null>(null);
  const processorRef = useRef<((f: MorphFrame) => { positions: Float32Array; normals: Float32Array } | null) | null>(null);
  const lastRaw = useRef<MorphFrame | null>(null);
  const sentAt = useRef(0);
  const stats = useRef<MorphStats>({ latencyMs: 0, frames: 0 });

  useEffect(() => {
    let cancelled = false;
    let client: MorphWorkerClient | null = null;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const [meshMeta, meshBin, targetMeta, targetBin, spec, rigMeta, rigBin, store] = await Promise.all([
          fetchJson<MeshPackMeta>(meshJsonUrl), fetchBin(meshBinUrl), fetchJson<TargetPackMeta>(targetsJsonUrl), fetchBin(targetsBinUrl), fetchJson<CharacterSpec>(specUrl),
          fetchJson<RigMeta>(rigJsonUrl), fetchBin(rigBinUrl),
          openCharacterStore(),
        ]);
        if (cancelled) return;
        const model = new CharacterModel(spec, new Set(targetMeta.targets.map((t) => t.id)));
        const mesh = decodeMeshPack(meshMeta, meshBin.slice(0));
        const view = new MorphMeshView(mesh);
        rigRef.current = new BodyRig(rigMeta, decodeRig(rigMeta, rigBin), mesh.renderToMorph, SL_SKELETON_DATA);
        meshRef.current = mesh;
        client = new MorphWorkerClient(createBrowserMorphWorker());
        client.onFrame = (f: MorphFrame) => {
          lastRaw.current = { ...f, positions: Float32Array.from(f.positions), normals: Float32Array.from(f.normals), helpers: Float32Array.from(f.helpers) };
          const shown = processorRef.current?.(f) ?? null;
          if (shown) view.applyFrame(shown.positions, shown.normals);
          else view.applyFrame(f.positions, f.normals);
          client!.release(f);
          const dt = performance.now() - sentAt.current;
          const s = stats.current;
          stats.current = { latencyMs: s.frames ? s.latencyMs * 0.8 + dt * 0.2 : dt, frames: s.frames + 1 };
          window.dispatchEvent(new Event("cm-frame"));
        };
        client.onError = (m) => { setError(m); setStatus("error"); };
        client.init(meshMeta, meshBin, targetMeta, targetBin);
        await client.ready;
        if (cancelled) return;
        const packs = new PackManager({ model, worker: client, source: appPackSource, mesh: { name: meshMeta.name, morphVertexCount: meshMeta.morphVertexCount } });
        unsub = packs.onChange(() => setVersion((v) => v + 1));
        modelRef.current = model; viewRef.current = view; workerRef.current = client; packsRef.current = packs; storeRef.current = store;
        window.__character = { model, worker: client, packs, stats: () => stats.current };
        sentAt.current = performance.now();
        client.setWeights(model.weights());
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setStatus("error"); }
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
      client?.terminate();
      viewRef.current?.dispose();
      modelRef.current = null; viewRef.current = null; workerRef.current = null; packsRef.current = null; storeRef.current = null;
      rigRef.current = null; meshRef.current = null; processorRef.current = null; lastRaw.current = null;
      window.__character = undefined;
    };
  }, []);

  const push = useCallback(() => {
    const m = modelRef.current, w = workerRef.current;
    if (!m || !w) return;
    sentAt.current = performance.now();
    w.setWeights(m.weights());
    setVersion((v) => v + 1);
  }, []);

  return {
    status, error,
    model: modelRef.current, view: viewRef.current, packs: packsRef.current, store: storeRef.current,
    rig: rigRef.current, mesh: meshRef.current,
    setFrameProcessor: (fn) => {
      processorRef.current = fn;
      const raw = lastRaw.current, view = viewRef.current;
      if (!raw || !view) return;
      const shown = fn?.(raw) ?? null;
      if (shown) view.applyFrame(shown.positions, shown.normals); else view.applyFrame(raw.positions, raw.normals);
      window.dispatchEvent(new Event("cm-frame"));
    },
    latestFrame: () => lastRaw.current,
    get stats() { return stats.current; },
    version,
    set: (id, v) => { modelRef.current?.set(id, v); push(); },
    reset: () => { modelRef.current?.reset(); push(); },
    ensurePack: async (id) => { await packsRef.current!.ensure(id); push(); },
    savePreset: (name) => JSON.stringify(modelRef.current!.toPreset(name), null, 2),
    loadPreset: async (json) => {
      const unknown = await packsRef.current!.applyPreset(parsePreset(JSON.parse(json)));
      push();
      return unknown;
    },
  };
}
