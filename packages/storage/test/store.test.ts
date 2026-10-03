import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { Preset } from "@charmorph/core";
import { IdbStore, MemoryStore, openCharacterStore, StoreError, type CharacterStore } from "../src/index.ts";

const preset = (name = "p", values: Record<string, number> = { gender: 1 }, packs?: string[]): Preset => ({ format: "cm-preset/1", name, values, ...(packs ? { packs } : {}) });

let t = 1000;
const clock = () => ++t;

const stores: [string, () => Promise<CharacterStore>][] = [
  ["MemoryStore", async () => new MemoryStore(clock)],
  ["IdbStore (fake-indexeddb)", async () => IdbStore.open(new IDBFactory(), clock)],
];

describe.each(stores)("%s contract", (_name, make) => {
  it("saves, reads back and lists newest first", async () => {
    const s = await make();
    const a = await s.put({ name: "First", preset: preset("a") });
    const b = await s.put({ name: "Second", preset: preset("b", { weight: 0.2 }, ["face"]), thumbnail: "data:image/png;base64,AAAA" });
    expect(a.id).not.toBe(b.id);
    expect((await s.list()).map((c) => c.name)).toEqual(["Second", "First"]);
    const got = (await s.get(b.id))!;
    expect(got.preset).toEqual(preset("b", { weight: 0.2 }, ["face"]));
    expect(got.thumbnail).toBe("data:image/png;base64,AAAA");
    expect(await s.get("missing")).toBeUndefined();
  });

  it("overwrites by id keeping createdAt, bumping updatedAt and keeping the old thumbnail unless replaced", async () => {
    const s = await make();
    const a = await s.put({ name: "A", preset: preset(), thumbnail: "data:x" });
    const a2 = await s.put({ id: a.id, name: "A renamed", preset: preset("a", { weight: 1 }) });
    expect(a2.createdAt).toBe(a.createdAt);
    expect(a2.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(a2.thumbnail).toBe("data:x");
    expect((await s.list())).toHaveLength(1);
    expect((await s.get(a.id))!.name).toBe("A renamed");
  });

  it("deletes (idempotently)", async () => {
    const s = await make();
    const a = await s.put({ name: "A", preset: preset() });
    await s.delete(a.id);
    await s.delete(a.id);
    expect(await s.list()).toEqual([]);
  });

  it("rejects empty/too-long names and malformed presets without storing anything", async () => {
    const s = await make();
    await expect(s.put({ name: "   ", preset: preset() })).rejects.toThrow(StoreError);
    await expect(s.put({ name: "x".repeat(121), preset: preset() })).rejects.toThrow(/too long/);
    await expect(s.put({ name: "ok", preset: { format: "nope" } as never })).rejects.toThrow(/cm-preset/);
    expect(await s.list()).toEqual([]);
  });

  it("does not alias caller objects", async () => {
    const s = await make();
    const p = preset("a", { gender: 0.3 });
    const saved = await s.put({ name: "A", preset: p });
    p.values.gender = 0.9;
    saved.preset.values.gender = 0.8;
    expect((await s.get(saved.id))!.preset.values.gender).toBe(0.3);
  });
});

describe("openCharacterStore", () => {
  it("uses IndexedDB when available and persists across reopening", async () => {
    const factory = new IDBFactory();
    const s1 = await openCharacterStore(factory);
    expect(s1.persistent).toBe(true);
    const saved = await s1.put({ name: "Keep me", preset: preset() });
    const s2 = await openCharacterStore(factory);
    expect((await s2.get(saved.id))!.name).toBe("Keep me");
  });
  it("falls back to memory when IndexedDB is missing or throws", async () => {
    expect((await openCharacterStore(undefined)).persistent).toBe(false);
    const broken = { open() { throw new Error("denied"); } } as unknown as IDBFactory;
    expect((await openCharacterStore(broken)).persistent).toBe(false);
  });
});
