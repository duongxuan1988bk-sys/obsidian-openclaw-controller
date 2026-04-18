import { spawn } from "node:child_process";

function run(cmd, args) {
  const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  p.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  return p;
}

const tailwind = run("./node_modules/.bin/tailwindcss", ["-i", "./src/styles.css", "-o", "./styles.css", "--watch"]);
const esbuild = run("node", ["./esbuild.config.mjs", "--sourcemap=inline", "--watch"]);

process.on("SIGINT", () => {
  tailwind.kill("SIGINT");
  esbuild.kill("SIGINT");
  process.exit(0);
});

