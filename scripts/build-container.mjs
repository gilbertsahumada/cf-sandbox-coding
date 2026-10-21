import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
rmSync(new URL("dist/container", root), { recursive: true, force: true });
// NodeNext emits .mts as .mjs, keeping existing /opt command paths and imports stable.
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("node_modules/typescript/bin/tsc", root)),
    "-p",
    fileURLToPath(new URL("container/tsconfig.json", root)),
  ],
  { stdio: "inherit" },
);
mkdirSync(new URL("dist/container", root), { recursive: true });
// Wrangler embeds the compiled, standalone helper for already-running containers too.
copyFileSync(
  new URL("dist/container/workspace-files.mjs", root),
  new URL("dist/container/workspace-files.mjs.txt", root),
);
