import type { PackInfo, PackSource } from "@charmorph/packs";
import { partsFragment } from "@charmorph/parts";

// Vite turns these globs into: eager small manifests, and *lazy* URL lookups — a pack's big files are only fetched when asked for.
// Two kinds of pack: MakeHuman slider packs (makehuman-hm08-*) and modular part packs (parts-*, whose fragment is read from parts.json).
const infos = import.meta.glob("../../../../assets/{makehuman-hm08-*,parts-*}/pack.json", { eager: true, import: "default" }) as Record<string, PackInfo>;
const urls = import.meta.glob("../../../../assets/{makehuman-hm08-*,parts-*}/{targets.json,targets.bin,fragment.json,parts.json}", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

const dirOf = (key: string) => key.split("/").slice(-2, -1)[0]!;
/** Pack id → its directory under assets/ (the id of a MakeHuman pack drops the "makehuman-hm08-" prefix, a part pack's id is its directory). */
const dirs = new Map(Object.entries(infos).map(([key, info]) => [info.id, dirOf(key)]));

async function url(id: string, file: string): Promise<string> {
  const dir = dirs.get(id);
  const loader = dir && urls[`../../../../assets/${dir}/${file}`];
  if (!loader) throw new Error(`pack file not found: ${id}/${file}`);
  return loader();
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`could not download ${what} (HTTP ${res.status})`);
  return res;
}

/** Ids of the packs that hold modular parts (they are managed from the Parts tab, not offered as slider downloads). */
export const isPartPack = (id: string): boolean => dirs.get(id)?.startsWith("parts-") ?? false;

export const appPackSource: PackSource = {
  list: () => Object.values(infos).sort((a, b) => a.bytes - b.bytes),
  readJson: async (id, file) => {
    const json = await (await ok(await fetch(await url(id, file)), `${id}/${file}`)).json();
    return file === "parts.json" ? partsFragment(json, id) : json;
  },
  readBin: async (id, file) => (await ok(await fetch(await url(id, file)), `${id}/${file}`)).arrayBuffer(),
};
