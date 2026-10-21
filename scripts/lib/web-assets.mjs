// @ts-check
/**
 * Discover same-origin Vite assets without relying on obsolete fixed filenames.
 * @param {string} html
 * @returns {string[]}
 */
export function webAssetPaths(html) {
  if (!/<div\s+id=["']root["']/.test(html))
    throw new Error("Web interface root is missing");
  const paths = [
    ...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g),
  ].map((match) => match[1]);
  if (
    !paths.some((path) => path.endsWith(".js")) ||
    !paths.some((path) => path.endsWith(".css"))
  )
    throw new Error("Built web interface assets are missing");
  return [...new Set(paths)];
}

/**
 * Check public assets without forwarding authenticated request headers.
 * @param {string} origin
 * @param {typeof fetch} [fetcher]
 */
export async function verifyWebAssets(origin, fetcher = fetch) {
  const shell = await fetcher(origin);
  if (!shell.ok)
    throw new Error(`Web interface is unavailable: HTTP ${shell.status}`);
  const paths = webAssetPaths(await shell.text());
  for (const path of paths) {
    const response = await fetcher(new URL(path, origin));
    const expectedType = path.endsWith(".css")
      ? /text\/css/
      : /(?:javascript|ecmascript)/;
    // SPA fallback may return HTML with status 200 for a missing asset.
    if (
      !response.ok ||
      !expectedType.test(response.headers.get("content-type") || "")
    )
      throw new Error(`Missing or invalid web asset: ${path}`);
  }
  return paths;
}
