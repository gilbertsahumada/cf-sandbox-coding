import { runnerLimits } from "./runtime-config";
import { ChatMessage } from "./conversation";
import { logCursor } from "./event-stream";
import { authenticated, hasBearer, sameOrigin, sessionCookie } from "./auth";
import { z } from "zod";
import { Agent } from "./agents";
import { githubCallback, githubRoute } from "./github-routes";
export { GitHubConnection } from "./github";
export { Outbound } from "./outbound";
export { AgentSandbox } from "./sandbox";

const Repository = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "github.com" &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.search &&
          !url.hash &&
          /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
        );
      }, "Use an HTTPS GitHub repository URL without credentials")
      .optional(),
    installationId: z.number().int().positive().safe().optional(),
    repositoryId: z.number().int().positive().safe().optional(),
    ref: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !value.startsWith("-"))
      .optional(),
  })
  .refine(
    (value) =>
      Boolean(value.url) !==
      Boolean(value.installationId && value.repositoryId),
    "Choose a repository or provide a public URL",
  );
const Task = z.object({
  agent: Agent,
  prompt: z.string().trim().min(1).max(runnerLimits.promptCharacters),
});
async function readJson(
  request: Request,
  limit: number = runnerLimits.requestBytes,
): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError("Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (
      ["/github/manifest/callback", "/github/install/callback"].includes(
        path,
      ) &&
      request.method === "GET"
    )
      return githubCallback(request, env);
    if (
      (["/", "/favicon.svg"].includes(path) ||
        /^\/assets\/[a-zA-Z0-9._/-]+$/.test(path)) &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://github.com",
      );
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "no-referrer");
      headers.set("cache-control", "no-cache");
      if (path === "/" && request.method === "GET" && response.status === 200) {
        const nonce = crypto.randomUUID();
        headers.set(
          "content-security-policy",
          headers
            .get("content-security-policy")!
            .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`),
        );
        headers.set("cache-control", "no-store");
        headers.delete("content-length");
        headers.delete("etag");
        return new Response(
          (await response.text()).replace(
            "</head>",
            `<meta name="csp-nonce" content="${nonce}"></head>`,
          ),
          { status: response.status, headers },
        );
      }
      return new Response(response.body, { status: response.status, headers });
    }
    if (!env.RUNNER_API_TOKEN)
      return new Response("Runner authentication is not configured", {
        status: 503,
      });
    if (
      !["GET", "HEAD"].includes(request.method) &&
      !hasBearer(request, env.RUNNER_API_TOKEN) &&
      !sameOrigin(request)
    )
      return new Response("Origin not allowed", { status: 403 });
    if (!authenticated(request, env.RUNNER_API_TOKEN))
      return new Response("Unauthorized", {
        status: 401,
        headers: { "cache-control": "no-store" },
      });
    if (path.startsWith("/github/")) return githubRoute(request, env);
    if (path === "/session") {
      if (request.method === "POST") {
        if (!hasBearer(request, env.RUNNER_API_TOKEN) || !sameOrigin(request))
          return new Response("Origin not allowed", { status: 403 });
        return Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie": sessionCookie(env.RUNNER_API_TOKEN),
              "cache-control": "no-store",
            },
          },
        );
      }
      if (request.method === "DELETE")
        return Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie": sessionCookie("", true),
              "cache-control": "no-store",
            },
          },
        );
      if (request.method === "GET")
        return Response.json(
          { ok: true, model: env.MODEL_ID },
          { headers: { "cache-control": "no-store" } },
        );
      return new Response("Method not allowed", { status: 405 });
    }
    if (new URL(request.url).pathname === "/health" && request.method === "GET")
      return Response.json({ ok: true, agents: Agent.options });
    const match =
      /^\/sandboxes\/([a-z0-9][a-z0-9-]{0,62})\/(repository|task|diff|logs|events|pull-request|messages|files|file)$/.exec(
        new URL(request.url).pathname,
      );
    if (!match) return new Response("Not found", { status: 404 });
    if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY)
      return new Response(
        "Configure model endpoint, model ID and API key first",
        { status: 503 },
      );
    const [, name, resource] = match;
    const sandbox = env.SANDBOX.getByName(name);
    try {
      if (resource === "files" || resource === "file") {
        const headers = { "cache-control": "no-store" };
        const url = new URL(request.url);
        try {
          let result;
          if (request.method === "GET") {
            const path = url.searchParams.get("path") || "";
            const cursor = Number(url.searchParams.get("cursor") || "0");
            if (
              path.length > runnerLimits.repositoryPathCharacters ||
              !Number.isSafeInteger(cursor) ||
              cursor < 0
            )
              return Response.json(
                { message: "Invalid repository path or cursor." },
                { status: 400, headers },
              );
            result = await sandbox.repositoryFiles(
              resource === "files" ? "list" : "read",
              path,
              cursor,
            );
          } else if (resource === "file" && request.method === "PUT") {
            const parsed = z
              .object({
                path: z
                  .string()
                  .min(1)
                  .max(runnerLimits.repositoryPathCharacters),
                content: z.string().max(runnerLimits.fileCharacters),
                version: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .safeParse(
                await readJson(request, runnerLimits.fileRequestBytes),
              );
            if (!parsed.success)
              return Response.json(
                {
                  message:
                    "Choose a text file up to 256 KB with its current version.",
                },
                { status: 400, headers },
              );
            result = await sandbox.repositoryFiles(
              "write",
              parsed.data.path,
              0,
              parsed.data.content,
              parsed.data.version,
            );
          } else return new Response("Method not allowed", { status: 405 });
          if (result.error)
            return Response.json(
              { message: result.error },
              { status: result.status || 409, headers },
            );
          return Response.json(result, { headers });
        } catch (error) {
          if (error instanceof RangeError)
            return Response.json(
              { message: "File request is too large." },
              { status: 413, headers },
            );
          return Response.json(
            {
              message:
                error instanceof Error
                  ? error.message
                  : "Could not access repository files.",
            },
            { status: 409, headers },
          );
        }
      }
      if (resource === "messages") {
        const headers = { "cache-control": "no-store" };
        if (request.method === "GET")
          return Response.json(await sandbox.conversation(), { headers });
        if (request.method === "POST") {
          const parsed = ChatMessage.safeParse(await readJson(request));
          if (!parsed.success)
            return Response.json(
              { message: "Enter a message of up to 32,000 characters." },
              { status: 400, headers },
            );
          try {
            return Response.json(
              await sandbox.sendMessage(parsed.data.id, parsed.data.prompt),
              { status: 202, headers },
            );
          } catch (error) {
            return Response.json(
              {
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not continue the conversation.",
              },
              { status: 409, headers },
            );
          }
        }
        return new Response("Method not allowed", { status: 405 });
      }
      if (resource === "pull-request") {
        const headers = { "cache-control": "no-store" };
        if (request.method === "GET")
          return Response.json(await sandbox.pullRequestStatus(), { headers });
        if (request.method === "POST") {
          const parsed = z
            .object({
              title: z
                .string()
                .trim()
                .min(1)
                .max(200)
                .refine((value) => !/[\r\n]/.test(value)),
              description: z.string().trim().max(20000).default(""),
            })
            .safeParse(await readJson(request));
          if (!parsed.success)
            return Response.json(
              { message: "Check the title and description." },
              { status: 400, headers },
            );
          try {
            return Response.json(
              await sandbox.createPullRequest(
                name,
                parsed.data.title,
                parsed.data.description,
              ),
              { status: 201, headers },
            );
          } catch (error) {
            return Response.json(
              {
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not create the PR.",
              },
              { status: 409, headers },
            );
          }
        }
      }
      if (resource === "events" && request.method === "GET") {
        const cursor = logCursor(
          request.headers.get("last-event-id") ||
            new URL(request.url).searchParams.get("cursor") ||
            "0:0",
        );
        if (!cursor) return new Response("Invalid log cursor", { status: 400 });
        const turnValue = new URL(request.url).searchParams.get("turn");
        const turn = turnValue === null ? undefined : Number(turnValue);
        if (turn !== undefined && (!Number.isSafeInteger(turn) || turn < 0))
          return new Response("Invalid turn", { status: 400 });
        return sandbox.streamEvents(cursor, turn);
      }
      if (resource === "repository" && request.method === "POST") {
        const parsed = Repository.safeParse(await readJson(request));
        if (!parsed.success)
          return Response.json({ error: parsed.error.issues }, { status: 400 });
        const grant =
          parsed.data.repositoryId && parsed.data.installationId
            ? await env.GITHUB.getByName("owner").repository(
                parsed.data.installationId,
                parsed.data.repositoryId,
              )
            : undefined;
        const repositoryUrl = grant?.url || parsed.data.url!;
        const result = await sandbox.cloneRepository(
          repositoryUrl,
          parsed.data.ref,
          grant,
        );
        return Response.json(result, {
          status: result.exitCode === 0 ? 201 : 409,
        });
      }
      if (resource === "task" && request.method === "POST") {
        const parsed = Task.safeParse(await readJson(request));
        if (!parsed.success)
          return Response.json({ error: parsed.error.issues }, { status: 400 });
        const state = await sandbox.startTask(
          parsed.data.prompt,
          parsed.data.agent,
        );
        return Response.json(
          { state },
          { status: state === "started" ? 202 : 409 },
        );
      }
      if (resource === "task" && request.method === "DELETE")
        return Response.json(await sandbox.stopTask());
      if (resource === "task" && request.method === "GET")
        return Response.json(await sandbox.executionStatus(), {
          headers: { "cache-control": "no-store" },
        });
      if (resource === "logs" && request.method === "GET")
        return Response.json(await sandbox.readLogs());
      if (resource === "diff" && request.method === "GET") {
        const result = await sandbox.readDiff();
        return new Response(
          result.exitCode === 0 ? result.stdout : result.stderr,
          {
            status: result.exitCode === 0 ? 200 : 410,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      if (error instanceof RangeError)
        return new Response("Request too large", { status: 413 });
      console.error("Sandbox request failed", error);
      return new Response("Sandbox operation failed; inspect Worker logs", {
        status: 500,
      });
    }
  },
} satisfies ExportedHandler<Env>;
