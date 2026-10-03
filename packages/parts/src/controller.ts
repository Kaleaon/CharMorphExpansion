import type { CharacterModel, Preset } from "@charmorph/core";
import { PartCatalog, PartSelection, categoryOf } from "./catalog.ts";

/** What the controller needs from the pack loader (PackManager in the app). */
export interface PartPackLoader {
  /** True if `pack` is a loadable pack (it has targets/sliders). Parts of other packs are equipped without loading anything. */
  has(pack: string): boolean;
  ensure(pack: string): Promise<void>;
}

/**
 * Ties the worn parts to the character: equipping loads the part's pack (which adds its sliders to the model),
 * removing a part resets its sliders so its morphs disappear, and the worn list travels with presets.
 */
export class PartsController {
  readonly selection: PartSelection;

  constructor(
    readonly catalog: PartCatalog,
    private readonly model: CharacterModel,
    private readonly loader: PartPackLoader,
  ) {
    this.selection = new PartSelection(catalog);
  }

  /** Ids of worn parts, sorted. */
  get worn(): string[] { return this.selection.toJSON(); }
  isWorn(id: string): boolean { return this.selection.has(id); }

  /** Wear a part (replacing the worn one of its category). Throws, changing nothing, if its pack cannot be loaded. */
  async equip(id: string): Promise<void> {
    const part = this.catalog.get(id);
    if (!part) { this.selection.equip(id); return; } // throws the standard "unknown part" error
    if (this.loader.has(part.pack)) await this.loader.ensure(part.pack);
    const previous = this.selection.parts.find((p) => categoryOf(p.id) === categoryOf(id));
    this.selection.equip(id);
    if (previous && previous.id !== id) this.resetSliders(previous.id);
  }

  unequip(category: string): void {
    for (const p of this.selection.parts) if (categoryOf(p.id) === category) this.resetSliders(p.id);
    this.selection.unequip(category);
  }

  clear(): void {
    for (const p of this.selection.parts) this.resetSliders(p.id);
    this.selection.clear();
  }

  /** Whether the Shape tab should show a slider: part sliders only while their part is worn. */
  sliderVisible(sliderId: string): boolean {
    const owner = this.catalog.partOfSlider(sliderId);
    return !owner || this.selection.has(owner.id);
  }

  /** The model's preset plus the worn parts (the field is left out when nothing is worn). */
  toPreset(name: string): Preset {
    const preset = this.model.toPreset(name);
    return this.worn.length ? { ...preset, parts: this.worn } : preset;
  }

  /** Apply a preset's worn parts after its slider values were applied. Returns part ids that this catalog does not have. */
  restore(preset: Preset): string[] {
    const skipped = this.selection.restore(preset.parts ?? []);
    // Sliders of parts that are not worn must not shape the body, whatever the preset says.
    for (const p of this.catalog.all) if (!this.selection.has(p.id)) this.resetSliders(p.id);
    return skipped;
  }

  /** Load the packs of the parts a preset wears (call before applying its values). */
  async preparePreset(preset: Preset): Promise<void> {
    const packs = new Set((preset.parts ?? []).map((id) => this.catalog.get(id)?.pack).filter((p): p is string => !!p && this.loader.has(p)));
    await Promise.all([...packs].map((p) => this.loader.ensure(p)));
  }

  private resetSliders(partId: string): void {
    for (const id of this.catalog.sliderIds(partId)) if (this.model.has(id)) this.model.set(id, this.model.getDefault(id));
  }
}
