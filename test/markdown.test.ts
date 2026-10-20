import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownResponse } from "../web/components/markdown-response";
test("agent Markdown renders headings, lists, tables and fenced code without executing HTML or loading images", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownResponse, {
      text: '# Result\n\n**Ready**\n\n- First\n- Second\n\n| Check | Result |\n| --- | --- |\n| Test | Passed |\n\n```js\nconst value = "<script>";\n```\n\n<script>alert(1)</script>\n\n![tracking](https://external.test/image.png)\n\n[bad](javascript:alert(1))\n\n[safe](https://example.com)',
    }),
  );
  for (const element of ["<h1>", "<strong>", "<ul>", "<table>", "<pre>"])
    assert.ok(html.includes(element), element);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
});
