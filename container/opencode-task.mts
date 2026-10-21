import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openCodeEvents, type OpenCodeEvent } from "./opencode-events.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";

const openCodeServer = {
  hostname: "127.0.0.1",
  port: 4096,
  startupAttempts: 120,
  startupRetryMs: 250,
  healthTimeoutMs: 1000,
  messageTimeoutMs: 29 * 60_000,
  subscriptionTimeoutMs: 5000,
  shutdownTimeoutMs: 2000,
};
const serverOrigin = `http://${openCodeServer.hostname}:${openCodeServer.port}`;
const [modelID, prompt] = process.argv.slice(2);
const password = randomBytes(24).toString("hex");
const server = spawn(
  "opencode",
  [
    "serve",
    "--hostname",
    openCodeServer.hostname,
    "--port",
    String(openCodeServer.port),
  ],
  {
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => process.stderr.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));
let spawnError: Error | undefined;
server.on("error", (error) => {
  spawnError = error;
});
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
type Session = { id: string };
type MessageResult = {
  info?: { error?: { name?: string; data?: { message?: string } } };
  parts?: { type: string; text?: string }[];
};
// Local authenticated control channel; model credentials are injected only by the Worker.
async function request<T = unknown>(
  path: string,
  body?: unknown,
  timeout = openCodeServer.messageTimeoutMs,
) {
  const url = new URL(path, serverOrigin);
  url.searchParams.set("directory", process.cwd());
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok)
    throw new Error(
      `OpenCode API ${response.status}: ${(await response.text()).slice(-2000)}`,
    );
  return response.json() as Promise<T>;
}
const eventsController = new AbortController();
async function followEvents(sessionID: string, onReady: () => void) {
  const url = new URL("/event", serverOrigin);
  url.searchParams.set("directory", process.cwd());
  const response = await fetch(url, {
    headers: { authorization },
    signal: eventsController.signal,
  });
  if (!response.ok || !response.body)
    throw new Error("OpenCode event stream is unavailable");
  const normalize = openCodeEvents(sessionID);
  onReady();
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const frames = buffered.split(/\r?\n\r?\n/);
    buffered = frames.pop() || "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      let event: OpenCodeEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      for (const normalized of normalize(event))
        console.log(JSON.stringify(normalized));
    }
  }
}
let exitCode = 0;
try {
  let ready = false;
  for (let i = 0; i < openCodeServer.startupAttempts; i++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null)
      throw new Error("OpenCode server stopped during startup");
    try {
      await request(
        "/global/health",
        undefined,
        openCodeServer.healthTimeoutMs,
      );
      ready = true;
      break;
    } catch {}
    await new Promise((resolve) =>
      setTimeout(resolve, openCodeServer.startupRetryMs),
    );
  }
  if (!ready) throw new Error("OpenCode server did not become ready");
  const sessionFile =
    process.env.OPENCODE_SESSION_FILE ||
    "/workspace/conversation/opencode-session.json";
  let session: Session;
  try {
    const saved = JSON.parse(await readFile(sessionFile, "utf8"));
    if (!/^ses_[a-zA-Z0-9]+$/.test(saved.id))
      throw Error("Invalid saved OpenCode session");
    session = await request<Session>(`/session/${saved.id}`);
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { status?: number };
    if (error.code !== "ENOENT") throw error;
    session = await request<Session>("/session", {
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        ...["question", "plan_enter", "plan_exit"].map((permission) => ({
          permission,
          pattern: "*",
          action: "deny",
        })),
      ],
    });
    await mkdir(sessionFile.slice(0, sessionFile.lastIndexOf("/")), {
      recursive: true,
    });
    await writeFile(sessionFile, JSON.stringify({ id: session.id }), {
      mode: 0o600,
    });
  }
  let markReady!: () => void;
  let failReady!: (reason: unknown) => void;
  const subscribed = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  void followEvents(session.id, markReady).catch((error) => {
    failReady(error);
    if (error.name !== "AbortError")
      console.error("Live events unavailable:", error.message);
  });
  const subscriptionTimeout = setTimeout(
    () => failReady(new Error("OpenCode event subscription timed out")),
    openCodeServer.subscriptionTimeoutMs,
  );
  try {
    await subscribed;
  } finally {
    clearTimeout(subscriptionTimeout);
  }
  // The awaited message response is the completion boundary, before server shutdown.
  const result = await request<MessageResult>(
    `/session/${session.id}/message`,
    {
      model: { providerID: "custom", modelID },
      parts: [{ type: "text", text: prompt }],
    },
  );
  if (result.info?.error)
    throw new Error(
      result.info.error.data?.message ??
        result.info.error.name ??
        "OpenCode failed",
    );
  if (!result.info || !Array.isArray(result.parts))
    throw new Error("Invalid OpenCode response");
  const text = result.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  console.log(JSON.stringify({ type: "text", part: { text } }));
} catch (caught) {
  const error = caught as NodeJS.ErrnoException & { status?: number };
  exitCode = 1;
  console.log(
    JSON.stringify({
      type: "error",
      error: { name: "OpenCodeError", data: { message: error.message } },
    }),
  );
} finally {
  eventsController.abort();
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit").catch(() => {}),
    new Promise((resolve) =>
      setTimeout(resolve, openCodeServer.shutdownTimeoutMs),
    ),
  ]);
  if (server.exitCode === null && server.signalCode === null)
    server.kill("SIGKILL");
  process.exit(exitCode);
}
