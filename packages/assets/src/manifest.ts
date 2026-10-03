import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** SPDX ids allowed for anything shipped in `assets/`. */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

/** Licenses that need attribution text in the manifest. */
const ATTRIBUTION_REQUIRED = /^(CC-BY|MIT|Apache|BSD|ISC)/;

export interface ManifestFile {
  /** Path relative to the manifest's directory, forward slashes. */
  path: string;
  sha256: string;
  license: string;
  author: string;
  sourceUrl: string;
  attribution?: string;
}

export interface Manifest {
  pack: string;
  files: ManifestFile[];
}

export interface Problem {
  where: string;
  message: string;
}

const SKIP_NAMES = new Set(["MANIFEST.json", "README.md", "LICENSE", "LICENSE.txt"]);

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Pure validation of one manifest's content (no disk access). */
export function validateManifest(m: unknown, where: string): Problem[] {
  const out: Problem[] = [];
  const bad = (message: string) => out.push({ where, message });
  if (typeof m !== "object" || m === null) return [{ where, message: "manifest is not an object" }];
  const man = m as Partial<Manifest>;
  if (typeof man.pack !== "string" || !man.pack) bad("missing `pack`");
  if (!Array.isArray(man.files)) return [...out, { where, message: "missing `files` array" }];
  const seen = new Set<string>();
  for (const [i, f] of man.files.entries()) {
    const at = `${where}#${f?.path ?? i}`;
    const b = (message: string) => out.push({ where: at, message });
    if (!f || typeof f.path !== "string" || !f.path) { b("missing `path`"); continue; }
    if (f.path.includes("..") || f.path.startsWith("/")) b("path must be relative and inside the pack");
    if (seen.has(f.path)) b("duplicate path");
    seen.add(f.path);
    if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? "")) b("`sha256` must be 64 hex chars");
    if (!f.author) b("missing `author`");
    if (!/^https?:\/\//.test(f.sourceUrl ?? "")) b("`sourceUrl` must be an http(s) URL");
    if (!f.license) b("missing `license`");
    else if (!ALLOWED_LICENSES.has(f.license)) b(`license "${f.license}" is not allowed in assets/`);
    else if (ATTRIBUTION_REQUIRED.test(f.license) && !f.attribution) b("attribution text required for this license");
  }
  return out;
}

function walk(dir: string): string[] {
  const res: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) res.push(...walk(p));
    else res.push(p);
  }
  return res;
}

/**
 * Check every pack (a directory under `assetsRoot`): it needs a MANIFEST.json, the manifest must be valid,
 * every file on disk must be listed with a matching hash, and nothing listed may be missing.
 */
export function checkAssetsDir(assetsRoot: string): Problem[] {
  const out: Problem[] = [];
  if (!existsSync(assetsRoot)) return out;
  for (const pack of readdirSync(assetsRoot)) {
    const dir = join(assetsRoot, pack);
    if (!statSync(dir).isDirectory()) {
      if (!SKIP_NAMES.has(pack) && pack !== ".gitkeep") out.push({ where: dir, message: "loose file in assets/ root; put it in a pack with a MANIFEST.json" });
      continue;
    }
    const mpath = join(dir, "MANIFEST.json");
    if (!existsSync(mpath)) { out.push({ where: dir, message: "pack has no MANIFEST.json" }); continue; }
    let manifest: Manifest;
    try { manifest = JSON.parse(readFileSync(mpath, "utf8")); }
    catch (e) { out.push({ where: mpath, message: `invalid JSON: ${(e as Error).message}` }); continue; }
    const problems = validateManifest(manifest, mpath);
    out.push(...problems);
    if (!Array.isArray(manifest.files)) continue;
    const listed = new Map(manifest.files.map((f) => [f.path, f]));
    for (const file of walk(dir)) {
      const rel = relative(dir, file).split(sep).join("/");
      if (SKIP_NAMES.has(rel)) continue;
      const entry = listed.get(rel);
      if (!entry) { out.push({ where: file, message: "file not listed in MANIFEST.json" }); continue; }
      if (entry.sha256 && sha256(readFileSync(file)) !== entry.sha256) out.push({ where: file, message: "sha256 mismatch with MANIFEST.json" });
    }
    for (const rel of listed.keys()) if (!existsSync(join(dir, rel))) out.push({ where: join(dir, rel), message: "listed in MANIFEST.json but missing on disk" });
  }
  return out;
}
