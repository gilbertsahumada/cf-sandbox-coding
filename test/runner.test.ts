import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOutcome, agentCommand, providerConfigs } from "../src/agents";
import { outboundRequest } from "../src/network";
async function* lines(events: unknown[]) { yield "invalid log line"; for (const event of events) yield JSON.stringify(event); }
const config = { MODEL_BASE_URL: "https://provider.example/v1", MODEL_ID: "coder", MODEL_API: "chat-completions", MODEL_CONTEXT_WINDOW: "32768", MODEL_MAX_TOKENS: "4096" };
test("Pi failure inside successful process is reported as failure", async () => {
  const result = await parseOutcome("pi", 0, lines([{ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Invalid API key" } }, { type: "agent_settled" }]), "");
  assert.deepEqual(result, { state: "failed", error: "Invalid API key" });
});
test("Pi requires settled event and returns assistant text", async () => {
  const message = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" } };
  assert.equal((await parseOutcome("pi", 0, lines([message]), "")).state, "failed");
  assert.deepEqual(await parseOutcome("pi", 0, lines([message, { type: "agent_settled" }]), ""), { state: "succeeded", result: "Done" });
});
test("OpenCode errors are not hidden by exit zero", async () => {
  assert.deepEqual(await parseOutcome("opencode", 0, lines([{ type: "error", error: { name: "APIError", data: { message: "Quota exceeded" } } }]), ""), { state: "failed", error: "Quota exceeded" });
});
test("OpenCode returns the final text", async () => {
  assert.deepEqual(await parseOutcome("opencode", 0, lines([{ type: "text", part: { text: "First" } }, { type: "text", part: { text: "Done" } }]), ""), { state: "succeeded", result: "Done" });
});
test("prompt is a literal argument, including shell expressions", () => {
  const prompt = '$(touch /tmp/injected); `id`';
  assert.deepEqual(agentCommand("pi", prompt, config).slice(-2), ["--", prompt]);
  assert.equal(agentCommand("opencode", prompt, config).at(-1), prompt);
});
test("custom provider handles slash-containing model IDs", () => {
  const cfg = providerConfigs({ ...config, MODEL_ID: "org/coder" });
  assert.ok(cfg.opencode.provider.custom.models["org/coder"]);
  assert.equal(cfg.pi.providers.custom.api, "openai-completions");
});
test("credentials go only to exact model origin and API path", () => {
  const request = new Request("https://provider.example/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer placeholder" }, body: "{}" });
  const result = outboundRequest(request, config.MODEL_BASE_URL, "secret");
  assert.ok(result instanceof Request);
  assert.equal(result.headers.get("authorization"), "Bearer secret");
  assert.equal(result.redirect, "manual");
  for (const url of ["https://provider.example.evil/v1/chat/completions", "https://provider.example/v1/chat/completions/evil", "http://provider.example/v1/chat/completions", "https://provider.example/v10/chat/completions"]) {
    const blocked = outboundRequest(new Request(url, { method: "POST" }), config.MODEL_BASE_URL, "secret");
    assert.ok(blocked instanceof Response);
    assert.equal(blocked.status, 403);
  }
});
test("GitHub never receives model credentials", () => {
  const result = outboundRequest(new Request("https://github.com/owner/repo", { headers: { authorization: "Bearer stolen" } }), config.MODEL_BASE_URL, "secret");
  assert.ok(result instanceof Request);
  assert.equal(result.headers.get("authorization"), null);
});
