import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentTimeline,
  emptyTimeline,
  retainTimelines,
} from "../web/lib/agent-timeline";
// Exercise the same normalized OpenCode events consumed by the production browser.
import { openCodeEvents } from "../container/opencode-events.mts";
const lines = (...events: unknown[]) =>
  events.map((value) => JSON.stringify(value)).join("\n") + "\n";
test("Pi preserves interleaved assistant messages and updates one tool row across fragmented chunks", () => {
  let snapshot = emptyTimeline();
  const stream = createAgentTimeline((value) => (snapshot = value));
  const source = lines(
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "I will inspect." },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I will inspect." }],
      },
    },
    {
      type: "tool_execution_start",
      toolCallId: "one",
      toolName: "bash",
      args: { command: "npm test" },
    },
    {
      type: "tool_execution_update",
      toolCallId: "one",
      partialResult: { content: [{ type: "text", text: "Running tests" }] },
    },
    {
      type: "tool_execution_end",
      toolCallId: "one",
      result: { content: [{ type: "text", text: "Passed" }] },
    },
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Done." },
    },
  );
  for (let i = 0; i < source.length; i += 13)
    stream.push(source.slice(i, i + 13));
  assert.deepEqual(
    snapshot.items.map((item) => item.kind),
    ["text", "tool", "text"],
  );
  assert.equal(
    snapshot.items[0].kind === "text" && snapshot.items[0].text,
    "I will inspect.",
  );
  assert.equal(
    snapshot.items[1].kind === "tool" && snapshot.items[1].output,
    "Passed",
  );
  assert.equal(
    snapshot.items[1].kind === "tool" && snapshot.items[1].state,
    "completed",
  );
});
test("OpenCode part IDs retain distinct messages around live tool output", () => {
  let snapshot = emptyTimeline();
  const stream = createAgentTimeline((value) => (snapshot = value));
  const normalize = openCodeEvents("session");
  const push = (event: any) => stream.push(lines(...normalize(event)));
  push({
    type: "message.updated",
    properties: {
      info: { id: "assistant", role: "assistant", sessionID: "session" },
    },
  });
  for (const [id, text] of [
    ["intro", "Inspecting files."],
    ["final", "Done."],
  ]) {
    push({
      type: "message.part.updated",
      properties: {
        part: {
          id,
          type: "text",
          sessionID: "session",
          messageID: "assistant",
          text,
        },
      },
    });
    if (id === "intro") {
      push({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool",
            type: "tool",
            sessionID: "session",
            messageID: "assistant",
            tool: "read",
            state: {
              status: "running",
              input: { filePath: "/workspace/repo/README.md" },
              metadata: { output: "Loading" },
            },
          },
        },
      });
      push({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool",
            type: "tool",
            sessionID: "session",
            messageID: "assistant",
            tool: "read",
            state: { status: "completed", output: "File contents" },
          },
        },
      });
    }
  }
  stream.push(lines({ type: "text", part: { text: "Done." } }));
  push({
    type: "message.part.delta",
    properties: {
      sessionID: "session",
      messageID: "assistant",
      partID: "final",
      field: "text",
      delta: " Ready for review.",
    },
  });
  assert.equal(
    snapshot.items[2].kind === "text" && snapshot.items[2].text,
    "Done. Ready for review.",
  );
  assert.deepEqual(
    snapshot.items.map((item) => item.kind),
    ["text", "tool", "text"],
  );
  assert.equal(
    snapshot.items[1].kind === "tool" && snapshot.items[1].label,
    "read README.md",
  );
});
test("ignored internal events do not publish updates, but an incomplete archived entry does", () => {
  let updates = 0;
  let snapshot = emptyTimeline();
  const stream = createAgentTimeline((value) => {
    updates++;
    snapshot = value;
  });
  stream.reset(true);
  const initialUpdates = updates;
  stream.push(
    lines({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "internal" },
    }),
  );
  assert.equal(updates, initialUpdates);
  stream.push('{"type":');
  stream.finish();
  assert.equal(snapshot.omitted, true);
  assert.equal(updates, initialUpdates + 1);
  assert.equal(snapshot.items.length, 0);
});
test("reset/replay avoids duplicates, ignores internal and user events, and labels missing archived results without claiming failure", () => {
  let snapshot = emptyTimeline();
  const stream = createAgentTimeline((value) => (snapshot = value));
  const events = lines(
    {
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "private user input" }],
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "internal state",
      },
    },
    {
      type: "tool_execution_start",
      toolCallId: "one",
      toolName: "read",
      args: { path: "file.ts" },
    },
  );
  stream.push(events);
  stream.reset(true);
  stream.push("partial previous entry\n" + events);
  stream.finish();
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.archived, true);
  assert.equal(snapshot.omitted, true);
  assert.equal(
    snapshot.items[0].kind === "tool" && snapshot.items[0].state,
    "unavailable",
  );
  assert.equal(JSON.stringify(snapshot).includes("internal state"), false);
  assert.equal(JSON.stringify(snapshot).includes("private user input"), false);
});
test("tool failures are explicit, snapshots stay immutable, and large streams have bounded memory", () => {
  let snapshot = emptyTimeline();
  const stream = createAgentTimeline((value) => (snapshot = value));
  stream.push(
    lines({
      type: "tool_execution_start",
      toolCallId: "one",
      toolName: "bash",
    }),
  );
  const earlier = snapshot;
  stream.push(
    lines({
      type: "tool_execution_end",
      toolCallId: "one",
      isError: true,
      result: { content: [{ type: "text", text: "Failed" }] },
    }),
  );
  assert.equal(
    earlier.items[0].kind === "tool" && earlier.items[0].state,
    "running",
  );
  assert.equal(
    snapshot.items[0].kind === "tool" && snapshot.items[0].state,
    "error",
  );
  for (let i = 0; i < 500; i++)
    stream.push(
      lines({
        type: "message_text",
        part: { id: String(i), text: "x".repeat(10000) },
      }),
    );
  assert.ok(JSON.stringify(snapshot).length < 300000);
  assert.equal(snapshot.omitted, true);
  const retained = retainTimelines(
    {
      1: {
        ...emptyTimeline(),
        items: [{ kind: "text", id: "one", text: "x".repeat(2000000) }],
      },
    },
    2,
    snapshot,
  );
  assert.equal(retained[1], undefined);
  assert.equal(retained[2], snapshot);
});
