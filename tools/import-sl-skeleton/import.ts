// Fetch the Second Life viewer's avatar_skeleton.xml at a pinned commit and generate packages/skeleton/src/generated/sl-skeleton.json.
// Usage: node tools/import-sl-skeleton/import.ts [--check] [--xml <local file>] [--ref <commit sha>]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseLadXml } from "./parseLad.ts";
import { parseSkeletonXml } from "./parse.ts";

/** Pinned so generation is reproducible; bump deliberately and re-run the tests. */
const PINNED_REF = "18648fc51e2a0c750182d8aa3814ed5b6bf8445e";
const FILE = "indra/newview/character/avatar_skeleton.xml";
const LAD_FILE = "indra/newview/character/avatar_lad.xml";
const OUT = new URL("../../packages/skeleton/src/generated/sl-skeleton.json", import.meta.url);
const OUT_SHAPE = new URL("../../packages/skeleton/src/generated/sl-shape.json", import.meta.url);

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ref = opt("--ref") ?? PINNED_REF;
const localXml = opt("--xml");
const localLad = opt("--lad");
const url = `https://raw.githubusercontent.com/secondlife/viewer/${ref}/${FILE}`;
const ladUrl = `https://raw.githubusercontent.com/secondlife/viewer/${ref}/${LAD_FILE}`;
const fetchText = (u: string) => execFileSync("curl", ["-fsSL", "--max-time", "120", u], { encoding: "utf8", maxBuffer: 64e6 });

const xml = localXml ? readFileSync(localXml, "utf8") : fetchText(url);
const lad = localLad ? readFileSync(localLad, "utf8") : fetchText(ladUrl);
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
const shapeData = {
  source: {
    repo: "https://github.com/secondlife/viewer",
    ref,
    file: LAD_FILE,
    sha256: createHash("sha256").update(lad).digest("hex"),
    license: "LGPL-2.1-only (repository license; the file carries no separate notice)",
    note: "Derived table: only the visual parameters that move bones/collision volumes, and the drivers that reach them. Regenerate with tools/import-sl-skeleton.",
  },
  ...parseLadXml(lad),
};
const shapeText = `${JSON.stringify(shapeData, null, 1)}\n`;
if (args.includes("--check")) {
  const stale = readFileSync(OUT, "utf8") !== text || readFileSync(OUT_SHAPE, "utf8") !== shapeText;
  if (stale) { console.error("generated skeleton/shape tables are out of date with the pinned source"); process.exit(1); }
  console.log("sl-skeleton.json and sl-shape.json match pinned source");
} else {
  writeFileSync(OUT, text);
  writeFileSync(OUT_SHAPE, shapeText);
  console.log(`wrote ${rest.joints.length} bones, ${rest.collisionVolumes.length} collision volumes, ${shapeData.params.length} shape params from ${localXml ?? url}`);
}
