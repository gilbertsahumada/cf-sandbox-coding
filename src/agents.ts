import { z } from "zod";

export const Agent = z.enum(["pi", "opencode"]);
export type AgentName = z.infer<typeof Agent>;
export type Outcome = { state: "succeeded"; result: string } | { state: "failed"; error: string };
export type AgentConfig = { MODEL_BASE_URL: string; MODEL_ID: string; MODEL_API: string; MODEL_CONTEXT_WINDOW: string; MODEL_MAX_TOKENS: string };

export function agentCommand(agent: AgentName, prompt: string, config: AgentConfig): string[] {
  return agent === "pi"
    ? ["pi", "--mode", "json", "--session-id", "task", "--session-dir", "/workspace/conversation/pi", "--provider", "custom", "--model", config.MODEL_ID, "--", prompt]
    : ["node", "/opt/opencode-task.mjs", config.MODEL_ID, prompt];
}

export function providerConfigs(config: AgentConfig) {
  const model = { id: config.MODEL_ID, name: config.MODEL_ID, reasoning: false, input: ["text"],
    contextWindow: Number(config.MODEL_CONTEXT_WINDOW), maxTokens: Number(config.MODEL_MAX_TOKENS) };
  return {
    pi: { providers: { custom: { baseUrl: config.MODEL_BASE_URL, api: config.MODEL_API === "responses" ? "openai-responses" : "openai-completions", apiKey: "provided-by-worker", models: [model] } } },
    opencode: { enabled_providers: ["custom"], provider: { custom: {
      npm: config.MODEL_API === "responses" ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible",
      name: "Custom provider", options: { baseURL: config.MODEL_BASE_URL, apiKey: "provided-by-worker" },
      models: { [config.MODEL_ID]: { name: config.MODEL_ID, limit: { context: model.contextWindow, output: model.maxTokens } } },
    } } },
  };
}

export function agentEnv(agent: AgentName, config: AgentConfig): Record<string, string> {
  return agent === "pi" ? {
    PI_CODING_AGENT_DIR: "/workspace/agent-config/pi", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  } : {
    XDG_DATA_HOME: "/workspace/conversation/data", XDG_STATE_HOME: "/workspace/conversation/state",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(providerConfigs(config).opencode),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1", OPENCODE_DISABLE_SHARE: "1",
  };
}

const PiEvent = z.union([
  z.object({ type: z.literal("agent_settled") }),
  z.object({ type: z.literal("message_end"), message: z.object({
    role: z.literal("assistant"), content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    stopReason: z.string(), errorMessage: z.string().optional(),
  }) }),
]);
const OpenCodeEvent = z.union([
  z.object({ type: z.literal("text"), part: z.object({ text: z.string() }) }),
  z.object({ type: z.literal("error"), error: z.object({ name: z.string(), data: z.object({ message: z.string().optional() }).optional() }) }),
]);

export async function parseOutcome(agent: AgentName, exitCode: number, lines: AsyncIterable<string>, stderr: string): Promise<Outcome> {
  let settled = false;
  let piMessage: Extract<z.infer<typeof PiEvent>, { type: "message_end" }>["message"] | undefined;
  let text = "";
  let error: string | undefined;
  for await (const line of lines) {
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (agent === "pi") {
      const parsed = PiEvent.safeParse(event);
      if (!parsed.success) continue;
      if (parsed.data.type === "agent_settled") settled = true;
      else piMessage = parsed.data.message;
    } else {
      const parsed = OpenCodeEvent.safeParse(event);
      if (!parsed.success) continue;
      if (parsed.data.type === "text") text = parsed.data.part.text;
      else error = parsed.data.error.data?.message ?? parsed.data.error.name;
    }
  }
  if (exitCode !== 0) return { state: "failed", error: error ?? `${agent} exited with ${exitCode}: ${stderr.slice(-2000)}` };
  if (agent === "pi") {
    if (!settled || !piMessage) return { state: "failed", error: "pi exited before the agent settled" };
    if (["error", "aborted"].includes(piMessage.stopReason)) return { state: "failed", error: piMessage.errorMessage ?? `pi stopped: ${piMessage.stopReason}` };
    text = piMessage.content.filter(block => block.type === "text").map(block => block.text ?? "").join("");
  }
  if (error) return { state: "failed", error };
  return { state: "succeeded", result: text.slice(-16000) };
}
