import esbuild from "esbuild";
import fs from "node:fs";

const isProd = process.argv.includes("--prod");

/** @type {esbuild.BuildOptions} */
const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  external: ["obsidian", "child_process"],
  outfile: "main.js",
  sourcemap: isProd ? false : "inline",
  minify: isProd,
  logLevel: "info"
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(opts);
}

// Ensure an empty styles.css exists when build:css wasn't run yet
if (!fs.existsSync("styles.css")) {
  fs.writeFileSync("styles.css", "");
}

