import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiff,
  assistantStream,
  githubPullRequestURL,
} from "../web/lib/editor.ts";

test("diff tabs retain file status and independent before/after line numbers", () => {
  const files = parseDiff(
    "diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n@@ -8,2 +8,3 @@\n old\n-before\n+after\n+extra\ndiff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+created\n",
  );
  assert.deepEqual(
    files.map(({ path, status, added, removed }) => ({
      path,
      status,
      added,
      removed,
    })),
    [
      { path: "code.ts", status: "M", added: 2, removed: 1 },
      { path: "new.ts", status: "A", added: 1, removed: 0 },
    ],
  );
  assert.deepEqual(files[0].lines.slice(-4), [
    { text: " old", kind: "context", before: 8, after: 8 },
    { text: "-before", kind: "remove", before: 9 },
    { text: "+after", kind: "add", after: 9 },
    { text: "+extra", kind: "add", after: 10 },
  ]);
});
test("deleted, binary, quoted UTF-8 and renamed paths remain selectable", () => {
  const patch =
    'diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\ndiff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ\ndiff --git "a/ma\\303\\261ana.ts" "b/ma\\303\\261ana.ts"\n--- "a/ma\\303\\261ana.ts"\n+++ "b/ma\\303\\261ana.ts"\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/old b/a/new\nsimilarity index 100%\nrename from old\nrename to a/new\n';
  assert.deepEqual(
    parseDiff(patch).map(({ path, status }) => [path, status]),
    [
      ["old.ts", "D"],
      ["icon.png", "M"],
      ["mañana.ts", "M"],
      ["a/new", "R"],
    ],
  );
  assert.deepEqual(parseDiff(""), []);
});
test("assistant streaming handles split records and excludes user, reasoning and tools", () => {
  const rendered: string[] = [],
    stream = assistantStream((text) => rendered.push(text));
  const records = [
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hola " },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "private reasoning",
      },
    },
    {
      type: "message_end",
      message: {
        role: "user",
        content: [{ type: "text", text: "user input" }],
      },
    },
    { type: "tool_execution_end", result: "tool output" },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "<img src=x>" },
    },
  ]
    .map((event) => JSON.stringify(event) + "\n")
    .join("");
  stream.push(records.slice(0, 50));
  stream.push(records.slice(50));
  assert.equal(rendered.at(-1), "Hola <img src=x>");
  assert.ok(
    rendered.every(
      (text) => !/private reasoning|user input|tool output/.test(text),
    ),
  );
  stream.reset();
  stream.push(
    JSON.stringify({ type: "text", part: { text: "OpenCode response" } }) +
      "\n",
  );
  assert.equal(rendered.at(-1), "OpenCode response");
});
test("PR links allow only GitHub pull requests", () => {
  assert.equal(
    githubPullRequestURL("https://github.com/owner/project/pull/42"),
    "https://github.com/owner/project/pull/42",
  );
  for (const value of [
    "javascript:alert(1)",
    "https://github.com.evil.test/a/b/pull/1",
    "https://user:pass@github.com/a/b/pull/1",
    "https://github.com/a/b/issues/1",
    "/relative",
  ])
    assert.equal(githubPullRequestURL(value), null);
});
