import { logCursor } from './event-stream';
import { authenticated, hasBearer, sameOrigin, sessionCookie } from "./auth";
import { z } from "zod";
import { Agent } from "./agents";
import { githubCallback, githubRoute } from "./github-routes";
export { GitHubConnection } from "./github";
export { Outbound } from "./outbound";
export { AgentSandbox } from "./sandbox";

const Repository = z.object({
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname);
  }, "Use an HTTPS GitHub repository URL without credentials").optional(),
  installationId: z.number().int().positive().safe().optional(),
  repositoryId: z.number().int().positive().safe().optional(),
  ref: z.string().min(1).max(255).refine(value => !value.startsWith("-" )).optional(),
}).refine(value => Boolean(value.url) !== Boolean(value.installationId && value.repositoryId), "Choose a repository or provide a public URL");
const Task = z.object({ agent: Agent, prompt: z.string().trim().min(1).max(32_000) });
const bodyLimit = 96 * 1024;
async function readJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > bodyLimit) { await reader.cancel(); throw new RangeError("Request too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (['/github/manifest/callback', '/github/install/callback'].includes(path) && request.method === 'GET') return githubCallback(request, env);
    if (["/", "/app.js", "/run-history.js", "/activity.js", "/styles.css", "/favicon.svg"].includes(path) && ["GET", "HEAD"].includes(request.method)) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://github.com");
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "no-referrer");
      headers.set("cache-control", "no-cache");
      return new Response(response.body, { status: response.status, headers });
    }
    if (!env.RUNNER_API_TOKEN) return new Response("Runner authentication is not configured", { status: 503 });
    if (!["GET", "HEAD"].includes(request.method) && !hasBearer(request, env.RUNNER_API_TOKEN) && !sameOrigin(request)) return new Response("Origin not allowed", { status: 403 });
    if (!authenticated(request, env.RUNNER_API_TOKEN)) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
    if (path.startsWith("/github/")) return githubRoute(request, env);
    if (path === "/session") {
      if (request.method === "POST") {
        if (!hasBearer(request, env.RUNNER_API_TOKEN) || !sameOrigin(request)) return new Response("Origin not allowed", { status: 403 });
        return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(env.RUNNER_API_TOKEN), "cache-control": "no-store" } });
      }
      if (request.method === "DELETE") return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie("", true), "cache-control": "no-store" } });
      if (request.method === "GET") return Response.json({ ok: true, model: env.MODEL_ID }, { headers: { "cache-control": "no-store" } });
      return new Response("Method not allowed", { status: 405 });
    }
    if (new URL(request.url).pathname === "/health" && request.method === "GET") return Response.json({ ok: true, agents: ["pi", "opencode"] });
    const match = /^\/sandboxes\/([a-z0-9][a-z0-9-]{0,62})\/(repository|task|diff|logs|events)$/.exec(new URL(request.url).pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY) return new Response("Configure model endpoint, model ID and API key first", { status: 503 });
    const [, name, resource] = match;
    const sandbox = env.SANDBOX.getByName(name);
    try {
      if (resource === 'events' && request.method === 'GET') {
        const cursor = logCursor(request.headers.get('last-event-id') || new URL(request.url).searchParams.get('cursor') || '0:0');
        if (!cursor) return new Response('Invalid log cursor', { status: 400 });
        return sandbox.streamEvents(cursor);
      }
      if (resource === "repository" && request.method === "POST") {
        const parsed = Repository.safeParse(await readJson(request));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const grant = parsed.data.repositoryId && parsed.data.installationId
          ? await env.GITHUB.getByName('owner').repository(parsed.data.installationId, parsed.data.repositoryId) : undefined;
        const repositoryUrl = grant?.url || parsed.data.url!;
        const result = await sandbox.cloneRepository(repositoryUrl, parsed.data.ref, grant);
        return Response.json(result, { status: result.exitCode === 0 ? 201 : 409 });
      }
      if (resource === "task" && request.method === "POST") {
        const parsed = Task.safeParse(await readJson(request));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const state = await sandbox.startTask(parsed.data.prompt, parsed.data.agent);
        return Response.json({ state }, { status: state === "started" ? 202 : 409 });
      }
      if (resource === "task" && request.method === "DELETE") return Response.json(await sandbox.stopTask());
      if (resource === "task" && request.method === "GET") return Response.json(await sandbox.readTask());
      if (resource === "logs" && request.method === "GET") return Response.json(await sandbox.readLogs());
      if (resource === "diff" && request.method === "GET") {
        const result = await sandbox.readDiff();
        return new Response(result.exitCode === 0 ? result.stdout : result.stderr, { status: result.exitCode === 0 ? 200 : 410, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      if (error instanceof RangeError) return new Response("Request too large", { status: 413 });
      console.error("Sandbox request failed", error);
      return new Response("Sandbox operation failed; inspect Worker logs", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
