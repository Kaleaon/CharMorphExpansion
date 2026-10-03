import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssetsDir, sha256, validateManifest } from "../src/manifest.ts";

const good = (over: object = {}) => ({
  path: "a.txt", sha256: sha256(Buffer.from("hi")), license: "CC0-1.0",
  author: "Someone", sourceUrl: "https://example.com/a", ...over,
});

describe("validateManifest", () => {
  it("accepts a CC0 entry", () => {
    expect(validateManifest({ pack: "p", files: [good()] }, "m")).toEqual([]);
  });
  it.each(["AGPL-3.0-only", "GPL-3.0-or-later", "LGPL-2.1-only", "CC-BY-NC-4.0", "NOASSERTION"])(
    "rejects %s", (license) => {
      const p = validateManifest({ pack: "p", files: [good({ license })] }, "m");
      expect(p.some((x) => x.message.includes("not allowed"))).toBe(true);
    });
  it("accepts CC-BY-SA with attribution (anatomy-pack exception, approved 2026-10-03)", () => {
    const p = validateManifest({ pack: "p", files: [good({ license: "CC-BY-SA-4.0" })] }, "m");
    expect(p.some((x) => x.message.includes("attribution"))).toBe(true);
    expect(validateManifest({ pack: "p", files: [good({ license: "CC-BY-SA-4.0", attribution: "Z-Anatomy contributors, CC-BY-SA-4.0" })] }, "m")).toEqual([]);
  });
  it("requires attribution for CC-BY", () => {
    const p = validateManifest({ pack: "p", files: [good({ license: "CC-BY-4.0" })] }, "m");
    expect(p.some((x) => x.message.includes("attribution"))).toBe(true);
    expect(validateManifest({ pack: "p", files: [good({ license: "CC-BY-4.0", attribution: "By X" })] }, "m")).toEqual([]);
  });
  it("rejects path traversal, bad hash, bad url, duplicates", () => {
    const p = validateManifest({ pack: "p", files: [good({ path: "../x", sha256: "zz", sourceUrl: "ftp://x" }), good(), good()] }, "m");
    const msgs = p.map((x) => x.message).join("|");
    expect(msgs).toContain("relative");
    expect(msgs).toContain("sha256");
    expect(msgs).toContain("sourceUrl");
    expect(msgs).toContain("duplicate");
  });
});

describe("checkAssetsDir", () => {
  const mk = () => {
    const root = mkdtempSync(join(tmpdir(), "assets-"));
    mkdirSync(join(root, "pack"));
    writeFileSync(join(root, "pack", "a.txt"), "hi");
    return root;
  };
  it("passes with a matching manifest", () => {
    const root = mk();
    writeFileSync(join(root, "pack", "MANIFEST.json"), JSON.stringify({ pack: "pack", files: [good()] }));
    expect(checkAssetsDir(root)).toEqual([]);
  });
  it("flags missing manifest, unlisted files, hash mismatch, missing files", () => {
    const root = mk();
    expect(checkAssetsDir(root)[0]?.message).toContain("no MANIFEST.json");
    writeFileSync(join(root, "pack", "MANIFEST.json"), JSON.stringify({ pack: "pack", files: [good({ sha256: "0".repeat(64) }), good({ path: "gone.txt" })] }));
    writeFileSync(join(root, "pack", "extra.bin"), "x");
    const msgs = checkAssetsDir(root).map((p) => p.message).join("|");
    expect(msgs).toContain("sha256 mismatch");
    expect(msgs).toContain("missing on disk");
    expect(msgs).toContain("not listed");
  });
  it("returns nothing for a missing assets dir", () => {
    expect(checkAssetsDir("/nonexistent-assets-dir")).toEqual([]);
  });
});
