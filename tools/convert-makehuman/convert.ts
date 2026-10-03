// Convert the CC0 MakeHuman base mesh + selected targets into our binary packs under assets/makehuman-hm08/.
// Usage: node tools/convert-makehuman/convert.ts [--mh <checkout dir>]
// Without --mh, a sparse checkout of the pinned upstream commit is made in the OS temp dir (needs git + network).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, type Manifest, type ManifestFile } from "../../packages/assets/src/manifest.ts";
import { encodeMeshPack, encodeTargetPack, type MorphMesh } from "../../packages/morph/src/pack.ts";
import { allTargets, spec } from "./content.ts";
import { parseObj, parseTarget } from "./obj.ts";

/** Pinned upstream commit of https://github.com/makehumancommunity/makehuman (assets: CC0-1.0, see its LICENSE.md section C). */
const PINNED = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482";
const REPO = "https://github.com/makehumancommunity/makehuman";
const OUT = new URL("../../assets/makehuman-hm08/", import.meta.url).pathname;
/** MakeHuman uses decimetres. */
const UNIT = 0.1;

function acquire(): string {
  const i = process.argv.indexOf("--mh");
  const dir = i >= 0 ? process.argv[i + 1]! : join(tmpdir(), `cm-makehuman-${PINNED.slice(0, 8)}`);
  if (i < 0 && !existsSync(join(dir, ".git"))) {
    execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", `${REPO}.git`, dir], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "sparse-checkout", "set", "--cone", "makehuman/data/3dobjs", "makehuman/data/targets"], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "checkout", "-q", PINNED], { stdio: "inherit" });
  }
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== PINNED) throw new Error(`MakeHuman checkout is at ${head}, expected pinned ${PINNED}`);
  return dir;
}

function buildMesh(objText: string): { mesh: MorphMesh; toMorph: Map<number, number>; offsetY: number } {
  const obj = parseObj(objText);
  const faces = obj.groups.get("body");
  if (!faces?.length) throw new Error("base.obj has no 'body' group");

  // Morph vertices = unique source vertices used by the body, in source order.
  const used = new Set<number>();
  for (const f of faces) for (const c of f) used.add(c.v);
  const sorted = [...used].sort((a, b) => a - b);
  const toMorph = new Map(sorted.map((v, i) => [v, i]));

  let minY = Infinity;
  for (const v of sorted) minY = Math.min(minY, obj.v[v * 3 + 1]!);
  const positions = new Float32Array(sorted.length * 3);
  sorted.forEach((v, i) => positions.set([obj.v[v * 3]! * UNIT, (obj.v[v * 3 + 1]! - minY) * UNIT, obj.v[v * 3 + 2]! * UNIT], i * 3));

  // Render vertices split on (vertex, uv) pairs.
  const renderKey = new Map<string, number>();
  const renderToMorph: number[] = [];
  const uvs: number[] = [];
  const renderOf = (c: { v: number; vt: number }): number => {
    const key = `${c.v}/${c.vt}`;
    let r = renderKey.get(key);
    if (r === undefined) {
      r = renderToMorph.length;
      renderKey.set(key, r);
      renderToMorph.push(toMorph.get(c.v)!);
      uvs.push(c.vt >= 0 ? obj.vt[c.vt * 2]! : 0, c.vt >= 0 ? obj.vt[c.vt * 2 + 1]! : 0);
    }
    return r;
  };
  const indices: number[] = [];
  for (const f of faces) for (let k = 1; k < f.length - 1; k++) indices.push(renderOf(f[0]!), renderOf(f[k]!), renderOf(f[k + 1]!));

  // Winding: make triangles counter-clockwise seen from outside (positive signed volume).
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = renderToMorph[indices[i]!]! * 3, b = renderToMorph[indices[i + 1]!]! * 3, c = renderToMorph[indices[i + 2]!]! * 3;
    const p = positions;
    vol += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  if (vol < 0) for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = t; }

  return {
    mesh: { name: "makehuman-hm08-body", positions, uvs: Float32Array.from(uvs), renderToMorph: Uint32Array.from(renderToMorph), indices: Uint32Array.from(indices) },
    toMorph,
    offsetY: -minY * UNIT,
  };
}

const mh = acquire();
const data = join(mh, "makehuman/data");
const { mesh, toMorph } = buildMesh(readFileSync(join(data, "3dobjs/base.obj"), "utf8"));
const morphCount = mesh.positions.length / 3;

const targets = allTargets.map((t) => {
  const parsed = parseTarget(readFileSync(join(data, "targets", t.file), "utf8"), t.file);
  const indices: number[] = [];
  const deltas: number[] = [];
  parsed.indices.forEach((src, i) => {
    const m = toMorph.get(src);
    if (m === undefined) return; // helper geometry (tights, eyes, teeth…) is not part of the body mesh
    indices.push(m);
    deltas.push(parsed.deltas[i * 3]! * UNIT, parsed.deltas[i * 3 + 1]! * UNIT, parsed.deltas[i * 3 + 2]! * UNIT);
  });
  // Re-sort: the source→morph map is monotonic, so order is preserved.
  return { id: t.id, indices: Uint32Array.from(indices), deltas: Float32Array.from(deltas), source: `makehuman/data/targets/${t.file}` };
});

const provenance = { repo: REPO, commit: PINNED, license: "CC0-1.0", licenseSource: "LICENSE.md section C and LICENSE.ASSETS.md in the upstream repository", note: "Converted by tools/convert-makehuman: body group only, metres, feet at y=0, int16-quantized sparse targets." };
const mp = encodeMeshPack(mesh, { ...provenance, file: "makehuman/data/3dobjs/base.obj" });
const tp = encodeTargetPack(targets, morphCount, provenance);

mkdirSync(OUT, { recursive: true });
const files: Record<string, string | Uint8Array> = {
  "mesh.json": `${JSON.stringify(mp.meta)}\n`,
  "mesh.bin": mp.bin,
  "targets.json": `${JSON.stringify(tp.meta)}\n`,
  "targets.bin": tp.bin,
  "spec.json": `${JSON.stringify(spec)}\n`,
  "LICENSE.txt": `Creative Commons CC0 1.0 Universal (public domain dedication) applies to mesh.*, targets.* and the MakeHuman-derived parts of spec.json.\n\nUpstream: ${REPO} @ ${PINNED}\nUpstream notice (from base.obj / *.target headers):\n  "This asset was explicitly released as CC0 in september 2020."\n  Copyright holders at release: Data Collection AB (https://www.datacollection.se), Joel Palmius, Jonas Hauquier.\nFull CC0 text: https://creativecommons.org/publicdomain/zero/1.0/legalcode\n\nspec.json (the slider catalog) is original work of this project under the MIT license; see /LICENSE.\n`,
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);

const upstream = `${REPO}/tree/${PINNED}/makehuman/data`;
const author = "MakeHuman Community (Data Collection AB, Joel Palmius, Jonas Hauquier)";
const entry = (path: string, derived: boolean): ManifestFile => derived
  ? { path, sha256: sha256(readFileSync(join(OUT, path))), license: "CC0-1.0", author, sourceUrl: upstream }
  : { path, sha256: sha256(readFileSync(join(OUT, path))), license: "MIT", author: "Kaleaon (this project)", sourceUrl: "https://github.com/Kaleaon/CharMorphExpansion", attribution: "Copyright (c) 2026 Kaleaon" };
const manifest: Manifest = {
  pack: "makehuman-hm08",
  files: [entry("mesh.json", true), entry("mesh.bin", true), entry("targets.json", true), entry("targets.bin", true), entry("spec.json", false)],
};
writeFileSync(join(OUT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`mesh: ${morphCount} morph verts, ${mesh.renderToMorph.length} render verts, ${mesh.indices.length / 3} triangles (${kb(mp.bin.length)})`);
console.log(`targets: ${targets.length} (${kb(tp.bin.length)}), sliders: ${spec.sliders.length}`);
