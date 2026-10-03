import type { SliderDef, SpecFragment } from "@charmorph/core";
import type { PartCatalogFile, PartManifest } from "./types.ts";

export class PartError extends Error {}

const ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/** Category of a part id: "tail.canine" → "tail". */
export const categoryOf = (id: string): string => id.slice(0, id.indexOf("."));

/**
 * Validate parts; returns human-readable problems (empty = valid).
 * `joints` (the skeleton's joint names) additionally checks socket bones if given.
 */
export function validateParts(parts: readonly PartManifest[], joints?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const sliderIds = new Set<string>();
  for (const p of parts) {
    const bad = (m: string) => out.push(`${p.id}: ${m}`);
    if (!ID.test(p.id)) bad("id must look like category.name (lowercase, digits, underscore)");
    if (ids.has(p.id)) bad("duplicate part id");
    ids.add(p.id);
    if (!p.label) bad("missing label");
    if (!p.pack) bad("missing pack");
    if (!p.species?.length) bad("needs at least one species tag");
    if (!p.socket?.bone) bad("missing socket bone");
    else if (joints && !joints.has(p.socket.bone)) bad(`socket bone "${p.socket.bone}" is not in the skeleton`);
    if (p.socket?.offset?.length !== 3 || p.socket.offset.some((n) => !Number.isFinite(n))) bad("socket offset must be 3 finite numbers");
    if (p.attach !== "bone" && p.attach !== "surface") bad('attach must be "bone" or "surface"');
    if (!p.meshes?.length) bad("needs at least one mesh");
    for (const m of p.meshes ?? []) if (m.includes("..") || m.startsWith("/") || m.includes("\\")) bad(`mesh path "${m}" must be relative, inside the pack, with forward slashes`);
    for (const s of p.sliders ?? []) {
      if (sliderIds.has(s.id)) bad(`slider id "${s.id}" is used by more than one part`);
      sliderIds.add(s.id);
    }
  }
  return out;
}

/** Parts loaded from catalog files, with filtering and per-pack spec fragments. */
export class PartCatalog {
  private readonly byId = new Map<string, PartManifest>();

  constructor(parts: readonly PartManifest[], joints?: ReadonlySet<string>) {
    const problems = validateParts(parts, joints);
    if (problems.length) throw new PartError(`invalid part catalog: ${problems.slice(0, 5).join("; ")}`);
    for (const p of parts) this.byId.set(p.id, p);
  }

  static parse(json: unknown, joints?: ReadonlySet<string>): PartCatalog {
    const f = json as Partial<PartCatalogFile> | null;
    if (!f || f.format !== "cm-parts/1" || !Array.isArray(f.parts)) throw new PartError("not a cm-parts/1 document");
    return new PartCatalog(f.parts, joints);
  }

  get all(): PartManifest[] { return [...this.byId.values()]; }
  get(id: string): PartManifest | undefined { return this.byId.get(id); }
  categories(): string[] { return [...new Set(this.all.map((p) => categoryOf(p.id)))].sort(); }

  /** Parts matching every given filter; `species` matches if the part carries any of the listed tags. */
  find(filter: { category?: string; species?: readonly string[]; pack?: string } = {}): PartManifest[] {
    return this.all.filter((p) =>
      (!filter.category || categoryOf(p.id) === filter.category) &&
      (!filter.pack || p.pack === filter.pack) &&
      (!filter.species?.length || filter.species.some((s) => p.species.includes(s))));
  }

  /** Distinct species tags across the catalog, sorted. */
  speciesTags(): string[] { return [...new Set(this.all.flatMap((p) => p.species))].sort(); }

  /** Case-insensitive substring match on label, id and species tags; every whitespace-separated word must match somewhere. */
  search(query: string, parts: readonly PartManifest[] = this.all): PartManifest[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...parts];
    return parts.filter((p) => {
      const hay = `${p.label} ${p.id} ${p.species.join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  /** Spec fragment for a pack: the sliders of all its parts, ready for `CharacterModel.extend`. Undefined if the pack adds no sliders. */
  fragment(pack: string): SpecFragment | undefined {
    const sliders: SliderDef[] = this.all.filter((p) => p.pack === pack).flatMap((p) => p.sliders ?? []);
    return sliders.length ? { pack, sliders } : undefined;
  }

  /** Every morph target id the pack's parts reference (for the pack loader's known-target check). */
  targets(pack: string): string[] {
    return [...new Set(this.all.filter((p) => p.pack === pack).flatMap((p) => p.morphTargets ?? []))].sort();
  }
}

/** Which part is worn in each category; equipping replaces the category's current part. */
export class PartSelection {
  private readonly worn = new Map<string, string>(); // category → part id
  constructor(private readonly catalog: PartCatalog) {}

  equip(id: string): void {
    if (!this.catalog.get(id)) throw new PartError(`unknown part "${id}"`);
    this.worn.set(categoryOf(id), id);
  }
  unequip(category: string): void { this.worn.delete(category); }
  clear(): void { this.worn.clear(); }
  has(id: string): boolean { return this.worn.get(categoryOf(id)) === id; }
  /** Worn part manifests, sorted by id. */
  get parts(): PartManifest[] { return [...this.worn.values()].sort().map((id) => this.catalog.get(id)!); }
  /** Plain list of ids, for saving next to a preset. */
  toJSON(): string[] { return [...this.worn.values()].sort(); }
  /** Replace the selection; ids no longer in the catalog are skipped and returned. */
  restore(ids: readonly string[]): string[] {
    this.clear();
    const skipped: string[] = [];
    for (const id of ids) { if (this.catalog.get(id)) this.equip(id); else skipped.push(id); }
    return skipped;
  }
}
