import type { CharacterModel, Preset, SpecFragment } from "@charmorph/core";
import type { MorphWorkerClient, TargetPackMeta } from "@charmorph/morph";

/** `pack.json` of a lazily loaded pack. */
export interface PackInfo {
  format: "cm-pack/1";
  id: string;
  label: string;
  description: string;
  /** Name of the base mesh the targets were authored for. */
  mesh: string;
  morphVertexCount: number;
  /** Download size of all pack files. */
  bytes: number;
  sliderCount: number;
  sections: string[];
  files: { targetsMeta: string; targetsBin: string; fragment: string };
}

/** Where pack files come from: fetch() in the app, the file system in tests. */
export interface PackSource {
  list(): PackInfo[];
  readJson(packId: string, file: string): Promise<unknown>;
  readBin(packId: string, file: string): Promise<ArrayBuffer>;
}

export type PackState = "idle" | "loading" | "ready" | "error";

export interface PackManagerOptions {
  model: CharacterModel;
  worker: Pick<MorphWorkerClient, "addTargets">;
  source: PackSource;
  mesh: { name: string; morphVertexCount: number };
}

export class PackError extends Error {}

/**
 * Loads optional packs on demand: fetch → validate → give the targets to the worker → extend the slider model.
 * Concurrent requests for one pack share a single load; a failed load leaves model and worker untouched and can be retried.
 */
export class PackManager {
  private readonly states = new Map<string, { state: PackState; error?: string }>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly infos: Map<string, PackInfo>;

  constructor(private readonly o: PackManagerOptions) {
    this.infos = new Map(o.source.list().map((p) => [p.id, p]));
  }

  get available(): PackInfo[] { return [...this.infos.values()]; }
  info(id: string): PackInfo | undefined { return this.infos.get(id); }
  state(id: string): { state: PackState; error?: string } { return this.states.get(id) ?? { state: this.o.model.hasPack(id) ? "ready" : "idle" }; }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  private set(id: string, state: PackState, error?: string): void {
    this.states.set(id, error === undefined ? { state } : { state, error });
    for (const l of this.listeners) l();
  }

  ensure(id: string): Promise<void> {
    if (this.o.model.hasPack(id)) return Promise.resolve();
    const running = this.inflight.get(id);
    if (running) return running;
    const info = this.infos.get(id);
    if (!info) return Promise.reject(new PackError(`unknown pack "${id}"`));
    this.set(id, "loading");
    const p = this.load(info).then(
      () => { this.inflight.delete(id); this.set(id, "ready"); },
      (e: unknown) => { this.inflight.delete(id); this.set(id, "error", (e as Error).message); throw e; },
    );
    this.inflight.set(id, p);
    return p;
  }

  ensureAll(ids: Iterable<string>): Promise<void[]> { return Promise.all([...ids].map((i) => this.ensure(i))); }

  private async load(info: PackInfo): Promise<void> {
    if (info.mesh !== this.o.mesh.name || info.morphVertexCount !== this.o.mesh.morphVertexCount) {
      throw new PackError(`pack "${info.id}" was made for mesh "${info.mesh}" (${info.morphVertexCount} vertices), not "${this.o.mesh.name}" (${this.o.mesh.morphVertexCount})`);
    }
    const [targetMeta, targetBin, fragment] = await Promise.all([
      this.o.source.readJson(info.id, info.files.targetsMeta) as Promise<TargetPackMeta>,
      this.o.source.readBin(info.id, info.files.targetsBin),
      this.o.source.readJson(info.id, info.files.fragment) as Promise<SpecFragment>,
    ]);
    if (targetMeta?.format !== "cm-targets/1") throw new PackError(`pack "${info.id}": unsupported target format`);
    if (fragment?.pack !== info.id) throw new PackError(`pack "${info.id}": fragment belongs to "${String(fragment?.pack)}"`);
    const ids = targetMeta.targets.map((t) => t.id);
    this.o.model.checkExtend(fragment, ids); // fail before touching the worker
    await this.o.worker.addTargets(targetMeta, targetBin);
    this.o.model.extend(fragment, ids);
  }

  /** Load whatever packs a preset needs, then apply it. Returns the ids that still could not be applied. */
  async applyPreset(preset: Preset): Promise<string[]> {
    await this.ensureAll(preset.packs ?? []);
    return this.o.model.applyPreset(preset);
  }
}
