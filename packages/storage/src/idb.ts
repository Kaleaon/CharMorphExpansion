import { buildRecord, byNewest, MemoryStore, type CharacterStore, type NewCharacter, type SavedCharacter } from "./store.ts";

const DB_NAME = "charmorph-designer";
const STORE = "characters";

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed")); });
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed")); tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted")); });

export class IdbStore implements CharacterStore {
  readonly persistent = true;
  private constructor(private readonly db: IDBDatabase, private readonly clock: () => number) {}

  static open(factory: IDBFactory, clock: () => number = Date.now, name = DB_NAME): Promise<IdbStore> {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(new IdbStore(req.result, clock));
      req.onerror = () => reject(req.error ?? new Error("could not open IndexedDB"));
      req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
    });
  }

  async list(): Promise<SavedCharacter[]> {
    const all = await wrap(this.db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<SavedCharacter[]>);
    return all.sort(byNewest);
  }
  async get(id: string): Promise<SavedCharacter | undefined> {
    return (await wrap(this.db.transaction(STORE).objectStore(STORE).get(id) as IDBRequest<SavedCharacter | undefined>)) ?? undefined;
  }
  async put(input: NewCharacter): Promise<SavedCharacter> {
    const tx = this.db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const existing = input.id ? ((await wrap(os.get(input.id) as IDBRequest<SavedCharacter | undefined>)) ?? undefined) : undefined;
    const rec = buildRecord(input, existing, this.clock());
    os.put(rec);
    await done(tx);
    return rec;
  }
  async delete(id: string): Promise<void> {
    const tx = this.db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}

/** Use IndexedDB if it works (it can be missing or blocked in private windows), otherwise fall back to memory. */
export async function openCharacterStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<CharacterStore> {
  if (!factory) return new MemoryStore();
  try { return await IdbStore.open(factory); } catch { return new MemoryStore(); }
}
