import { parsePreset, type Preset } from "@charmorph/core";

/** A character saved in the local library. The preset holds every non-default slider plus the packs it needs. */
export interface SavedCharacter {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  preset: Preset;
  /** Small PNG/JPEG data URL, optional. */
  thumbnail?: string;
}

export interface NewCharacter {
  /** Pass an existing id to overwrite (keeps `createdAt`). */
  id?: string;
  name: string;
  preset: Preset;
  thumbnail?: string;
}

export interface CharacterStore {
  /** True if data survives a reload (IndexedDB); false for the in-memory fallback. */
  readonly persistent: boolean;
  /** Newest first. */
  list(): Promise<SavedCharacter[]>;
  get(id: string): Promise<SavedCharacter | undefined>;
  put(c: NewCharacter): Promise<SavedCharacter>;
  delete(id: string): Promise<void>;
}

export class StoreError extends Error {}

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Validate input and build the record to persist (shared by all stores). */
export function buildRecord(input: NewCharacter, existing: SavedCharacter | undefined, now: number): SavedCharacter {
  const name = input.name.trim();
  if (!name) throw new StoreError("a saved character needs a name");
  if (name.length > 120) throw new StoreError("name is too long (max 120 characters)");
  const preset = parsePreset(JSON.parse(JSON.stringify(input.preset))); // validates and detaches from caller's object
  const rec: SavedCharacter = { id: input.id ?? existing?.id ?? newId(), name, createdAt: existing?.createdAt ?? now, updatedAt: now, preset };
  const thumb = input.thumbnail ?? existing?.thumbnail;
  if (thumb) rec.thumbnail = thumb;
  return rec;
}

export const byNewest = (a: SavedCharacter, b: SavedCharacter): number => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1);

export class MemoryStore implements CharacterStore {
  readonly persistent = false;
  private readonly items = new Map<string, SavedCharacter>();
  constructor(private readonly clock: () => number = Date.now) {}
  async list() { return [...this.items.values()].map((c) => structuredClone(c)).sort(byNewest); }
  async get(id: string) { const c = this.items.get(id); return c ? structuredClone(c) : undefined; }
  async put(input: NewCharacter) {
    const rec = buildRecord(input, input.id ? this.items.get(input.id) : undefined, this.clock());
    this.items.set(rec.id, rec);
    return structuredClone(rec);
  }
  async delete(id: string) { this.items.delete(id); }
}
