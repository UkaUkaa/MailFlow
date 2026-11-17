// Serves the production build exactly as the Docker image does (standalone output).
// Used by Playwright; `next start` does not support `output: "standalone"`.
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `pnpm build` first.");
  process.exit(1);
}
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}
const child = spawn(process.execPath, ["server.js"], { cwd: standalone, stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
