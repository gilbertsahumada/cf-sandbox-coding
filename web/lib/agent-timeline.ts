export type ToolActivity = {
  kind: "tool";
  id: string;
  name: string;
  input: string;
  label: string;
  output: string;
  state: "running" | "completed" | "error" | "unavailable";
};
export type TimelineItem =
  | { kind: "text"; id: string; text: string }
  | ToolActivity
  | { kind: "error"; id: string; text: string };
export type TimelineSnapshot = {
  items: TimelineItem[];
  archived: boolean;
  omitted: boolean;
};
export const emptyTimeline = (): TimelineSnapshot => ({
  items: [],
  archived: false,
  omitted: false,
});
const limits = {
  items: 350,
  characters: 256_000,
  text: 64_000,
  input: 32_000,
  buffer: 2_000_000,
} as const;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
function content(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((part) => record(part).type === "text")
        .map((part) => string(record(part).text))
        .join("\n")
    : "";
}
function toolLabel(name: string, args: unknown) {
  const input = record(args);
  const path = string(input.path || input.filePath || input.file_path).replace(
    /^\/workspace\/repo\//,
    "",
  );
  const command = string(input.command || input.cmd);
  if (command) return command.split("\n")[0].slice(0, 180);
  return path ? `${name} ${path}` : name;
}

// Pi JSON and the normalized OpenCode adapter share this presentation stream.
// Deliberately accept only visible assistant text, explicit tools, and errors.
export function createAgentTimeline(
  write: (snapshot: TimelineSnapshot) => void,
) {
  let buffer = "",
    sequence = 0,
    message = "",
    archived = false,
    omitted = false;
  const items = new Map<string, TimelineItem>();
  let dirty = false;
  const cap = (text: string, size: number = limits.text) => {
    if (text.length > size && !omitted) {
      omitted = true;
      dirty = true;
    }
    return text.slice(-size);
  };
  const publish = () => {
    if (!dirty) return;
    dirty = false;
    let size = 0;
    for (const item of [...items.values()].reverse()) {
      size +=
        item.kind === "tool"
          ? item.input.length + item.output.length
          : item.text.length;
      if (size > limits.characters || items.size > limits.items) {
        const oldest = items.keys().next().value;
        if (oldest !== undefined) items.delete(oldest);
        omitted = true;
      }
    }
    write({ items: [...items.values()], archived, omitted });
  };
  const text = (id: string, value: string, append = false) => {
    const previous = items.get(id);
    const next = cap(
      (append && previous?.kind === "text" ? previous.text : "") + value,
    );
    if (previous?.kind === "text" && previous.text === next) return;
    items.set(id, { kind: "text", id, text: next });
    dirty = true;
  };
  function event(value: unknown) {
    const data = record(value),
      detail = record(data.assistantMessageEvent),
      msg = record(data.message),
      part = record(data.part);
    const type = string(data.type);
    if (type === "message_start" && msg.role === "assistant") {
      message = `pi:${++sequence}`;
    } else if (type === "message_update" && detail.type === "text_delta") {
      message ||= `pi:${++sequence}`;
      text(message, string(detail.delta), true);
    } else if (type === "message_end" && msg.role === "assistant") {
      const visible = content(msg.content);
      if (visible) text(message || `pi:${++sequence}`, visible);
      message = "";
      const error = string(msg.errorMessage);
      if (error) {
        dirty = true;
        items.set(`error:${++sequence}`, {
          kind: "error",
          id: `error:${sequence}`,
          text: cap(error),
        });
      }
    } else if (["message_text", "text"].includes(type)) {
      const visible = string(part.text);
      if (visible) {
        // The adapter's final `text` snapshot may repeat already streamed parts.
        const prior = [...items.values()].filter(
          (item): item is Extract<TimelineItem, { kind: "text" }> =>
            item.kind === "text",
        );
        if (
          !part.id &&
          prior.some(
            (_, index) =>
              prior
                .slice(index)
                .map((item) => item.text)
                .join("\n") === visible,
          )
        )
          return;
        text(`opencode:${string(part.id) || "legacy"}`, visible);
      }
    } else if (
      [
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
      ].includes(type)
    ) {
      const id = `tool:${string(data.toolCallId) || string(data.toolName) || "unknown"}`;
      const previous = items.get(id);
      const name =
        string(data.toolName) ||
        (previous?.kind === "tool" ? previous.name : "Tool");
      const tool: ToolActivity =
        previous?.kind === "tool"
          ? { ...previous }
          : {
              kind: "tool",
              id,
              name,
              input: "",
              label: name,
              output: "",
              state: "running",
            };
      tool.name = name;
      if (type === "tool_execution_start") {
        tool.input = cap(JSON.stringify(data.args || {}), limits.input);
        tool.label = toolLabel(name, data.args);
        tool.state = "running";
      } else if (type === "tool_execution_update") {
        tool.output = cap(content(record(data.partialResult).content));
      } else {
        tool.output = cap(content(record(data.result).content));
        tool.state = data.isError === true ? "error" : "completed";
      }
      if (
        previous?.kind !== "tool" ||
        Object.keys(tool).some(
          (key) =>
            tool[key as keyof ToolActivity] !==
            previous[key as keyof ToolActivity],
        )
      ) {
        items.set(id, tool);
        dirty = true;
      }
    } else if (type === "error") {
      const error = record(data.error);
      const visible =
        string(record(error.data).message) ||
        string(error.message) ||
        string(error.name) ||
        "Agent error";
      const id = `error:${++sequence}`;
      items.set(id, { kind: "error", id, text: cap(visible) });
      dirty = true;
    }
  }
  return {
    reset(saved = false) {
      buffer = "";
      sequence = 0;
      message = "";
      archived = saved;
      omitted = false;
      items.clear();
      dirty = true;
      publish();
    },
    push(chunk: string) {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (!line.trim()) continue;
        try {
          event(JSON.parse(line));
        } catch {
          if (!omitted) dirty = true;
          omitted = true;
        }
      }
      if (buffer.length > limits.buffer) {
        buffer = "";
        if (!omitted) dirty = true;
        omitted = true;
      }
      publish();
    },
    finish() {
      if (buffer.trim()) {
        try {
          event(JSON.parse(buffer));
        } catch {
          if (!omitted) dirty = true;
          omitted = true;
        }
      }
      buffer = "";
      for (const [id, item] of items)
        if (item.kind === "tool" && item.state === "running") {
          items.set(id, { ...item, state: "unavailable" });
          dirty = true;
        }
      publish();
    },
  };
}

// Keep a bounded in-memory history only; never persist private activity in browser storage.
export function retainTimelines(
  turns: Record<number, TimelineSnapshot>,
  turn: number,
  snapshot: TimelineSnapshot,
) {
  const next = { ...turns, [turn]: snapshot };
  let characters = 0;
  for (const number of Object.keys(next)
    .map(Number)
    .sort((a, b) => b - a)) {
    characters += JSON.stringify(next[number]).length;
    if (characters > 2_000_000 && number !== turn) delete next[number];
  }
  return next;
}

export function currentActivity(items: TimelineItem[]) {
  const tool = [...items]
    .reverse()
    .find(
      (item): item is ToolActivity =>
        item.kind === "tool" && item.state === "running",
    );
  if (!tool)
    return items.some((item) => item.kind === "text")
      ? "Writing a response…"
      : "Working…";
  if (/read|list|glob|grep|search/i.test(tool.name)) return "Reading files…";
  if (/edit|write|patch/i.test(tool.name)) return "Editing files…";
  if (/\b(test|pytest|vitest|jest)\b/.test(tool.label)) return "Running tests…";
  return `Running ${tool.name}…`;
}
