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

test("JavaScript and TypeScript fences receive safe syntax tokens and preserve source bytes", async () => {
  const { codeLanguage, highlightCode } = await import(
    "../web/lib/code-highlight"
  );
  const source =
    'export const greeting: string = "<script>alert(1)</script>";\n';
  assert.equal(codeLanguage(source, "text"), "typescript");
  assert.equal(
    codeLanguage(
      "export default function App() { return <Workspace />; }",
      "tsx",
    ),
    "tsx",
  );
  assert.equal(codeLanguage("const answer = 42;\n"), "javascript");
  assert.equal(codeLanguage("npm test", "bash"), "bash");
  assert.equal(codeLanguage("This is ordinary text.", "text"), "text");
  const tokens = highlightCode(source, "typescript");
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.ok(tokens.some((token) => token.className?.includes("tok-keyword")));
  assert.ok(tokens.some((token) => token.className?.includes("tok-string")));
  const html = renderToStaticMarkup(
    createElement(MarkdownResponse, { text: "```text\n" + source + "```" }),
  );
  assert.ok(html.includes("language-typescript"));
  assert.ok(html.includes("tok-keyword"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.deepEqual(highlightCode("raw\nbytes", "unsupported"), [
    { text: "raw\nbytes" },
  ]);
});
