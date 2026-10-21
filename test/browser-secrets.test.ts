import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserSecretLeaks } from "../scripts/check-browser-secrets.mjs";

test("browser credential auditing reports locations without printing values", async () => {
  const root = await mkdtemp(join(tmpdir(), "runner-browser-audit-"));
  try {
    await mkdir(join(root, "assets"));
    const canary = crypto.randomUUID();
    await writeFile(
      join(root, "assets", "leak.js"),
      `const accidental = ${JSON.stringify(canary)}`,
    );
    const result = await browserSecretLeaks(root, { MODEL_API_KEY: canary });
    assert.deepEqual(result, [
      { file: join("assets", "leak.js"), kind: "MODEL_API_KEY" },
    ]);
    assert.equal(JSON.stringify(result).includes(canary), false);
    await writeFile(
      join(root, "assets", "leak.js"),
      "const safe = 'public UI';",
    );
    assert.deepEqual(
      await browserSecretLeaks(root, { MODEL_API_KEY: canary }),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
