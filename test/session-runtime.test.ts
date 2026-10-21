import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionRuntimeControl } from "../web/components/session-runtime-control";
const base = {
  running: true,
  active: false,
  checking: false,
  stopping: false,
  disabled: false,
  onRefresh() {},
  onStop() {},
};
const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(SessionRuntimeControl, { ...base, ...props }),
  );
test("an idle but running session still offers an explicit stop action", () => {
  const html = render();
  assert.match(html, /Session running/);
  assert.match(html, /Stop session/);
  assert.doesNotMatch(html, /disabled=""/);
});
test("stopped and unknown are distinct and never claim that the agent was cancelled", () => {
  const stopped = render({ running: false });
  assert.match(stopped, /Session stopped/);
  assert.doesNotMatch(stopped, /Stop session/);
  const unknown = render({ running: null });
  assert.match(unknown, /Session status unavailable/);
  assert.doesNotMatch(unknown, /Session stopped|Stop session/);
});
test("checking or stopping disables duplicate stop requests", () => {
  for (const props of [
    { checking: true },
    { stopping: true },
    { disabled: true },
  ])
    assert.match(render(props), /disabled=""/);
});
