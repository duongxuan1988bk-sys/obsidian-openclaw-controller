import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outdir = path.join(process.cwd(), ".tmp-tests");

const obsidianTestStubPlugin = {
  name: "obsidian-test-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-stub", namespace: "test-stub" }));
    build.onLoad({ filter: /^obsidian-stub$/, namespace: "test-stub" }, () => ({
      loader: "ts",
      contents: `
        export class TFile {}
        export class TFolder {}
        export function normalizePath(path) {
          return String(path).split("\\\\").join("/");
        }
        export function parseYaml(yaml) { return yaml; }
      `
    }));
  }
};

await fs.mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [
    "tests/validation.test.ts",
    "tests/linking.test.ts",
    "tests/schemaGuard.test.ts",
    "tests/frontmatterDateRules.test.ts",
    "tests/markitdown.test.ts",
    "tests/promoteToOriginalContent.test.ts"
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outdir,
  logLevel: "silent",
  plugins: [obsidianTestStubPlugin]
});

await import(pathToFileURL(path.join(outdir, "validation.test.js")).href);
await import(pathToFileURL(path.join(outdir, "linking.test.js")).href);
await import(pathToFileURL(path.join(outdir, "schemaGuard.test.js")).href);
await import(pathToFileURL(path.join(outdir, "frontmatterDateRules.test.js")).href);
await import(pathToFileURL(path.join(outdir, "markitdown.test.js")).href);
await import(pathToFileURL(path.join(outdir, "promoteToOriginalContent.test.js")).href);
console.log("Regression tests passed.");
