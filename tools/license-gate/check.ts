// CI gate: every file under assets/ must be listed in a pack MANIFEST.json with an allowed license.
import { resolve } from "node:path";
import { checkAssetsDir } from "../../packages/assets/src/manifest.ts";

const root = resolve(process.argv[2] ?? new URL("../../assets", import.meta.url).pathname);
const problems = checkAssetsDir(root);
if (problems.length) {
  console.error(`license-gate: ${problems.length} problem(s) in ${root}`);
  for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
  process.exit(1);
}
console.log(`license-gate: OK (${root})`);
