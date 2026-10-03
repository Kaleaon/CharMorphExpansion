import { CharacterModel, parsePreset, type CharacterSpec } from "@charmorph/core";
import { createBrowserMorphWorker, decodeMeshPack, MorphWorkerClient, type MeshPackMeta, type MorphFrame, type TargetPackMeta } from "@charmorph/morph";
import { MorphMeshView } from "@charmorph/render";
import { useCallback, useEffect, useRef, useState } from "react";
import meshBinUrl from "../../../../assets/makehuman-hm08/mesh.bin?url";
import meshJsonUrl from "../../../../assets/makehuman-hm08/mesh.json?url";
import specUrl from "../../../../assets/makehuman-hm08/spec.json?url";
import targetsBinUrl from "../../../../assets/makehuman-hm08/targets.bin?url";
import targetsJsonUrl from "../../../../assets/makehuman-hm08/targets.json?url";

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
  stats: MorphStats;
  /** Bumps whenever the model changed, to re-render sliders. */
  version: number;
  set: (id: string, v: number) => void;
  reset: () => void;
  savePreset: (name: string) => string;
  loadPreset: (json: string) => string[];
}

const fetchJson = async <T,>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;
const fetchBin = async (url: string): Promise<ArrayBuffer> => (await fetch(url)).arrayBuffer();

declare global {
  interface Window { __character?: { model: CharacterModel; worker: MorphWorkerClient; stats: () => MorphStats } }
}

/** Loads the pack, owns the worker, and keeps the view in sync with the slider model. */
export function useCharacter(): Character {
  const [status, setStatus] = useState<Character["status"]>("loading");
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const modelRef = useRef<CharacterModel | null>(null);
  const viewRef = useRef<MorphMeshView | null>(null);
  const workerRef = useRef<MorphWorkerClient | null>(null);
  const sentAt = useRef(0);
  const stats = useRef<MorphStats>({ latencyMs: 0, frames: 0 });

  useEffect(() => {
    let cancelled = false;
    let client: MorphWorkerClient | null = null;
    (async () => {
      try {
        const [meshMeta, meshBin, targetMeta, targetBin, spec] = await Promise.all([
          fetchJson<MeshPackMeta>(meshJsonUrl), fetchBin(meshBinUrl), fetchJson<TargetPackMeta>(targetsJsonUrl), fetchBin(targetsBinUrl), fetchJson<CharacterSpec>(specUrl),
        ]);
        if (cancelled) return;
        const model = new CharacterModel(spec, new Set(targetMeta.targets.map((t) => t.id)));
        const view = new MorphMeshView(decodeMeshPack(meshMeta, meshBin.slice(0)));
        client = new MorphWorkerClient(createBrowserMorphWorker());
        client.onFrame = (f: MorphFrame) => {
          view.applyFrame(f.positions, f.normals);
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
        modelRef.current = model;
        viewRef.current = view;
        workerRef.current = client;
        window.__character = { model, worker: client, stats: () => stats.current };
        sentAt.current = performance.now();
        client.setWeights(model.weights());
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setStatus("error"); }
      }
    })();
    return () => {
      cancelled = true;
      client?.terminate();
      viewRef.current?.dispose();
      modelRef.current = null; viewRef.current = null; workerRef.current = null;
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
    model: modelRef.current, view: viewRef.current,
    get stats() { return stats.current; },
    version,
    set: (id, v) => { modelRef.current?.set(id, v); push(); },
    reset: () => { modelRef.current?.reset(); push(); },
    savePreset: (name) => JSON.stringify(modelRef.current!.toPreset(name), null, 2),
    loadPreset: (json) => { const unknown = modelRef.current!.applyPreset(parsePreset(JSON.parse(json))); push(); return unknown; },
  };
}
