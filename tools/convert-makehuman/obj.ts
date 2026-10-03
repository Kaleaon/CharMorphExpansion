export interface ObjCorner { v: number; vt: number }
export interface ParsedObj {
  /** xyz triples, source units. */
  v: number[];
  /** uv pairs. */
  vt: number[];
  /** Faces per group name (0-based corners). Faces before any `g` go to "default". */
  groups: Map<string, ObjCorner[][]>;
}

/** Minimal Wavefront OBJ reader: v, vt, f (v, v/vt, v/vt/vn, v//vn) and g. Negative indices are rejected. */
export function parseObj(text: string): ParsedObj {
  const v: number[] = [];
  const vt: number[] = [];
  const groups = new Map<string, ObjCorner[][]>();
  let current = "default";
  let lineNo = 0;
  for (const raw of text.split("\n")) {
    lineNo++;
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const p = line.split(/\s+/);
    switch (p[0]) {
      case "v": v.push(Number(p[1]), Number(p[2]), Number(p[3])); break;
      case "vt": vt.push(Number(p[1]), Number(p[2])); break;
      case "g": current = p.slice(1).join(" ") || "default"; if (!groups.has(current)) groups.set(current, []); break;
      case "f": {
        const corners = p.slice(1).map((tok) => {
          const [a, b] = tok.split("/");
          const vi = Number(a), ti = b ? Number(b) : NaN;
          if (!Number.isInteger(vi) || vi < 1) throw new Error(`line ${lineNo}: unsupported vertex index "${tok}"`);
          if (b && (!Number.isInteger(ti) || ti < 1)) throw new Error(`line ${lineNo}: unsupported uv index "${tok}"`);
          return { v: vi - 1, vt: b ? ti - 1 : -1 };
        });
        if (corners.length < 3) throw new Error(`line ${lineNo}: face with fewer than 3 corners`);
        if (!groups.has(current)) groups.set(current, []);
        groups.get(current)!.push(corners);
        break;
      }
      default: break;
    }
  }
  if (v.some((x) => !Number.isFinite(x))) throw new Error("non-numeric vertex coordinate");
  return { v, vt, groups };
}

/** Parse a MakeHuman `.target` body: lines of `index dx dy dz`, `#` comments. Returns ascending unique indices. */
export function parseTarget(text: string, name = "target"): { indices: number[]; deltas: number[] } {
  const rows: [number, number, number, number][] = [];
  for (const [n, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length < 4 || p.slice(0, 4).some((x) => !Number.isFinite(x)) || !Number.isInteger(p[0]!) || p[0]! < 0) throw new Error(`${name}:${n + 1}: bad target line "${line}"`);
    rows.push([p[0]!, p[1]!, p[2]!, p[3]!]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rows.length; i++) if (rows[i]![0] === rows[i - 1]![0]) throw new Error(`${name}: duplicate vertex ${rows[i]![0]}`);
  return { indices: rows.map((r) => r[0]), deltas: rows.flatMap((r) => [r[1], r[2], r[3]]) };
}
