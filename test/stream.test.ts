import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { logCursor, eventFrame } from "../src/event-stream";
// @ts-expect-error Container helpers are plain JavaScript.
import { completeUtf8Length } from "../container/follow-task.mjs";
// @ts-expect-error Container helpers are plain JavaScript.
import { stopTaskProcess } from "../container/stop-task.mjs";
// @ts-expect-error Container helpers are plain JavaScript.
import { openCodeEvents } from "../container/opencode-events.mjs";

test("log cursors accept byte offsets and reject unsafe or injected values", () => {
  assert.equal(logCursor("0012:34"), "12:34");
  for (const value of [
    "",
    "-1:0",
    "1.5:0",
    "1:2:3",
    "9007199254740992:0",
    "0:0\nevent: done",
    "../log",
  ])
    assert.equal(logCursor(value), null);
});
test("SSE data encoding cannot introduce another protocol frame", () => {
  const text = new TextDecoder().decode(
    eventFrame("stdout", "a\n\nevent: done\ndata: bad"),
  );
  assert.equal(
    text.split("\n").filter((line) => line.startsWith("event:")).length,
    1,
  );
  assert.equal(
    JSON.parse(
      text
        .split("\n")
        .find((line) => line.startsWith("data:"))!
        .slice(6),
    ),
    "a\n\nevent: done\ndata: bad",
  );
});
test("UTF-8 boundaries never split accented characters or emoji across resumable cursors", () => {
  const bytes = Buffer.from("aé🙂終");
  for (let end = 0; end <= bytes.length; end++) {
    const chunk = bytes.subarray(0, end),
      length = completeUtf8Length(chunk);
    assert.doesNotThrow(() =>
      new TextDecoder("utf8", { fatal: true }).decode(
        chunk.subarray(0, length),
      ),
    );
  }
});
function watchOutput(child: ReturnType<typeof spawn>) {
  let buffered = "",
    frames: any[] = [];
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (text) => {
    buffered += text;
    let boundary;
    while ((boundary = buffered.indexOf("\n\n")) >= 0) {
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      if (frame.startsWith(":")) continue;
      const fields = Object.fromEntries(
        frame
          .split("\n")
          .map((line) => [
            line.slice(0, line.indexOf(":")),
            line.slice(line.indexOf(":") + 1).trimStart(),
          ]),
      );
      frames.push({
        type: fields.event,
        id: fields.id,
        data: JSON.parse(fields.data),
      });
    }
  });
  return frames;
}
async function waitFor(check: () => boolean) {
  const until = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > until) throw Error("Timed out waiting for live output");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
test(
  "observer streams before exit and resumes without duplicates after disconnect",
  { timeout: 10000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cf-sse-"));
    const first = "first é\n",
      second = "second 🙂\n";
    let observer;
    try {
      await writeFile(join(directory, "stdout.log"), first);
      await writeFile(join(directory, "stderr.log"), "");
      observer = spawn(
        process.execPath,
        ["container/follow-task.mjs", directory, "0:0"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const frames = watchOutput(observer);
      await waitFor(() => frames.some((x) => x.type === "stdout"));
      assert.equal(frames[0].data, first);
      const cursor = frames.at(-1).id;
      observer.kill();
      await once(observer, "exit");
      // The independent task files keep receiving output after the observer disconnects.
      await writeFile(join(directory, "stdout.log"), first + second);
      await writeFile(join(directory, "stderr.log"), "warning\n");
      await writeFile(join(directory, "exit-code"), "0");
      observer = spawn(
        process.execPath,
        ["container/follow-task.mjs", directory, cursor],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const resumed = watchOutput(observer);
      const [code] = await once(observer, "exit");
      assert.equal(code, 0);
      assert.equal(
        resumed
          .filter((x) => x.type === "stdout")
          .map((x) => x.data)
          .join(""),
        second,
      );
      assert.equal(
        resumed
          .filter((x) => x.type === "stderr")
          .map((x) => x.data)
          .join(""),
        "warning\n",
      );
    } finally {
      observer?.kill();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test(
  "shutdown verifies the boot identifier and signals only a detached task process group",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cf-stop-"));
    const bootPath = join(directory, "boot");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      detached: true,
      stdio: "ignore",
    });
    try {
      await writeFile(bootPath, "current-boot");
      await writeFile(join(directory, "pid"), `${child.pid} stale-boot`);
      await stopTaskProcess(directory, bootPath);
      assert.doesNotThrow(() => process.kill(child.pid!, 0));
      await writeFile(join(directory, "pid"), `${child.pid} current-boot`);
      const exited = once(child, "exit");
      await stopTaskProcess(directory, bootPath);
      const [, signal] = await exited;
      assert.equal(signal, "SIGTERM");
    } finally {
      try {
        child.kill();
      } catch {}
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test("OpenCode emits tool progress and assistant text while excluding user and reasoning parts", () => {
  const normalize = openCodeEvents("session");
  const part = (id: string, type: string, messageID: string, text = "") => ({
    type: "message.part.updated",
    properties: { part: { sessionID: "session", id, type, messageID, text } },
  });
  assert.deepEqual(
    normalize(part("user-part", "text", "user", "private-user-message")),
    [],
  );
  normalize({
    type: "message.updated",
    properties: {
      info: { sessionID: "session", id: "assistant", role: "assistant" },
    },
  });
  assert.deepEqual(
    normalize(part("reason", "reasoning", "assistant", "internal-state")),
    [],
  );
  assert.deepEqual(
    normalize({
      type: "message.part.delta",
      properties: {
        sessionID: "session",
        messageID: "assistant",
        partID: "reason",
        field: "text",
        delta: "more-internal-state",
      },
    }),
    [],
  );
  normalize(part("text", "text", "assistant", "hello"));
  const delta = normalize({
    type: "message.part.delta",
    properties: {
      sessionID: "session",
      messageID: "assistant",
      partID: "text",
      field: "text",
      delta: " world",
    },
  });
  assert.equal(delta[0].part.text, "hello world");
  const tool = {
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool",
        sessionID: "session",
        type: "tool",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "echo test" },
          metadata: { output: "partial" },
        },
      },
    },
  };
  const events = normalize(tool);
  assert.deepEqual(
    events.map((x) => x.type),
    ["tool_execution_start", "tool_execution_update"],
  );
  assert.equal(events[0].toolCallId, "tool");
  assert.deepEqual(normalize(tool), []);
});
