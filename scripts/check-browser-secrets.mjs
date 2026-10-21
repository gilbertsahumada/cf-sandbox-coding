import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const credentialPatterns = [
  ["GitHub credential", /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{24,}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
/** Report only paths and categories; never echo matching credential values. */
export async function browserSecretLeaks(root, canaries = {}) {
  const leaks = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        [".js", ".css", ".html", ".json", ".map"].includes(extname(path))
      ) {
        const source = await readFile(path, "utf8");
        for (const [name, value] of Object.entries(canaries))
          if (value && source.includes(value))
            leaks.push({ file: relative(root, path), kind: name });
        for (const [name, pattern] of credentialPatterns)
          if (pattern.test(source))
            leaks.push({ file: relative(root, path), kind: name });
      }
    }
  }
  await visit(root);
  return leaks;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // These generated values are disposable audit markers, never real account secrets.
  const canaries = Object.fromEntries(
    [
      "MODEL_API_KEY",
      "RUNNER_API_TOKEN",
      "WEB_ACCESS_CODE",
      "DEMO_ACCESS_CODE",
    ].map((name) => [name, `audit-only-${randomBytes(24).toString("hex")}`]),
  );
  const result = spawnSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build"],
    { env: { ...process.env, ...canaries }, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  const leaks = await browserSecretLeaks(resolve("dist/ui"), canaries);
  if (leaks.length) {
    console.error("Browser secret audit failed:", leaks);
    process.exit(1);
  }
  console.log(
    "PASS: server-secret audit markers and credential patterns absent from browser assets.",
  );
}
