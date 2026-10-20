import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
// Local UI fixture only: no Cloudflare, GitHub or model requests.
const root = resolve("dist/ui");
const slow = process.argv.includes("--slow");
let authenticated = true,
  github = true,
  pageLoads = [],
  starts = 0,
  sends = 0,
  deletes = 0,
  publishes = 0;
const requests = new Set();
const initial = "pi-editor-demo";
const patch = `diff --git a/web/App.tsx b/web/App.tsx
index 1234567..2345678 100644
--- a/web/App.tsx
+++ b/web/App.tsx
@@ -1,5 +1,9 @@
 import { useState } from 'react'
-import { LegacyLayout } from './layout'
+import { CloudWorkspace } from './workspace'
+import { AgentChat } from './chat'
${" "}
 export default function App() {
-  return <LegacyLayout />
+  return (
+    <CloudWorkspace>
+      <AgentChat session="current" />
+    </CloudWorkspace>
+  )
 }
diff --git a/web/styles.css b/web/styles.css
new file mode 100644
--- /dev/null
+++ b/web/styles.css
@@ -0,0 +1,7 @@
+@import "tailwindcss";
+
+.workspace {
+  display: grid;
+  grid-template-columns: 240px 1fr 380px;
+  height: 100dvh;
+}
diff --git a/web/lib/session.ts b/web/lib/session.ts
new file mode 100644
--- /dev/null
+++ b/web/lib/session.ts
@@ -0,0 +1,3 @@
+export function sessionKey(id: string) {
+  return \`cloud-session:\${id}\`;
+}
`;
const tasks = new Map([
  [
    initial,
    {
      agent: "pi",
      state: "succeeded",
      turns: [
        {
          number: 1,
          id: "first",
          prompt:
            "Arrange the interface as an editor: sessions, changes, and agent chat. Keep the GitHub connection.",
          response:
            "The workspace layout is ready. Session navigation, change review, and conversation now have dedicated panels.\n\nTask recovery and live logs are preserved. Review the three changed files in the center panel.\n\nWould you like to adjust the chat panel next?",
          state: "succeeded",
          startedAt: Date.now() - 120000,
        },
      ],
      patch,
    },
  ],
]);
const remembered = {
  installationId: 1,
  repositoryId: 9001,
  fullName: "gilbertsahumada/cf-sandbox-coding",
  private: true,
  defaultBranch: "main",
  url: "https://github.com/gilbertsahumada/cf-sandbox-coding.git",
};
function finish(task) {
  task.state = "succeeded";
  task.turns.at(-1).state = "succeeded";
  task.turns.at(-1).response =
    task.turns.length === 1
      ? "The session is ready. Should I continue with the change?"
      : "I continued with the same context and preserved the previous changes.\nThe text <img src=x onerror=alert(1)> is displayed literally.";
}
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"),
    path = url.pathname;
  if (slow && /^\/(session|github|sandboxes)(\/|$)/.test(path))
    await new Promise((resolve) => setTimeout(resolve, 600));
  const json = (value, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (path === "/session") {
    if (req.method === "DELETE") authenticated = false;
    if (req.method === "POST")
      authenticated =
        req.headers.authorization === "Bearer fixture-runner-token";
    return json(
      { ok: authenticated, model: "qwen3.7-flash" },
      req.method === "DELETE" || authenticated ? 200 : 401,
    );
  }
  if (path === "/metrics")
    return json({
      starts,
      sends,
      deletes,
      publishes,
      pageLoads,
      uniqueMessages: requests.size,
    });
  if (path.startsWith("/github")) {
    if (!authenticated) return json({ message: "Not signed in" }, 401);
    if (path === "/github/status")
      return json({
        connected: github,
        accounts: ["gilbertsahumada"],
        permissionsUrl: "https://github.com/settings/apps/example/permissions",
      });
    if (path === "/github/connection") {
      github = false;
      return json({ disconnected: true });
    }
    if (path === "/github/selected-repository")
      return json({ repository: remembered });
    if (path === "/github/repositories") {
      const page = Number(url.searchParams.get("page") || 1);
      pageLoads.push(page);
      return json({
        repositories: Array.from({ length: page === 1 ? 100 : 82 }, (_, i) =>
          page === 2 && i === 81
            ? remembered
            : {
                ...remembered,
                repositoryId: (page - 1) * 100 + i + 1,
                fullName: `example/project-${(page - 1) * 100 + i + 1}`,
                url: `https://github.com/example/project-${(page - 1) * 100 + i + 1}`,
              },
        ),
        total: 182,
        hasMore: page === 1,
      });
    }
  }
  const match = /^\/sandboxes\/([^/]+)\/([^/]+)$/.exec(path);
  if (match) {
    if (!authenticated) return json({ message: "Not signed in" }, 401);
    const [, id, resource] = match;
    let task = tasks.get(id);
    if (resource === "repository") {
      tasks.set(id, {
        agent: id.startsWith("pi") ? "pi" : "opencode",
        state: "none",
        turns: [],
        patch,
      });
      return json({ exitCode: 0 }, 201);
    }
    if (!task) return json({ state: "none" });
    if (resource === "task" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      starts++;
      task.agent = data.agent;
      task.state = "running";
      task.turns.push({
        number: 1,
        id: "first",
        prompt: data.prompt,
        state: "running",
        startedAt: Date.now(),
      });
      task.timer = setTimeout(() => finish(task), slow ? 8000 : 1300);
      return json({ state: "started" }, 202);
    }
    if (resource === "task" && req.method === "DELETE") {
      deletes++;
      clearTimeout(task.timer);
      task.state = "cancelled";
      task.turns.at(-1).state = "cancelled";
      task.turns.at(-1).response = "The task stopped. Changes were preserved.";
      return json({ state: "cancelled", containerRunning: false });
    }
    if (resource === "task")
      return json({ state: task.state, result: task.turns.at(-1)?.response });
    if (resource === "messages" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      sends++;
      if (!requests.has(data.id)) {
        requests.add(data.id);
        task.state = "running";
        task.turns.push({
          number: task.turns.length + 1,
          id: data.id,
          prompt: data.prompt,
          state: "running",
          startedAt: Date.now(),
        });
        task.timer = setTimeout(() => finish(task), slow ? 8000 : 1600);
      }
      return json({ turn: task.turns.length }, 202);
    }
    if (resource === "messages")
      return json({
        turn: task.turns.length,
        turns: task.turns,
        state: task.state,
        canContinue: !["running", "stopping"].includes(task.state),
        checkpointSaved: !["running", "stopping"].includes(task.state),
      });
    if (resource === "diff") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(task.patch);
    }
    if (resource === "pull-request" && req.method === "POST") {
      publishes++;
      if (publishes === 1)
        return json(
          {
            message:
              "Approve Contents and Pull requests permissions on GitHub to publish.",
          },
          409,
        );
      task.pr = {
        url: "https://github.com/gilbertsahumada/cf-sandbox-coding/pull/999",
        number: 999,
      };
      return json(task.pr, 201);
    }
    if (resource === "pull-request")
      return json({ available: task.state !== "running", pr: task.pr });
    if (resource === "events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      });
      const turn = task.turns.length;
      res.write(
        `event: turn\ndata: {"turn":${turn}}\n\nevent: status\ndata: ${JSON.stringify({ state: task.state })}\n\n`,
      );
      const events = [
        {
          type: "tool_execution_start",
          toolCallId: "check",
          toolName: "bash",
          args: { command: "git diff --stat" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "check",
          result: {
            content: [
              {
                type: "text",
                text: "3 files changed, 18 insertions(+), 2 deletions(-)",
              },
            ],
          },
        },
      ];
      res.write(
        `id: 100:0\nevent: stdout\ndata: ${JSON.stringify(events.map((event) => JSON.stringify(event)).join("\n") + "\n")}\n\n`,
      );
      const complete = () => {
        res.write(
          `event: status\ndata: ${JSON.stringify({ state: task.state, result: task.turns.at(-1)?.response })}\n\nevent: done\ndata: {}\n\n`,
        );
        res.end();
      };
      if (task.state !== "running") complete();
      else {
        const interval = setInterval(() => {
          if (task.state !== "running") {
            clearInterval(interval);
            complete();
          }
        }, 100);
        req.on("close", () => clearInterval(interval));
      }
      return;
    }
  }
  const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(root + "/") || !existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  const type =
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".svg": "image/svg+xml",
    }[extname(file)] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://github.com",
  });
  res.end(readFileSync(file));
}).listen(8795, "127.0.0.1", () =>
  console.log("Simulated editor: http://127.0.0.1:8795/?task=pi-editor-demo"),
);
