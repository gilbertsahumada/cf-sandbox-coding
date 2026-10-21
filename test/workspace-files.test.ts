import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  linkSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source = readFileSync(
  new URL("../container/workspace-files.mjs.txt", import.meta.url),
  "utf8",
);
const { workspaceFiles, permittedPath } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "editor-files-"));
  const call = (request: object) => workspaceFiles(root, request);
  return {
    root,
    call,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
test("directory pages explore all repository paths without following links or exposing secrets", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "src"));
    mkdirSync(join(f.root, ".git"));
    writeFileSync(join(f.root, ".env"), "not-readable");
    writeFileSync(join(f.root, ".env.example"), "EXAMPLE=");
    for (let i = 0; i < 205; i++)
      writeFileSync(join(f.root, `file-${i}.ts`), "code");
    symlinkSync("/etc", join(f.root, "external"));
    const first = f.call({ operation: "list", path: "" });
    assert.equal(first.entries.length, 200);
    assert.equal(first.entries[0].kind, "directory");
    const next = f.call({
      operation: "list",
      path: "",
      cursor: first.nextCursor,
    });
    assert.equal(next.nextCursor, null);
    const paths = [...first.entries, ...next.entries].map(
      (file: any) => file.path,
    );
    assert.ok(!paths.includes(".git") && !paths.includes(".env"));
    assert.ok(paths.includes(".env.example"));
    assert.throws(
      () => f.call({ operation: "read", path: "external/passwd" }),
      /Symbolic/,
    );
    for (const path of [
      "../outside",
      "/etc/passwd",
      "src/../../outside",
      "src\\file",
      "a\0b",
      ".git/config",
      ".ssh/config",
      "secret.pem",
      "nested/.env",
      "nested/.aws/config",
    ])
      assert.equal(permittedPath(path), false, path);
  } finally {
    f.dispose();
  }
});
test("optimistic saves preserve UTF-8, CRLF, executable mode and content on conflicts", () => {
  const f = fixture();
  try {
    const path = "script.sh";
    writeFileSync(join(f.root, path), "#!/bin/sh\r\necho café🙂\r\n", {
      mode: 0o755,
    });
    const initial = f.call({ operation: "read", path });
    assert.ok(initial.content.includes("café🙂\r\n"));
    const text = initial.content + "echo done\r\n";
    const saved = f.call({
      operation: "write",
      path,
      version: initial.version,
      content: text,
    });
    assert.equal(readFileSync(join(f.root, path), "utf8"), text);
    assert.equal(statSync(join(f.root, path)).mode & 0o777, 0o755);
    assert.equal(
      f.call({
        operation: "write",
        path,
        version: initial.version,
        content: text,
      }).changed,
      false,
    );
    assert.throws(
      () =>
        f.call({
          operation: "write",
          path,
          version: initial.version,
          content: "overwrite",
        }),
      /changed in the cloud/,
    );
    assert.equal(readFileSync(join(f.root, path), "utf8"), text);
    assert.notEqual(saved.version, initial.version);
  } finally {
    f.dispose();
  }
});
test("binary, oversized, symlinked and hard-linked files fail without altering their targets", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "binary"), Buffer.from([0, 1, 2]));
    writeFileSync(join(f.root, "large"), "x".repeat(262145));
    writeFileSync(join(f.root, "regular"), "original");
    linkSync(join(f.root, "regular"), join(f.root, "alias"));
    symlinkSync(join(f.root, "binary"), join(f.root, "symlink"));
    for (const path of ["binary", "large", "alias", "symlink"])
      assert.throws(() => f.call({ operation: "read", path }));
    assert.equal(readFileSync(join(f.root, "regular"), "utf8"), "original");
  } finally {
    f.dispose();
  }
});

test("manual edits survive checkpoint restoration alongside the native agent context", async () => {
  // @ts-expect-error Standalone Node module used by the cloud container.
  const { saveCheckpoint, restoreCheckpoint } = await import(
    "../container/workspace-checkpoint.mjs"
  );
  const f = fixture();
  try {
    const repo = join(f.root, "repo");
    mkdirSync(repo);
    mkdirSync(join(f.root, "conversation"));
    writeFileSync(join(repo, "file.ts"), "before\n");
    writeFileSync(join(f.root, "conversation/session.jsonl"), "native context");
    const initial = workspaceFiles(repo, {
      operation: "read",
      path: "file.ts",
    });
    workspaceFiles(repo, {
      operation: "write",
      path: "file.ts",
      version: initial.version,
      content: "edited\n",
    });
    const archive = join(f.root, "checkpoint.b64");
    writeFileSync(archive, saveCheckpoint(f.root));
    rmSync(repo, { recursive: true });
    rmSync(join(f.root, "conversation"), { recursive: true });
    restoreCheckpoint(archive, f.root);
    assert.equal(
      workspaceFiles(repo, { operation: "read", path: "file.ts" }).content,
      "edited\n",
    );
    assert.equal(
      readFileSync(join(f.root, "conversation/session.jsonl"), "utf8"),
      "native context",
    );
  } finally {
    f.dispose();
  }
});
