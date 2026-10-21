import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebAssets, webAssetPaths } from "../scripts/lib/web-assets.mjs";
const shell =
  '<div id="root"></div><script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-def.css">';

test("deployed UI verification discovers hashed build assets without legacy UI labels", () => {
  assert.deepEqual(webAssetPaths(shell), [
    "/assets/index-abc.js",
    "/assets/index-def.css",
  ]);
  assert.throws(
    () => webAssetPaths('<div id="root"></div>'),
    /assets are missing/,
  );
});

test("deployed UI verification rejects a successful HTML fallback for a missing script", async () => {
  await assert.rejects(
    verifyWebAssets(
      "https://worker.example",
      async () =>
        new Response(shell, { headers: { "content-type": "text/html" } }),
    ),
    /Missing or invalid web asset/,
  );
});

test("deployed UI verification fetches only public same-origin build resources", async () => {
  const calls: string[] = [];
  const origin = "https://worker.example";
  const paths = await verifyWebAssets(origin, async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(url === origin ? shell : "asset", {
      headers: {
        "content-type": url.endsWith(".js")
          ? "application/javascript"
          : url.endsWith(".css")
            ? "text/css"
            : "text/html",
      },
    });
  });
  assert.equal(paths.length, 2);
  assert.deepEqual(calls, [
    origin,
    origin + "/assets/index-abc.js",
    origin + "/assets/index-def.css",
  ]);
});
