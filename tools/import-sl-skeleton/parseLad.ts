import { XMLParser } from "fast-xml-parser";
import type { ShapeBoneEffect, ShapeData, ShapeDriven, ShapeParam, ShapeVolumeEffect, Vec3 } from "../../packages/skeleton/src/types.ts";

type Node = Record<string, unknown>;
const tagOf = (n: Node) => Object.keys(n).find((k) => k !== ":@");
const attrs = (n: Node) => (n[":@"] ?? {}) as Record<string, string>;
const kids = (n: Node): Node[] => (n[tagOf(n) ?? ""] as Node[] | undefined) ?? [];

const vec = (s: string | undefined, what: string): Vec3 | undefined => {
  if (s === undefined) return undefined;
  const p = s.trim().split(/\s+/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) throw new Error(`bad vec3 for ${what}: "${s}"`);
  return [p[0]!, p[1]!, p[2]!];
};
const num = (s: string | undefined, fallback: number, what: string): number => {
  if (s === undefined) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`bad number for ${what}: "${s}"`);
  return n;
};

/**
 * `shared="1"` entries are back-references to a parameter defined elsewhere (a mesh re-declares it); they are skipped.
 * Extract the visual parameters that move bones or collision volumes (and the drivers that reach them) from avatar_lad.xml.
 * Defaults follow indra/llcharacter/llvisualparam.cpp (min 0, max 1, default 0) and lldriverparam.cpp (min1 = driver min,
 * max1 = driver max, max2 = min2 = max1).
 */
export function parseLadXml(xml: string): Omit<ShapeData, "source"> {
  const doc = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", allowBooleanAttributes: true }).parse(xml) as Node[];
  const all: ShapeParam[] = [];
  const seen = new Set<number>();

  const visit = (nodes: Node[]) => {
    for (const n of nodes) {
      if (tagOf(n) === "param" && attrs(n).id !== undefined && attrs(n).shared === undefined) {
        const a = attrs(n);
        const id = Number(a.id);
        const where = `param ${a.id} (${a.name})`;
        if (seen.has(id)) throw new Error(`duplicate param id ${id}`);
        seen.add(id);
        const min = num(a.value_min, 0, `${where}.value_min`);
        const max = num(a.value_max, 1, `${where}.value_max`);
        const dflt = a.value_default === undefined ? 0 : Math.min(max, Math.max(min, num(a.value_default, 0, `${where}.value_default`)));
        const p: ShapeParam = { id, name: a.name ?? "", group: num(a.group, 0, `${where}.group`), min, max, default: dflt };
        if (a.label) p.label = a.label;
        if (a.wearable) p.wearable = a.wearable;
        if (a.edit_group) p.editGroup = a.edit_group;
        if (a.sex === "male" || a.sex === "female") p.sex = a.sex;
        for (const c of kids(n)) {
          const t = tagOf(c);
          if (t === "param_skeleton") {
            p.bones = kids(c).filter((b) => tagOf(b) === "bone").map((b): ShapeBoneEffect => {
              const ba = attrs(b);
              const e: ShapeBoneEffect = { name: ba.name! };
              const scale = vec(ba.scale, `${where}.${ba.name}.scale`), offset = vec(ba.offset, `${where}.${ba.name}.offset`);
              if (scale) e.scale = scale;
              if (offset) e.offset = offset;
              return e;
            });
          } else if (t === "param_morph") {
            const vols = kids(c).filter((v) => tagOf(v) === "volume_morph").map((v): ShapeVolumeEffect => {
              const va = attrs(v);
              const e: ShapeVolumeEffect = { name: va.name! };
              const scale = vec(va.scale, `${where}.${va.name}.scale`), pos = vec(va.pos, `${where}.${va.name}.pos`);
              if (scale) e.scale = scale;
              if (pos) e.pos = pos;
              return e;
            });
            if (vols.length) p.volumes = vols;
          } else if (t === "param_driver") {
            p.driven = kids(c).filter((d) => tagOf(d) === "driven").map((d): ShapeDriven => {
              const da = attrs(d);
              const max1 = num(da.max1, max, `${where}.max1`);
              return { id: Number(da.id), min1: num(da.min1, min, `${where}.min1`), max1, max2: num(da.max2, max1, `${where}.max2`), min2: num(da.min2, max1, `${where}.min2`) };
            });
          }
        }
        all.push(p);
      } else {
        visit(kids(n));
      }
    }
  };
  visit(doc);

  // Keep what can move the skeleton: direct effects, and drivers that (transitively) reach one.
  const byId = new Map(all.map((p) => [p.id, p]));
  // `Hover` moves no bone but is the viewer's vertical avatar offset (AVATAR_HOVER), so it is kept as well.
  const keep = new Set(all.filter((p) => p.bones?.length || p.volumes?.length || p.id === 11001).map((p) => p.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of all) if (!keep.has(p.id) && p.driven?.some((d) => keep.has(d.id))) { keep.add(p.id); changed = true; }
  }
  const params = all.filter((p) => keep.has(p.id)).map((p) => {
    if (p.driven) p.driven = p.driven.filter((d) => keep.has(d.id));
    return p;
  });
  for (const p of params) for (const d of p.driven ?? []) if (!byId.has(d.id)) throw new Error(`param ${p.id} drives unknown param ${d.id}`);
  return { params };
}
