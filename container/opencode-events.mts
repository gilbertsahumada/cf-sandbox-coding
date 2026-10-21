// The consumed subset of OpenCode's event envelope; runtime guards remain below.
export type OpenCodeEvent = {
  type: string;
  properties?: {
    info?: { sessionID: string; role: string; id: string };
    sessionID?: string;
    field?: string;
    partID?: string;
    messageID?: string;
    delta?: string;
    part?: {
      id: string;
      type: string;
      sessionID: string;
      messageID: string;
      text?: string;
      tool?: string;
      state?: {
        status: string;
        input?: unknown;
        output?: string;
        error?: string;
        metadata?: { output?: unknown };
      };
    };
  };
};
export type ActivityEvent =
  | { type: "message_text"; part: { id: string | undefined; text: string } }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName?: string;
      args?: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName?: string;
      isError: boolean;
      result: { content: { type: string; text: string }[] };
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName?: string;
      partialResult: { content: { type: string; text: string }[] };
    };

export function openCodeEvents(sessionID: string) {
  const seen = new Set<string>(),
    outputs = new Map<string, string>(),
    types = new Map<string | undefined, string>(),
    texts = new Map<string | undefined, string>(),
    assistants = new Set<string | undefined>();
  return (event: OpenCodeEvent): ActivityEvent[] => {
    const properties = event.properties || {};
    if (event.type === "message.updated") {
      if (
        properties.info?.sessionID === sessionID &&
        properties.info.role === "assistant"
      )
        assistants.add(properties.info.id);
      return [];
    }
    if (event.type === "message.part.delta") {
      if (
        properties.sessionID !== sessionID ||
        properties.field !== "text" ||
        types.get(properties.partID) !== "text" ||
        !assistants.has(properties.messageID)
      )
        return [];
      const text = (texts.get(properties.partID) || "") + properties.delta;
      texts.set(properties.partID, text);
      return [{ type: "message_text", part: { id: properties.partID, text } }];
    }
    const part = properties.part;
    if (event.type !== "message.part.updated" || part?.sessionID !== sessionID)
      return [];
    types.set(part.id, part.type);
    if (part.type === "text" && assistants.has(part.messageID)) {
      if (texts.get(part.id) === part.text) return [];
      texts.set(part.id, part.text || "");
      return [
        { type: "message_text", part: { id: part.id, text: part.text || "" } },
      ];
    }
    if (
      part.type !== "tool" ||
      !["running", "completed", "error"].includes(part.state?.status as string)
    )
      return [];
    const state = part.state!,
      key = `${part.id}:${state.status}`,
      events: ActivityEvent[] = [];
    if (!seen.has(key)) {
      seen.add(key);
      events.push(
        state.status === "running"
          ? {
              type: "tool_execution_start",
              toolCallId: part.id,
              toolName: part.tool,
              args: state.input,
            }
          : {
              type: "tool_execution_end",
              toolCallId: part.id,
              toolName: part.tool,
              isError: state.status === "error",
              result: {
                content: [
                  {
                    type: "text",
                    text:
                      state.output || state.error || "Herramienta completada.",
                  },
                ],
              },
            },
      );
    }
    const output = state.metadata?.output;
    if (
      state.status === "running" &&
      typeof output === "string" &&
      outputs.get(part.id) !== output
    ) {
      outputs.set(part.id, output);
      events.push({
        type: "tool_execution_update",
        toolCallId: part.id,
        toolName: part.tool,
        partialResult: { content: [{ type: "text", text: output }] },
      });
    }
    if (state.status !== "running") outputs.delete(part.id);
    return events;
  };
}
