import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesSession,
  relativeTime,
  repositoryLabel,
  sessionGroup,
  sessionTitle,
} from "../web/lib/session-presentation.ts";
import type { Run } from "../web/lib/types.ts";
const run: Run = {
  id: "pi-example",
  agent: "pi",
  private: true,
  repository: "Private repository",
  ref: "",
  state: "succeeded",
  startedAt: null,
};

test("session titles preserve redacted history and use only an explicitly known prompt", () => {
  assert.equal(sessionTitle(run, {}), "Pi session · xample");
  assert.equal(run.repository, "Private repository");
  assert.equal(
    sessionTitle(run, {
      [run.id]: "Fix recovery. Preserve context and changes.",
    }),
    "Fix recovery.",
  );
  assert.equal(
    repositoryLabel("https://github.com/example/project.git"),
    "example/project",
  );
  assert.equal(matchesSession(run, {}, "private"), true);
  assert.equal(matchesSession(run, {}, "unknown repository name"), false);
});

test("navigation never interprets a finished turn as approval or a need for human input", () => {
  assert.equal(sessionGroup(run), "Awaiting reply");
  for (const state of ["cloning", "running", "stopping"] as const)
    assert.equal(sessionGroup({ ...run, state }), "Working");
  for (const state of ["failed", "lost", "cancelled", "none"] as const)
    assert.equal(sessionGroup({ ...run, state }), "Previous sessions");
});

test("history timestamps distinguish unknown, recent and older sessions", () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(null, now), "Time unknown");
  assert.equal(relativeTime(now + 60_000, now), "Just now");
  assert.equal(relativeTime(now - 120_000, now), "2m ago");
  assert.equal(relativeTime(now - 7_200_000, now), "2h ago");
  assert.equal(relativeTime(now - 172_800_000, now), "2d ago");
});
