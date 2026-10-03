import { macroWeights } from "./macro.ts";
import type { CharacterSpec, MacroVariable, Preset, SliderDef, TargetId } from "./types.ts";

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
    if (s.bindings.length === 0) out.push(`${s.id}: no bindings`);
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

/** Current slider values for a spec and their translation into morph-target weights. */
export class CharacterModel {
  private readonly values: Record<string, number> = {};
  private readonly sliderById = new Map<string, SliderDef>();
  private readonly defaults: Record<string, number> = {};
  private readonly simplexIds = new Map<string, string[]>(); // variable id -> component value ids
  private readonly variableById = new Map<string, MacroVariable>();

  constructor(readonly spec: CharacterSpec, knownTargets?: ReadonlySet<TargetId>) {
    const problems = validateSpec(spec, knownTargets);
    if (problems.length) throw new SpecError(`invalid spec: ${problems.slice(0, 5).join("; ")}`);
    for (const s of spec.sliders) { this.sliderById.set(s.id, s); this.defaults[s.id] = s.default; }
    for (const v of spec.variables) {
      this.variableById.set(v.id, v);
      if (v.kind === "scalar") this.defaults[v.id] = v.default;
      else {
        const ids = v.components.map((c) => `${v.id}.${c.name}`);
        this.simplexIds.set(v.id, ids);
        v.components.forEach((c, i) => { this.defaults[ids[i]!] = c.default; });
      }
    }
    this.reset();
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

  /** Morph-target weights (tiny weights dropped). Bindings from several sliders/macros add up. */
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
    return out;
  }

  toPreset(name: string): Preset {
    const values: Record<string, number> = {};
    for (const id of this.ids) if (Math.abs(this.values[id]! - this.defaults[id]!) > EPS) values[id] = this.values[id]!;
    return { format: "cm-preset/1", name, values };
  }

  /** Reset, then apply a preset. Returns ids in the preset that this model does not know (ignored). */
  applyPreset(p: Preset): string[] {
    this.reset();
    const unknown: string[] = [];
    for (const [id, v] of Object.entries(p.values)) {
      if (!this.has(id)) { unknown.push(id); continue; }
      this.set(id, v);
    }
    return unknown;
  }
}

export function parsePreset(json: unknown): Preset {
  const p = json as Partial<Preset> | null;
  if (!p || p.format !== "cm-preset/1" || typeof p.name !== "string" || typeof p.values !== "object" || p.values === null) throw new SpecError("not a cm-preset/1 document");
  for (const [k, v] of Object.entries(p.values)) if (typeof v !== "number" || !Number.isFinite(v)) throw new SpecError(`preset value ${k} is not a finite number`);
  return p as Preset;
}
