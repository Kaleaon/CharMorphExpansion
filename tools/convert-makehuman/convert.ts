// Convert the CC0 MakeHuman base mesh + targets into our binary packs under assets/makehuman-hm08*/.
//   assets/makehuman-hm08        core: mesh + macros (young adult) + 20 regional sliders  (always loaded)
//   assets/makehuman-hm08-age    lazy: baby / child / old
//   assets/makehuman-hm08-face   lazy: face detail sliders
//   assets/makehuman-hm08-body   lazy: body detail sliders
// Usage: node tools/convert-makehuman/convert.ts [--mh <checkout dir>]
// Without --mh, a sparse checkout of the pinned upstream commit is made in the OS temp dir (needs git + network).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpecFragment } from "../../packages/core/src/types.ts";
import { sha256, type Manifest, type ManifestFile } from "../../packages/assets/src/manifest.ts";
import { encodeMeshPack, encodeTargetPack, type MorphTarget } from "../../packages/morph/src/pack.ts";
import { ageTargets, agePackFragment, agePackInfo, allTargets, bodyPack, coreTargetIds, facePack, spec, type TargetRef } from "./content.ts";
import { requiredMhJoints } from "../../packages/rig/src/correspondence.ts";
import { buildMesh, UNIT } from "./mesh.ts";
import { mapBones } from "./rigmap.ts";
import { generateSliders, type RawGroup } from "./modifiers.ts";
import { parseTarget } from "./obj.ts";

/** Pinned upstream commit of https://github.com/makehumancommunity/makehuman (assets: CC0-1.0, see its LICENSE.md section C). */
const PINNED = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482";
const REPO = "https://github.com/makehumancommunity/makehuman";
const ASSETS = new URL("../../assets/", import.meta.url).pathname;
const MESH_NAME = "makehuman-hm08-body";

function acquire(): string {
  const i = process.argv.indexOf("--mh");
  const dir = i >= 0 ? process.argv[i + 1]! : join(tmpdir(), `cm-makehuman-${PINNED.slice(0, 8)}`);
  if (i < 0 && !existsSync(join(dir, ".git"))) {
    execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", `${REPO}.git`, dir], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "sparse-checkout", "set", "--cone", "makehuman/data/3dobjs", "makehuman/data/targets", "makehuman/data/modifiers"], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "checkout", "-q", PINNED], { stdio: "inherit" });
  }
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== PINNED) throw new Error(`MakeHuman checkout is at ${head}, expected pinned ${PINNED}`);
  return dir;
}

const mh = acquire();
const data = join(mh, "makehuman/data");
// The skeleton joints are centroids of vertex groups that live in helper geometry; keep those vertices as non-rendered helpers.
const mhskel = JSON.parse(readFileSync(join(data, "rigs/default.mhskel"), "utf8")) as { bones: Record<string, { parent: string | null; head: string; tail: string }>; joints: Record<string, number[]> };
const mhweights = JSON.parse(readFileSync(join(data, "rigs/default_weights.mhw"), "utf8")) as { weights: Record<string, [number, number][]> };
const neededJoints = requiredMhJoints();
for (const j of neededJoints) if (!mhskel.joints[j]) throw new Error(`MakeHuman skeleton has no joint "${j}"`);
const helperSource = new Set(neededJoints.flatMap((j) => mhskel.joints[j]!));
const { mesh, toMorph } = buildMesh(readFileSync(join(data, "3dobjs/base.obj"), "utf8"), helperSource);
const morphCount = mesh.positions.length / 3;
const bodyCount = mesh.helperStart ?? morphCount;

const provenance = { repo: REPO, commit: PINNED, license: "CC0-1.0", licenseSource: "LICENSE.md section C and LICENSE.ASSETS.md in the upstream repository", note: "Converted by tools/convert-makehuman: body group only, metres, feet at y=0, int16-quantized sparse targets." };
const author = "MakeHuman Community (Data Collection AB, Joel Palmius, Jonas Hauquier)";
const upstream = `${REPO}/tree/${PINNED}/makehuman/data`;

function loadTargets(refs: TargetRef[]): (MorphTarget & { source: string })[] {
  const seen = new Set<string>();
  return refs.map((t) => {
    if (seen.has(t.id)) throw new Error(`duplicate target id ${t.id}`);
    seen.add(t.id);
    const parsed = parseTarget(readFileSync(join(data, "targets", t.file), "utf8"), t.file);
    const indices: number[] = [];
    const deltas: number[] = [];
    parsed.indices.forEach((src, i) => {
      const m = toMorph.get(src);
      if (m === undefined) return; // helper geometry (tights, eyes, teeth…) is not part of the body mesh
      indices.push(m);
      deltas.push(parsed.deltas[i * 3]! * UNIT, parsed.deltas[i * 3 + 1]! * UNIT, parsed.deltas[i * 3 + 2]! * UNIT);
    });
    return { id: t.id, indices: Uint32Array.from(indices), deltas: Float32Array.from(deltas), source: `makehuman/data/targets/${t.file}` };
  });
}

const entry = (dir: string, path: string, derived: boolean): ManifestFile => {
  const base = { path, sha256: sha256(readFileSync(join(dir, path))) };
  return derived
    ? { ...base, license: "CC0-1.0", author, sourceUrl: upstream }
    : { ...base, license: "MIT", author: "Kaleaon (this project)", sourceUrl: "https://github.com/Kaleaon/CharMorphExpansion", attribution: "Copyright (c) 2026 Kaleaon" };
};

const licenseText = (what: string) => `Creative Commons CC0 1.0 Universal (public domain dedication) applies to ${what}.\n\nUpstream: ${REPO} @ ${PINNED}\nUpstream notice (from base.obj / *.target headers):\n  "This asset was explicitly released as CC0 in september 2020."\n  Copyright holders at release: Data Collection AB (https://www.datacollection.se), Joel Palmius, Jonas Hauquier.\nFull CC0 text: https://creativecommons.org/publicdomain/zero/1.0/legalcode\n\nThe slider catalog / fragment JSON is original work of this project under the MIT license; see /LICENSE.\n`;

function write(dir: string, files: Record<string, string | Uint8Array>, derived: string[], authored: string[], pack: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const manifest: Manifest = { pack, files: [...derived.map((f) => entry(dir, f, true)), ...authored.map((f) => entry(dir, f, false))] };
  writeFileSync(join(dir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

// ---- rig: MakeHuman joints (as morph-vertex lists) and skin weights merged onto Second Life joints ---------------------
function buildRig() {
  const parents = Object.fromEntries(Object.entries(mhskel.bones).map(([n, b]) => [n, b.parent]));
  const toSl = mapBones(parents);
  const perVertex: Map<string, number>[] = Array.from({ length: bodyCount }, () => new Map());
  for (const [bone, list] of Object.entries(mhweights.weights)) {
    const sl = toSl[bone];
    if (!sl) throw new Error(`weights for unknown bone ${bone}`);
    for (const [src, w] of list) {
      const m = toMorph.get(src);
      if (m === undefined || m >= bodyCount) continue; // helper geometry
      perVertex[m]!.set(sl, (perVertex[m]!.get(sl) ?? 0) + w);
    }
  }
  const slJoints = [...new Set(Object.values(toSl))].sort();
  const slIndex = new Map(slJoints.map((n, i) => [n, i]));
  const idx = new Uint8Array(bodyCount * 4), wt = new Uint8Array(bodyCount * 4);
  let zero = 0;
  perVertex.forEach((map, v) => {
    const top = [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0);
    if (!(sum > 0)) { zero++; idx[v * 4] = slIndex.get("mPelvis") ?? 0; wt[v * 4] = 255; return; }
    // quantize to bytes that sum to exactly 255 (largest remainder)
    const exact = top.map(([, w]) => (w / sum) * 255);
    const q = exact.map(Math.floor);
    let rest = 255 - q.reduce((a, b) => a + b, 0);
    exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { q[i]!++; rest--; } });
    top.forEach(([name], i) => { idx[v * 4 + i] = slIndex.get(name)!; wt[v * 4 + i] = q[i]!; });
  });
  const bin = new Uint8Array(idx.length * 2);
  bin.set(idx, 0); bin.set(wt, idx.length);
  const joints: Record<string, number[]> = {};
  for (const j of neededJoints) joints[j] = mhskel.joints[j]!.map((src) => toMorph.get(src)!);
  return {
    bin,
    meta: {
      format: "cm-rig/1" as const, mesh: MESH_NAME, bodyVertexCount: bodyCount, helperStart: bodyCount,
      slJoints, skinIndexOffset: 0, skinWeightOffset: idx.length,
      joints,
      stats: { zeroWeightVertices: zero },
      source: { ...provenance, files: ["makehuman/data/rigs/default.mhskel", "makehuman/data/rigs/default_weights.mhw"], license: "CC0 (stated inside both files)" },
    },
  };
}

// ---- core --------------------------------------------------------------------------------------------------------
{
  const targets = loadTargets(allTargets);
  const mp = encodeMeshPack(mesh, { ...provenance, file: "makehuman/data/3dobjs/base.obj" });
  const tp = encodeTargetPack(targets, morphCount, provenance);
  const rig = buildRig();
  write(join(ASSETS, "makehuman-hm08"), {
    "mesh.json": `${JSON.stringify(mp.meta)}\n`, "mesh.bin": mp.bin,
    "targets.json": `${JSON.stringify(tp.meta)}\n`, "targets.bin": tp.bin,
    "rig.json": `${JSON.stringify(rig.meta)}\n`, "rig.bin": rig.bin,
    "spec.json": `${JSON.stringify(spec)}\n`,
    "LICENSE.txt": licenseText("mesh.*, targets.*, rig.* and the MakeHuman-derived parts of spec.json"),
  }, ["mesh.json", "mesh.bin", "targets.json", "targets.bin", "rig.json", "rig.bin"], ["spec.json"], "makehuman-hm08");
  console.log(`rig: ${rig.meta.slJoints.length} SL joints, ${Object.keys(rig.meta.joints).length} MakeHuman joints, ${rig.meta.stats.zeroWeightVertices} unweighted vertices, ${(rig.bin.length / 1024).toFixed(0)} KB`);
  console.log(`core: ${morphCount} morph verts, ${mesh.renderToMorph.length} render verts, ${mesh.indices.length / 3} tris; ${targets.length} targets (${kb(mp.bin.length + tp.bin.length)}), ${spec.sliders.length} sliders`);
}

// ---- lazy packs --------------------------------------------------------------------------------------------------
const modifiers = JSON.parse(readFileSync(join(data, "modifiers/modeling_modifiers.json"), "utf8")) as RawGroup[];

function writeLazyPack(info: { id: string; label: string; description: string }, refs: TargetRef[], fragment: SpecFragment): void {
  const targets = loadTargets(refs);
  const empty = targets.filter((t) => t.indices.length === 0).map((t) => t.id);
  const tp = encodeTargetPack(targets, morphCount, provenance);
  const fragmentJson = `${JSON.stringify(fragment)}\n`;
  const targetsJson = `${JSON.stringify(tp.meta)}\n`;
  const sections = [...new Set((fragment.sliders ?? []).map((s) => s.group))];
  const packJson = `${JSON.stringify({
    format: "cm-pack/1", ...info, mesh: MESH_NAME, morphVertexCount: morphCount,
    bytes: tp.bin.length + targetsJson.length + fragmentJson.length,
    sliderCount: (fragment.sliders?.length ?? 0) + (fragment.variables?.length ?? 0),
    sections,
    files: { targetsMeta: "targets.json", targetsBin: "targets.bin", fragment: "fragment.json" },
  })}\n`;
  write(join(ASSETS, `makehuman-hm08-${info.id}`), {
    "targets.json": targetsJson, "targets.bin": tp.bin, "fragment.json": fragmentJson, "pack.json": packJson,
    "LICENSE.txt": licenseText("targets.*"),
  }, ["targets.json", "targets.bin"], ["fragment.json", "pack.json"], `makehuman-hm08-${info.id}`);
  console.log(`${info.id}: ${targets.length} targets (${kb(tp.bin.length)}), ${(fragment.sliders ?? []).length} sliders, ${sections.length} sections${empty.length ? `, ${empty.length} targets touch only helper geometry` : ""}`);
}

writeLazyPack(agePackInfo, ageTargets, agePackFragment);

for (const p of [facePack, bodyPack]) {
  const { sliders, refs } = generateSliders(modifiers, { groups: p.groups, section: p.section, exclude: coreTargetIds });
  writeLazyPack(p, refs, { pack: p.id, sliders });
}
