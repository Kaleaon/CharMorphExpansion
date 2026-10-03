import type { SliderDef } from "../../packages/core/src/types.ts";
import type { TargetRef } from "./content.ts";

/** One entry of MakeHuman's modeling_modifiers.json. */
export interface RawModifier { target?: string; min?: string; max?: string; macrovar?: string; modifierType?: string }
export interface RawGroup { group: string; modifiers: RawModifier[] }

export interface GenerateOptions {
  /** MakeHuman groups (= target subfolders) to include. */
  groups: string[];
  /** UI section for a canonical target name within a group. */
  section: (group: string, canonical: string) => string;
  /** Target ids already used elsewhere; a modifier touching one of them is skipped entirely. */
  exclude: ReadonlySet<string>;
}

const WORDS: Record<string, string> = { horiz: "width", vert: "height", trans: "position", incr: "more", decr: "less" };
const PAIR_LABEL: Record<string, string> = { "in|out": "in/out", "down|up": "up/down", "backward|forward": "forward/back" };

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "nose-scale-horiz" → "Scale width" (leading group word dropped when 2+ words remain); "eye-bag" stays "Eye bag". */
export function humanize(canonical: string, group: string, min?: string, max?: string): string {
  let parts = canonical.split("-");
  // Drop a leading word that merely repeats the section name, but only if a meaningful phrase remains.
  if ((parts[0] === group || parts[0] === group.replace(/s$/, "")) && parts.length > 2) parts = parts.slice(1);
  const words = parts.map((w) => WORDS[w] ?? w);
  if (words[words.length - 1] === "position" && min && max) words.push(PAIR_LABEL[`${min}|${max}`] ?? `${min}/${max}`);
  return cap(words.join(" ").replace(/\s+/g, " ").trim());
}

interface Pending { canonical: string; group: string; min?: string; max?: string; sides: Map<"l" | "r" | "", string> }

/**
 * Turn MakeHuman modifier definitions into sliders and the list of target files they need.
 * Left/right pairs (`l-…`/`r-…`) become one symmetric slider driving both; a lone side keeps its prefix in the label.
 */
export function generateSliders(raw: RawGroup[], opts: GenerateOptions): { sliders: SliderDef[]; refs: TargetRef[] } {
  const pend = new Map<string, Pending>();
  const order: string[] = [];
  for (const g of raw) {
    if (!opts.groups.includes(g.group)) continue;
    for (const m of g.modifiers) {
      if (m.macrovar !== undefined || m.target === undefined) continue; // macro variables are modelled separately
      const side = m.target.startsWith("l-") ? "l" : m.target.startsWith("r-") ? "r" : "";
      const canonical = side ? m.target.slice(2) : m.target;
      const key = `${g.group}|${canonical}|${m.min ?? ""}|${m.max ?? ""}`;
      let p = pend.get(key);
      if (!p) { p = { canonical, group: g.group, min: m.min, max: m.max, sides: new Map() }; pend.set(key, p); order.push(key); }
      p.sides.set(side, m.target);
    }
  }

  const sliders: SliderDef[] = [];
  const refs: TargetRef[] = [];
  const usedIds = new Set<string>();
  const axes: string[] = []; // parallel to `sliders`: axis pair, used only to tell apart same-labelled sliders
  const stems = (target: string, p: Pending) => (p.min !== undefined && p.max !== undefined ? [`${target}-${p.min}`, `${target}-${p.max}`] : [target]);

  for (const key of order) {
    const p = pend.get(key)!;
    const targets = [...p.sides.values()];
    const allStems = targets.flatMap((t) => stems(t, p));
    if (allStems.some((s) => opts.exclude.has(s))) continue;

    const bipolar = p.min !== undefined && p.max !== undefined;
    const bindings = targets.map((t) => { const [a, b] = stems(t, p); return bipolar ? { neg: a!, pos: b! } : { pos: a! }; });
    let id = p.canonical;
    if (usedIds.has(id)) id = bipolar ? `${p.canonical}-${p.min}-${p.max}` : `${p.canonical}-2`;
    while (usedIds.has(id)) id += "_";
    usedIds.add(id);

    const lone = p.sides.size === 1 && !p.sides.has("") ? [...p.sides.keys()][0] : undefined;
    if (lone) id = `${lone}-${id}`; // keep ids of one-sided sliders distinct from a would-be merged twin
    const base = humanize(p.canonical, p.group, p.min, p.max);
    const label = lone ? `${lone === "l" ? "Left" : "Right"} ${base[0]!.toLowerCase()}${base.slice(1)}` : base;
    sliders.push({ id, label, group: opts.section(p.group, p.canonical), min: bipolar ? -1 : 0, max: 1, default: 0, bindings });
    axes.push(bipolar ? (PAIR_LABEL[`${p.min}|${p.max}`] ?? `${p.min}/${p.max}`) : "");

    for (const t of targets) for (const stem of stems(t, p)) refs.push({ id: stem, file: `${p.group}/${stem}.target` });
  }
  // The same upstream target can be exposed on several axes; tell those apart by their axis pair.
  const count = new Map<string, number>();
  for (const sl of sliders) count.set(`${sl.group}|${sl.label}`, (count.get(`${sl.group}|${sl.label}`) ?? 0) + 1);
  // The plain less/more axis (decr/incr) keeps the bare label; only the other axes get a suffix.
  const plain = new Set<string>();
  sliders.forEach((sl, i) => { const k = `${sl.group}|${sl.label}`; if (count.get(k)! > 1 && axes[i] === "decr/incr" && !plain.has(k)) plain.add(k); });
  sliders.forEach((sl, i) => {
    const k = `${sl.group}|${sl.label}`;
    if (count.get(k)! > 1 && axes[i] && !(axes[i] === "decr/incr" && plain.has(k))) sl.label = `${sl.label} (${axes[i]})`;
  });
  return { sliders, refs };
}
