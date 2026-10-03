import type { PackInfo, PackSource } from "@charmorph/packs";

// Vite turns these globs into: eager small manifests, and *lazy* URL lookups — a pack's big files are only fetched when asked for.
const infos = import.meta.glob("../../../../assets/makehuman-hm08-*/pack.json", { eager: true, import: "default" }) as Record<string, PackInfo>;
const urls = import.meta.glob("../../../../assets/makehuman-hm08-*/{targets.json,targets.bin,fragment.json}", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

async function url(id: string, file: string): Promise<string> {
  const loader = urls[`../../../../assets/makehuman-hm08-${id}/${file}`];
  if (!loader) throw new Error(`pack file not found: ${id}/${file}`);
  return loader();
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`could not download ${what} (HTTP ${res.status})`);
  return res;
}

export const appPackSource: PackSource = {
  list: () => Object.values(infos).sort((a, b) => a.bytes - b.bytes),
  readJson: async (id, file) => (await ok(await fetch(await url(id, file)), `${id}/${file}`)).json(),
  readBin: async (id, file) => (await ok(await fetch(await url(id, file)), `${id}/${file}`)).arrayBuffer(),
};
