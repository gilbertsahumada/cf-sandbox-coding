import { verifyWebAssets } from "./lib/web-assets.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const [url] = process.argv.slice(2);
if (!url || !url.startsWith("https://"))
  throw new Error(
    "Usage: node scripts/verify-live.mjs https://worker.workers.dev",
  );
const { RUNNER_API_TOKEN } = parseEnv(await readFile(".dev.vars", "utf8"));
if (!RUNNER_API_TOKEN) throw new Error("RUNNER_API_TOKEN is required");
let headers = {
  authorization: `Bearer ${RUNNER_API_TOKEN}`,
  "content-type": "application/json",
};
if (process.argv.includes("--session")) {
  const origin = new URL(url).origin;
  const response = await fetch(origin + "/session", {
    method: "POST",
    headers: { ...headers, origin },
  });
  if (!response.ok) throw new Error("Web login failed: " + response.status);
  const cookie = response.headers.get("set-cookie");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict"])
    if (!cookie?.includes(attribute))
      throw new Error("Missing secure session attribute: " + attribute);
  headers = {
    cookie: cookie.split(";")[0],
    origin,
    "content-type": "application/json",
  };
  const blocked = await fetch(origin + "/session", {
    method: "DELETE",
    headers: { ...headers, origin: "https://untrusted.example" },
  });
  if (blocked.status !== 403)
    throw new Error("Cross-origin mutation was not blocked");
  await verifyWebAssets(origin);
  console.log(
    "PASS web interface, protected session and cross-origin request rejection",
  );
}
await mkdir("verification", { recursive: true });
async function request(path, body) {
  const response = await fetch(url.replace(/\/$/, "") + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(
      `${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
    );
  return response;
}
console.log("Health:", await (await request("/health")).text());
let failed = false;
for (const agent of ["pi", "opencode"]) {
  const name = `${agent}-${crypto.randomUUID()}`;
  const base = `/sandboxes/${name}`;
  const expected = `verified-${agent}-qwen`;
  console.log(`${agent}: cloning public test repository (${name})`);
  try {
    await request(`${base}/repository`, {
      url: "https://github.com/octocat/Hello-World",
    });
    await request(`${base}/task`, {
      agent,
      prompt: `Create a new file sandbox-verification.txt containing exactly ${expected} followed by a newline. Use a terminal command with Node.js to check that the file content is exactly correct. Do not change any other file. Do not commit. Give a short final response.`,
    });
    const deadline = Date.now() + 5 * 60_000;
    let result;
    while (Date.now() < deadline) {
      result = await (await request(`${base}/task`)).json();
      if (result.state !== "running" && result.state !== "none") break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const diff = await (await request(`${base}/diff`)).text();
    const logs = await (await request(`${base}/logs`)).json();
    await writeFile(`verification/${agent}.diff`, diff);
    await writeFile(
      `verification/${agent}.json`,
      JSON.stringify(
        {
          name,
          checkedAt: new Date().toISOString(),
          model: "qwen3.7-flash",
          result,
          logs,
        },
        null,
        2,
      ),
    );
    if (
      result?.state !== "succeeded" ||
      !diff.includes(`+${expected}`) ||
      !diff.includes("sandbox-verification.txt")
    )
      throw new Error(`Verification failed: ${JSON.stringify(result)}`);
    console.log(
      `${agent}: PASS — task succeeded and expected file is in the diff`,
    );
  } catch (error) {
    failed = true;
    console.error(`${agent}: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
