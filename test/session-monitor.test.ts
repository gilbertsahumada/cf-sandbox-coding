import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SessionMonitor,
  parseSessionSnapshot,
  sessionIsRunning,
} from "../web/lib/session-monitor";
import type { Run } from "../web/lib/types";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("status monitoring bounds parallel reads and deduplicates each session", async () => {
  const reads: { id: string; work: ReturnType<typeof deferred> }[] = [];
  const values: string[] = [];
  const monitor = new SessionMonitor(
    async (id) => {
      const work = deferred();
      reads.push({ id, work });
      return work.promise;
    },
    (id) => values.push(id),
    () => {},
    2,
  );
  const all = monitor.refresh(["a", "b", "c", "a"]);
  const duplicate = monitor.refresh(["a"]);
  assert.deepEqual(
    reads.map((read) => read.id),
    ["a", "b"],
  );
  reads[0].work.resolve({ state: "running", containerRunning: true });
  await tick();
  assert.deepEqual(
    reads.map((read) => read.id),
    ["a", "b", "c"],
  );
  reads[1].work.resolve({ state: "succeeded", containerRunning: true });
  reads[2].work.resolve({ state: "cancelled", containerRunning: false });
  await Promise.all([all, duplicate]);
  assert.deepEqual(values, ["a", "b", "c"]);
  monitor.dispose();
});

test("stopping one session ignores its stale read while other sessions keep updating", async () => {
  const reads = new Map<string, ReturnType<typeof deferred>>();
  const values: [string, unknown][] = [];
  const monitor = new SessionMonitor(
    async (id) => {
      const work = deferred();
      reads.set(id, work);
      return work.promise;
    },
    (id, value) => values.push([id, value]),
    () => {},
  );
  const first = monitor.refresh(["a", "b"]);
  monitor.suspend("a");
  await monitor.refresh(["a"]);
  reads.get("a")!.resolve({ state: "running", containerRunning: true });
  reads.get("b")!.resolve({ state: "running", containerRunning: true });
  await first;
  assert.equal(
    values.filter(([id, value]) => id === "a" && value !== null).length,
    0,
  );
  assert.equal(
    values.filter(([id, value]) => id === "b" && value !== null).length,
    1,
  );
  const resumed = monitor.resume("a");
  reads.get("a")!.resolve({ state: "cancelled", containerRunning: false });
  await resumed;
  assert.equal(
    (values.at(-1)![1] as { containerRunning: boolean }).containerRunning,
    false,
  );
  monitor.dispose();
});

test("unavailable status stays unknown and disposed readers cannot update signed-out UI", async () => {
  const work = deferred();
  const values: unknown[] = [];
  const monitor = new SessionMonitor(
    async (id) => {
      if (id === "fail") throw Error("offline");
      return work.promise;
    },
    (_, value) => values.push(value),
    () => {},
    1,
  );
  await monitor.refresh(["fail"]);
  assert.deepEqual(values, [null]);
  const active = monitor.refresh(["a", "queued"]);
  monitor.dispose();
  work.resolve({ state: "running", containerRunning: true });
  await active;
  assert.deepEqual(values, [null]);
});

test("status parsing allows only runtime fields and distinguishes idle, active and unknown", () => {
  const snapshot = parseSessionSnapshot({
    state: "succeeded",
    containerRunning: true,
    result: "private output",
    token: "secret",
  });
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "checkedAt",
    "containerRunning",
    "state",
  ]);
  assert.equal(
    parseSessionSnapshot({ state: "succeeded" }).containerRunning,
    null,
  );
  for (const value of [
    null,
    {},
    { state: "cloning" },
    { state: "constructor" },
  ])
    assert.throws(() => parseSessionSnapshot(value));
  const run = { state: "succeeded" } as Run;
  assert.equal(sessionIsRunning(run, snapshot), true);
  assert.equal(sessionIsRunning(run, null), false);
  assert.equal(sessionIsRunning({ ...run, state: "running" }, null), true);
});
