import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatCompletion } from "../web/components/chat-completion";
const base = {
  state: "succeeded" as const,
  changeCount: 2,
  proposal: { available: true },
  loading: false,
  hasUnsavedEdits: false,
  onReview() {},
  onPublish() {},
};
const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(ChatCompletion, { ...base, ...props }),
  );

test("chat offers review and explicit PR creation after a finished turn", () => {
  const html = render();
  assert.match(html, /Review changes/);
  assert.match(html, /Create PR/);
  assert.match(html, /2 files changed/);
  assert.doesNotMatch(html, /disabled=/);
});
test("active or loading turns cannot expose a stale publish action", () => {
  for (const state of ["cloning", "running", "stopping", "none"])
    assert.equal(render({ state }), "");
  assert.doesNotMatch(render({ loading: true }), /Create PR/);
  const unavailable = render({ proposal: null, onRetry() {} });
  assert.doesNotMatch(unavailable, /Checking changes/);
  assert.match(unavailable, /Retry changes/);
  assert.match(unavailable, /disabled=""/);
});
test("publication blockers and unsaved files retain review but disable PR creation", () => {
  for (const props of [
    { hasUnsavedEdits: true },
    { proposal: { available: false, reason: "Connect GitHub to publish." } },
  ]) {
    const html = render(props);
    assert.match(html, /Review changes/);
    assert.match(html, /disabled=""/);
  }
  assert.match(render({ hasUnsavedEdits: true }), /Save or discard/);
  assert.match(
    render({
      proposal: { available: false, reason: "Connect GitHub to publish." },
    }),
    /Connect GitHub/,
  );
});
test("an existing safe PR is linked instead of creating another one", () => {
  const html = render({
    proposal: {
      available: false,
      pr: {
        url: "https://github.com/example/repo/pull/12",
        number: 12,
        branch: "sandbox/test",
      },
    },
  });
  assert.match(html, /View PR/);
  assert.match(html, /href="https:\/\/github.com\/example\/repo\/pull\/12"/);
  assert.doesNotMatch(html, /Create PR/);
  assert.doesNotMatch(
    render({
      proposal: { available: false, pr: { url: "javascript:alert(1)" } },
    }),
    /href="javascript:/,
  );
});
test("empty results do not imply that a code change was completed", () => {
  const html = render({ changeCount: 0, proposal: { available: false } });
  assert.match(html, /No file changes yet/);
  assert.doesNotMatch(html, /Create PR|Changes ready for review/);
});

test("failed changes requests stop loading and retain cached review with an explicit retry", () => {
  const html = render({
    error: "Could not load changes. Request timed out.",
    onRetry() {},
  });
  assert.doesNotMatch(html, /Checking changes/);
  assert.match(html, /Request timed out/);
  assert.match(html, /Retry changes/);
  assert.match(html, /Review changes/);
  assert.match(html, /disabled=""/);
  assert.match(render({ proposalLoading: true }), /Checking changes/);
});
