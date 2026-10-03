import { PartCatalog, type PartCatalogFile, type PartManifest } from "@charmorph/parts";
import { SL_SKELETON_DATA } from "@charmorph/skeleton";

// Every `assets/parts-*/parts.json` is one pack's catalog file. With no such pack the catalog is simply empty.
const files = import.meta.glob("../../../../assets/parts-*/parts.json", { eager: true, import: "default" }) as Record<string, PartCatalogFile>;

export interface LoadedCatalog { catalog: PartCatalog; problems: string[] }

/** Build the catalog from all part packs. A pack with a bad file is skipped and reported, so one broken pack can't hide the rest. */
export function loadPartCatalog(sources: Record<string, PartCatalogFile> = files): LoadedCatalog {
  const joints = new Set(SL_SKELETON_DATA.joints.map((j) => j.name));
  const parts: PartManifest[] = [];
  const problems: string[] = [];
  for (const [path, file] of Object.entries(sources)) {
    try {
      const one = PartCatalog.parse(file, joints);
      // A part may not reuse an id another pack already claimed.
      const clash = one.all.find((p) => parts.some((q) => q.id === p.id));
      if (clash) throw new Error(`part id "${clash.id}" is already provided by another pack`);
      parts.push(...one.all);
    } catch (e) {
      problems.push(`${path}: ${(e as Error).message}`);
    }
  }
  return { catalog: new PartCatalog(parts, joints), problems };
}
