export function outboundRequest(request: Request, baseUrl: string, apiKey: string): Request | Response {
  const url = new URL(request.url);
  if (url.protocol !== "https:") return new Response("HTTPS required", { status: 403 });
  const modelBase = new URL(baseUrl);
  const basePath = modelBase.pathname.replace(/\/$/, "");
  const allowedPaths = ["/chat/completions", "/responses"].map(path => basePath + path);
  if (url.origin === modelBase.origin && allowedPaths.includes(url.pathname) && request.method === "POST") {
    const headers = new Headers(request.headers);
    for (const key of ["authorization", "x-api-key", "cf-aig-authorization", "cookie"]) headers.delete(key);
    headers.set("authorization", `Bearer ${apiKey}`);
    // Never follow a redirect with the provider credential.
    return new Request(request, { headers, redirect: "manual" });
  }
  if (url.hostname === "github.com" && ["GET", "POST"].includes(request.method)) {
    const headers = new Headers(request.headers);
    for (const key of ["authorization", "x-api-key", "cf-aig-authorization", "cookie"]) headers.delete(key);
    return new Request(request, { headers, redirect: "manual" });
  }
  return new Response("Destination blocked", { status: 403 });
}
