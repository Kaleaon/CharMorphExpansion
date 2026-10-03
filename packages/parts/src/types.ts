import type { SliderDef, SpecFragment, TargetId } from "@charmorph/core";

/** A modular body part (tail, ears, horns, ...) shipped by a pack. See docs/DESIGN_new_features.md §5. */
export interface PartManifest {
  /** `<category>.<name>`, e.g. "tail.canine", "ears.feline_flop". The category is the part before the first dot. */
  id: string;
  label: string;
  pack: string;
  /** Tags for filtering: "canine", "feline", ... */
  species: string[];
  socket: {
    /** SL joint name (Bento extended bones such as mTail1 / mWingsRoot are valid). */
    bone: string;
    offset: [number, number, number];
  };
  /** Rigid parts (horns, claws) parent to the bone; fleshy parts (muzzles, ears) surface-bind to the base mesh. */
  attach: "bone" | "surface";
  /** GLB paths inside the pack, relative, forward slashes. */
  meshes: string[];
  morphTargets?: TargetId[];
  /** Part-local sliders, merged into the character spec when the part's pack loads. */
  sliders?: SliderDef[];
}

export interface PartCatalogFile {
  format: "cm-parts/1";
  parts: PartManifest[];
}

export type { SpecFragment };
