import type { MacroGroup, MacroVariable, ScalarVariable, SimplexVariable, TargetId } from "./types.ts";

/** Piecewise-linear "hat" weights over the anchors of a scalar variable at value `v` (clamped to the anchor range). */
export function scalarBasis(variable: ScalarVariable, v: number): { name: string; w: number }[] {
  const a = variable.anchors;
  if (a.length === 0) return [];
  if (v <= a[0]!.at) return [{ name: a[0]!.name, w: 1 }];
  const last = a[a.length - 1]!;
  if (v >= last.at) return [{ name: last.name, w: 1 }];
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i]!, hi = a[i + 1]!;
    if (v >= lo.at && v <= hi.at) {
      const t = (v - lo.at) / (hi.at - lo.at);
      return [{ name: lo.name, w: 1 - t }, { name: hi.name, w: t }].filter((x) => x.w > 0);
    }
  }
  return [];
}

/** Normalized simplex weights; if everything is zero, falls back to equal weights. */
export function simplexBasis(variable: SimplexVariable, values: Record<string, number>): { name: string; w: number }[] {
  const raw = variable.components.map((c) => Math.max(0, values[`${variable.id}.${c.name}`] ?? c.default));
  const sum = raw.reduce((s, x) => s + x, 0);
  return variable.components.map((c, i) => ({ name: c.name, w: sum > 0 ? raw[i]! / sum : 1 / variable.components.length })).filter((x) => x.w > 0);
}

function basisOf(v: MacroVariable, values: Record<string, number>): { name: string; w: number }[] {
  return v.kind === "scalar" ? scalarBasis(v, values[v.id] ?? v.default) : simplexBasis(v, values);
}

/** Target weights contributed by one macro group for the given slider values. */
export function macroWeights(group: MacroGroup, variables: ReadonlyMap<string, MacroVariable>, values: Record<string, number>): Map<TargetId, number> {
  let combos: { key: string[]; w: number }[] = [{ key: [], w: 1 }];
  for (const id of group.variables) {
    const variable = variables.get(id);
    if (!variable) throw new Error(`macro ${group.id}: unknown variable "${id}"`);
    const basis = basisOf(variable, values);
    combos = combos.flatMap((c) => basis.map((b) => ({ key: [...c.key, b.name], w: c.w * b.w })));
  }
  const out = new Map<TargetId, number>();
  for (const c of combos) {
    const target = group.targets[c.key.join("|")];
    if (target !== undefined && c.w > 0) out.set(target, (out.get(target) ?? 0) + c.w);
  }
  return out;
}
