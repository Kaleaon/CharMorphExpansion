export type TargetId = string;

/** A slider moves vertex-morph targets. Bipolar sliders (min -1) drive `neg` below zero and `pos` above; unipolar (min 0) only `pos`. */
export interface BipolarBinding {
  neg?: TargetId;
  pos?: TargetId;
}

export interface SliderDef {
  id: string;
  label: string;
  group: string;
  /** -1 (bipolar) or 0 (unipolar). */
  min: -1 | 0;
  max: 1;
  default: number;
  /** Several bindings let one slider drive e.g. both left and right limbs. */
  bindings: BipolarBinding[];
}

export interface ScalarVariable {
  kind: "scalar";
  id: string;
  label: string;
  group: string;
  default: number;
  /** Named positions on [0,1], ascending. Value is blended linearly between the two neighbouring anchors. */
  anchors: { name: string; at: number }[];
}

export interface SimplexVariable {
  kind: "simplex";
  id: string;
  label: string;
  group: string;
  /** Component weights are kept normalized (sum to 1). */
  components: { name: string; label: string; default: number }[];
}

export type MacroVariable = ScalarVariable | SimplexVariable;

/**
 * A multilinear blend: for every combination of one anchor (or simplex component) per variable there may be a target.
 * Target weight = product of the per-variable basis weights. Combinations without a target contribute nothing.
 */
export interface MacroGroup {
  id: string;
  /** Ids of entries in `CharacterSpec.variables`; a variable may be shared by several groups. */
  variables: string[];
  /** Key = anchor/component name per variable, joined by "|", in variable order. */
  targets: Record<string, TargetId>;
}

export interface CharacterSpec {
  variables: MacroVariable[];
  sliders: SliderDef[];
  macros: MacroGroup[];
}

export interface Preset {
  format: "cm-preset/1";
  name: string;
  /** Only values that differ from their default. */
  values: Record<string, number>;
}
