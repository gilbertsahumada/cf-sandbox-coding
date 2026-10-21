import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import ts from "typescript";

// Run the real connection with in-memory storage and a simulated GitHub transport.
let source = ts.transpileModule(
  readFileSync(new URL("../src/github.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
source = source.replace(
  /import .* from ["']cloudflare:workers["'];/,
  "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
);
source = source.replace(
  /from ["']\.\/([^"']+)["']/g,
  (_, path) =>
    `from ${JSON.stringify(new URL(`../src/${path}.ts`, import.meta.url).href)}`,
);
const { GitHubConnection } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("guest publication resolves only authorized public repositories and scopes write credentials", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const stored = new Map<string, unknown>([
    [
      "app",
      {
        id: 1,
        slug: "test",
        owner: "owner",
        pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    ],
    ["installations", [{ id: 7, account: "owner" }]],
  ]);
  const connection = new GitHubConnection(
    {
      storage: {
        kv: {
          get: (key: string) => stored.get(key),
          put: (key: string, value: unknown) => stored.set(key, value),
        },
      },
    },
    {},
  );
  const repo = {
    id: 42,
    full_name: "owner/public",
    private: false,
    default_branch: "main",
  };
  const tokens: any[] = [];
  const requests: { path: string; body: any; token: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const path = new URL(String(input)).pathname;
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const token = new Headers(options?.headers).get("authorization");
    requests.push({ path, body, token });
    const json = (value: unknown, status = 200) =>
      Response.json(value, { status });
    if (path === "/app/installations/7/access_tokens") {
      tokens.push(body);
      return json({
        token:
          body.permissions.contents === "write"
            ? "fixture-write"
            : "fixture-read",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    if (path === "/installation/repositories")
      return json({
        total_count: 2,
        repositories: [
          repo,
          { ...repo, id: 43, full_name: "owner/private", private: true },
        ],
      });
    if (path === "/repositories/42") return json(repo);
    if (path.startsWith("/repos/owner/public/git/commits/"))
      return json({ tree: { sha: "base-tree" } });
    if (path.endsWith("/git/blobs")) return json({ sha: "blob" });
    if (path.endsWith("/git/trees")) return json({ sha: "tree" });
    if (path.endsWith("/git/commits")) return json({ sha: "new-commit" });
    if (path.includes("/git/ref/heads/"))
      return json({ message: "Not Found" }, 404);
    if (path.endsWith("/git/refs")) return json({});
    if (path.endsWith("/pulls"))
      return options?.method === "POST"
        ? json({
            number: 10,
            html_url: "https://github.com/owner/public/pull/10",
          })
        : json([]);
    throw Error(`Unexpected simulated request ${path}`);
  };
  try {
    assert.equal(
      await connection.publicRepository("https://github.com/owner/private"),
      undefined,
    );
    assert.equal(
      await connection.publicRepository("https://github.com/other/uninstalled"),
      undefined,
    );
    await assert.rejects(
      connection.publicRepository("https://evil.test/owner/public"),
    );
    const grant = await connection.publicRepository(
      "https://github.com/OWNER/public.git",
    );
    assert.equal(grant?.publicOnly, true);
    assert.equal(grant.repositoryId, 42);
    assert.equal(
      tokens.some((t) => t.permissions.contents === "write"),
      false,
    );
    const bytes = Buffer.from("changed");
    const proposal = {
      baseCommit: "a".repeat(40),
      baseBranch: "main",
      files: [
        {
          path: "README.md",
          mode: "100644",
          type: "blob",
          sha: createHash("sha1")
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest("hex"),
          content: bytes.toString("base64"),
        },
      ],
    };
    repo.private = true;
    await assert.rejects(
      connection.createPullRequest(
        grant,
        "guest-one",
        proposal,
        "Update README",
        "",
      ),
      /public repository/,
    );
    await assert.rejects(
      connection.tokenForRepository(grant),
      /no longer public/,
    );
    assert.equal(
      tokens.some((t) => t.permissions.contents === "write"),
      false,
    );
    repo.private = false;
    const pr = await connection.createPullRequest(
      grant,
      "guest-one",
      proposal,
      "Update README",
      "",
    );
    assert.equal(pr.number, 10);
    assert.deepEqual(
      tokens.filter((t) => t.permissions.contents === "write"),
      [
        {
          repository_ids: [42],
          permissions: { contents: "write", pull_requests: "write" },
        },
      ],
    );
    const publication = requests.find(
      (r) => r.path.endsWith("/pulls") && r.body,
    );
    assert.equal(publication?.body.draft, true);
    assert.equal(publication?.token, "Bearer fixture-write");
    assert.equal(
      requests.some(
        (r) =>
          r.path === "/repositories/42" && r.token === "Bearer fixture-write",
      ),
      false,
    );
    stored.set("installations", []);
    await assert.rejects(
      connection.createPullRequest(
        grant,
        "guest-two",
        proposal,
        "Another proposal",
        "",
      ),
      /not connected/,
    );
    assert.equal(
      tokens.filter((t) => t.permissions.contents === "write").length,
      1,
    );
  } finally {
    globalThis.fetch = original;
  }
});
