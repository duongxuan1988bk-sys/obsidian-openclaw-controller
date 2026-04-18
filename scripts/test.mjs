import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outdir = path.join(process.cwd(), ".tmp-tests");

await fs.mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["tests/validation.test.ts", "tests/linking.test.ts", "tests/schemaGuard.test.ts", "tests/frontmatterDateRules.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outdir,
  logLevel: "silent"
});

await import(pathToFileURL(path.join(outdir, "validation.test.js")).href);
await import(pathToFileURL(path.join(outdir, "linking.test.js")).href);
await import(pathToFileURL(path.join(outdir, "schemaGuard.test.js")).href);
await import(pathToFileURL(path.join(outdir, "frontmatterDateRules.test.js")).href);
console.log("Regression tests passed.");
