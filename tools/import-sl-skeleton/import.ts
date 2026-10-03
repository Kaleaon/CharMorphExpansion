// Fetch the Second Life viewer's avatar_skeleton.xml at a pinned commit and generate packages/skeleton/src/generated/sl-skeleton.json.
// Usage: node tools/import-sl-skeleton/import.ts [--check] [--xml <local file>] [--ref <commit sha>]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseSkeletonXml } from "./parse.ts";

/** Pinned so generation is reproducible; bump deliberately and re-run the tests. */
const PINNED_REF = "18648fc51e2a0c750182d8aa3814ed5b6bf8445e";
const FILE = "indra/newview/character/avatar_skeleton.xml";
const OUT = new URL("../../packages/skeleton/src/generated/sl-skeleton.json", import.meta.url);

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ref = opt("--ref") ?? PINNED_REF;
const localXml = opt("--xml");
const url = `https://raw.githubusercontent.com/secondlife/viewer/${ref}/${FILE}`;

const xml = localXml ? readFileSync(localXml, "utf8") : execFileSync("curl", ["-fsSL", "--max-time", "60", url], { encoding: "utf8", maxBuffer: 16e6 });
const parsed = parseSkeletonXml(xml);
const { declared, ...rest } = parsed;
if (declared.bones !== rest.joints.length || declared.collisionVolumes !== rest.collisionVolumes.length) {
  throw new Error(`XML header (${declared.bones} bones, ${declared.collisionVolumes} CVs) disagrees with parsed content (${rest.joints.length}, ${rest.collisionVolumes.length})`);
}
const data = {
  source: {
    repo: "https://github.com/secondlife/viewer",
    ref,
    file: FILE,
    sha256: createHash("sha256").update(xml).digest("hex"),
    license: "LGPL-2.1-only (repository license; the file carries no separate notice)",
    note: "Derived table: names, hierarchy and rest transforms only. Regenerate with tools/import-sl-skeleton.",
  },
  ...rest,
};
const text = `${JSON.stringify(data, null, 1)}\n`;
if (args.includes("--check")) {
  const cur = readFileSync(OUT, "utf8");
  if (cur !== text) { console.error("sl-skeleton.json is out of date with the pinned source"); process.exit(1); }
  console.log("sl-skeleton.json matches pinned source");
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${rest.joints.length} bones, ${rest.collisionVolumes.length} collision volumes from ${localXml ?? url}`);
}
