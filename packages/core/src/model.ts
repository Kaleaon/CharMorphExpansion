import { macroWeights } from "./macro.ts";
import type { CharacterSpec, MacroVariable, Preset, SliderDef, SpecFragment, TargetId } from "./types.ts";

export class SpecError extends Error {}

const EPS = 1e-6;

/** Validate a spec; returns human-readable problems (empty = valid). `knownTargets` additionally checks target ids if given. */
export function validateSpec(spec: CharacterSpec, knownTargets?: ReadonlySet<TargetId>): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const claim = (id: string, what: string) => { if (ids.has(id)) out.push(`duplicate id "${id}" (${what})`); ids.add(id); };
  const checkTarget = (t: string | undefined, what: string) => { if (t !== undefined && knownTargets && !knownTargets.has(t)) out.push(`${what}: unknown target "${t}"`); };
  for (const s of spec.sliders) {
    claim(s.id, "slider");
    if (s.default < s.min || s.default > s.max) out.push(`${s.id}: default outside range`);
    if (s.bindings.length === 0 && !s.material?.length) out.push(`${s.id}: no bindings`);
    for (const m of s.material ?? []) {
      if (!m.param) out.push(`${s.id}: material binding without a param`);
      if (m.response === "neg" && s.min === 0) out.push(`${s.id}: unipolar slider has a neg material response`);
      if (m.gain !== undefined && !Number.isFinite(m.gain)) out.push(`${s.id}: material gain is not finite`);
    }
    for (const b of s.bindings) {
      if (b.neg !== undefined && s.min === 0) out.push(`${s.id}: unipolar slider has a neg binding`);
      if (b.neg === undefined && b.pos === undefined) out.push(`${s.id}: empty binding`);
      checkTarget(b.neg, s.id); checkTarget(b.pos, s.id);
    }
  }
  const vars = new Map<string, MacroVariable>();
  for (const v of spec.variables) {
    if (vars.has(v.id)) out.push(`duplicate variable "${v.id}"`);
    vars.set(v.id, v);
    if (v.kind === "scalar") {
      claim(v.id, "macro variable");
      if (v.anchors.length < 2) out.push(`${v.id}: needs at least 2 anchors`);
      if (v.anchors.some((a, i) => i > 0 && a.at <= v.anchors[i - 1]!.at)) out.push(`${v.id}: anchors must ascend`);
      if (v.default < 0 || v.default > 1) out.push(`${v.id}: default outside [0,1]`);
    } else {
      for (const c of v.components) claim(`${v.id}.${c.name}`, "simplex component");
      if (v.components.length < 2) out.push(`${v.id}: needs at least 2 components`);
    }
  }
  for (const m of spec.macros) {
    const missing = m.variables.filter((id) => !vars.has(id));
    for (const id of missing) out.push(`macro ${m.id}: unknown variable "${id}"`);
    if (missing.length) continue;
    const names = m.variables.map((id) => { const v = vars.get(id)!; return v.kind === "scalar" ? v.anchors.map((a) => a.name) : v.components.map((c) => c.name); });
    for (const [key, target] of Object.entries(m.targets)) {
      const parts = key.split("|");
      if (parts.length !== names.length || parts.some((p, i) => !names[i]!.includes(p))) out.push(`macro ${m.id}: key "${key}" does not match its variables`);
      checkTarget(target, `macro ${m.id}`);
    }
  }
  return out;
}

/** Pack id of the values that ship with the base spec. */
export const CORE_PACK = "core";

/** Current slider values for a spec and their translation into morph-target weights. */
export class CharacterModel {
  private readonly values: Record<string, number> = {};
  private readonly sliderById = new Map<string, SliderDef>();
  private readonly defaults: Record<string, number> = {};
  private readonly simplexIds = new Map<string, string[]>(); // variable id -> component value ids
  private readonly variableById = new Map<string, MacroVariable>();
  private readonly packOfId = new Map<string, string>();
  private readonly loadedPacks = new Set<string>([CORE_PACK]);
  private knownTargets: Set<TargetId> | undefined;
  private _spec: CharacterSpec;

  constructor(spec: CharacterSpec, knownTargets?: ReadonlySet<TargetId>) {
    this.knownTargets = knownTargets ? new Set(knownTargets) : undefined;
    this._spec = spec;
    const problems = validateSpec(spec, this.knownTargets);
    if (problems.length) throw new SpecError(`invalid spec: ${problems.slice(0, 5).join("; ")}`);
    this.index(CORE_PACK, spec.sliders, spec.variables);
    this.reset();
  }

  get spec(): CharacterSpec { return this._spec; }
  get packs(): string[] { return [...this.loadedPacks]; }
  hasPack(pack: string): boolean { return this.loadedPacks.has(pack); }
  /** Which pack contributed this value id ("core" for the built-in ones). */
  packOf(id: string): string { this.need(id); return this.packOfId.get(id)!; }

  private index(pack: string, sliders: SliderDef[], variables: MacroVariable[]): void {
    for (const s of sliders) { this.sliderById.set(s.id, s); this.defaults[s.id] = s.default; this.packOfId.set(s.id, pack); }
    for (const v of variables) {
      this.variableById.set(v.id, v);
      if (v.kind === "scalar") { this.defaults[v.id] = v.default; this.packOfId.set(v.id, pack); }
      else {
        const ids = v.components.map((c) => `${v.id}.${c.name}`);
        this.simplexIds.set(v.id, ids);
        v.components.forEach((c, i) => { this.defaults[ids[i]!] = c.default; this.packOfId.set(ids[i]!, pack); });
      }
    }
  }

  /**
   * Add a pack's sliders/variables/macros. Existing slider values are kept; new ones start at their defaults.
   * Macro groups with an existing id are replaced (this is how an "age" pack widens the body-type blend).
   * `newTargets` are the target ids the pack brought; they are checked and become known. Throws without changing anything on invalid input.
   */
  extend(fragment: SpecFragment, newTargets?: Iterable<TargetId>): void {
    const { merged, known } = this.plan(fragment, newTargets);
    this._spec = merged;
    this.knownTargets = known;
    this.loadedPacks.add(fragment.pack);
    const before = new Set(Object.keys(this.defaults));
    this.index(fragment.pack, fragment.sliders ?? [], fragment.variables ?? []);
    for (const id of Object.keys(this.defaults)) if (!before.has(id)) this.values[id] = this.defaults[id]!;
  }

  /** Dry run of `extend`: throws exactly when `extend` would, and changes nothing. */
  checkExtend(fragment: SpecFragment, newTargets?: Iterable<TargetId>): void { this.plan(fragment, newTargets); }

  private plan(fragment: SpecFragment, newTargets?: Iterable<TargetId>): { merged: CharacterSpec; known: Set<TargetId> | undefined } {
    if (this.loadedPacks.has(fragment.pack)) throw new SpecError(`pack "${fragment.pack}" is already loaded`);
    const known = this.knownTargets ? new Set([...this.knownTargets, ...(newTargets ?? [])]) : undefined;
    const replaced = new Set((fragment.macros ?? []).map((m) => m.id));
    const merged: CharacterSpec = {
      variables: [...this._spec.variables, ...(fragment.variables ?? [])],
      sliders: [...this._spec.sliders, ...(fragment.sliders ?? [])],
      macros: [...this._spec.macros.filter((m) => !replaced.has(m.id)), ...(fragment.macros ?? [])],
    };
    const problems = validateSpec(merged, known);
    if (problems.length) throw new SpecError(`pack "${fragment.pack}" is invalid: ${problems.slice(0, 5).join("; ")}`);
    return { merged, known };
  }

  get ids(): string[] { return Object.keys(this.defaults); }
  has(id: string): boolean { return id in this.defaults; }
  get(id: string): number { this.need(id); return this.values[id]!; }
  getDefault(id: string): number { this.need(id); return this.defaults[id]!; }
  snapshot(): Record<string, number> { return { ...this.values }; }

  private need(id: string): void { if (!(id in this.defaults)) throw new SpecError(`unknown value "${id}"`); }

  reset(): void { Object.assign(this.values, this.defaults); }

  /** Set a value (clamped to its range). Simplex components renormalize their siblings proportionally. */
  set(id: string, v: number): void {
    this.need(id);
    if (!Number.isFinite(v)) throw new RangeError(`non-finite value for ${id}`);
    const slider = this.sliderById.get(id);
    if (slider) { this.values[id] = Math.min(slider.max, Math.max(slider.min, v)); return; }
    const sx = [...this.simplexIds.values()].find((ids) => ids.includes(id));
    if (sx) { this.setSimplex(sx, id, v); return; }
    this.values[id] = Math.min(1, Math.max(0, v));
  }

  private setSimplex(group: string[], id: string, v: number): void {
    const nv = Math.min(1, Math.max(0, v));
    const others = group.filter((g) => g !== id);
    const restOld = others.reduce((s, g) => s + this.values[g]!, 0);
    const restNew = 1 - nv;
    this.values[id] = nv;
    for (const g of others) this.values[g] = restOld > EPS ? (this.values[g]! / restOld) * restNew : restNew / others.length;
  }

  /** Morph-target weights (tiny weights dropped), sorted by target id. Bindings from several sliders/macros add up. */
  weights(): Map<TargetId, number> {
    const out = new Map<TargetId, number>();
    const add = (t: TargetId, w: number) => { if (w > EPS) out.set(t, (out.get(t) ?? 0) + w); };
    for (const s of this.spec.sliders) {
      const v = this.values[s.id]!;
      for (const b of s.bindings) {
        if (v > 0 && b.pos !== undefined) add(b.pos, v);
        else if (v < 0 && b.neg !== undefined) add(b.neg, -v);
      }
    }
    for (const m of this.spec.macros) for (const [t, w] of macroWeights(m, this.variableById, this.values)) add(t, w);
    // Canonical order, so the same sliders give a bit-identical body no matter which packs loaded first.
    return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  /** Material parameter values driven by sliders (zero contributions dropped), sorted by name. Presets already capture them via the slider values. */
  materialParams(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.spec.sliders) {
      const v = this.values[s.id]!;
      for (const m of s.material ?? []) {
        const r = m.response === "pos" ? Math.max(0, v) : m.response === "neg" ? Math.max(0, -v) : Math.abs(v);
        if (r > EPS) out[m.param] = (out[m.param] ?? 0) + r * (m.gain ?? 1);
      }
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  toPreset(name: string): Preset {
    const values: Record<string, number> = {};
    const packs = new Set<string>();
    for (const id of this.ids) {
      if (Math.abs(this.values[id]! - this.defaults[id]!) <= EPS) continue;
      values[id] = this.values[id]!;
      const pack = this.packOfId.get(id)!;
      if (pack !== CORE_PACK) packs.add(pack);
    }
    return packs.size ? { format: "cm-preset/1", name, packs: [...packs].sort(), values } : { format: "cm-preset/1", name, values };
  }

  /** Reset, then apply a preset. Returns ids in the preset that this model does not know (ignored). */
  applyPreset(p: Preset): string[] {
    this.reset();
    const unknown: string[] = [];
    const simplexTouched = new Set<string>(); // variable ids
    const simplexOf = new Map<string, string>(); // component id -> variable id
    for (const [variable, ids] of this.simplexIds) for (const id of ids) simplexOf.set(id, variable);
    const raw = new Map<string, number>();
    for (const [id, v] of Object.entries(p.values)) {
      if (!this.has(id)) { unknown.push(id); continue; }
      const variable = simplexOf.get(id);
      if (variable) { simplexTouched.add(variable); raw.set(id, Math.max(0, v)); continue; }
      this.set(id, v);
    }
    // Simplex components are assigned together (not one by one, which would renormalize after every step) and then normalized once.
    for (const variable of simplexTouched) {
      const ids = this.simplexIds.get(variable)!;
      const vals = ids.map((id) => raw.get(id) ?? this.values[id]!);
      const sum = vals.reduce((a, b) => a + b, 0);
      // Values written by toPreset already sum to 1 (within float noise); only renormalize hand-edited presets, so saved characters reload bit-exactly.
      const exact = Math.abs(sum - 1) < 1e-9;
      ids.forEach((id, i) => { this.values[id] = exact ? vals[i]! : sum > EPS ? vals[i]! / sum : this.defaults[id]!; });
    }
    return unknown;
  }
}

export function parsePreset(json: unknown): Preset {
  const p = json as Partial<Preset> | null;
  if (!p || p.format !== "cm-preset/1" || typeof p.name !== "string" || typeof p.values !== "object" || p.values === null) throw new SpecError("not a cm-preset/1 document");
  for (const [k, v] of Object.entries(p.values)) if (typeof v !== "number" || !Number.isFinite(v)) throw new SpecError(`preset value ${k} is not a finite number`);
  if (p.packs !== undefined && (!Array.isArray(p.packs) || p.packs.some((x) => typeof x !== "string"))) throw new SpecError("preset packs must be a list of strings");
  if (p.parts !== undefined && (!Array.isArray(p.parts) || p.parts.some((x) => typeof x !== "string"))) throw new SpecError("preset parts must be a list of strings");
  return p as Preset;
}
