// @ts-check
import { agentNames } from "./types";

/** @typedef {{ type?: string; text?: string }} TextBlock */
/**
 * The rendering subset of Pi/OpenCode activity envelopes. Reasoning and other
 * internal events are intentionally absent from the displayed fields.
 * @typedef {{ type?: string; toolCallId?: string; toolName?: string; args?: unknown;
 * partialResult?: { content?: TextBlock[] }; result?: { content?: TextBlock[] };
 * isError?: boolean; message?: { errorMessage?: string };
 * error?: { data?: { message?: string }; name?: string } }} ActivityEvent
 */
const activityLimits = {
  lineCharacters: 64_000,
  retainedNodes: 350,
  retainedCharacters: 256_000,
  bufferedCharacters: 2_000_000,
};

/** @param {TextBlock[] | undefined} value */
const textBlocks = (value) =>
  Array.isArray(value)
    ? value
        .filter((block) => block?.type === "text")
        .map((block) => block.text || "")
        .join("\n")
    : "";
/**
 * @param {HTMLDivElement} target
 * @param {import("./types").Run} run
 * @param {{ textContent: string }} count
 * @param {{ checked: boolean }} follow
 * @param {{ archived?: boolean }} options
 */
export function createActivity(
  target,
  run,
  count,
  follow,
  { archived = false } = {},
) {
  target.replaceChildren();
  const title = document.createElement("div");
  title.className = "log-line system";
  title.textContent = `${agentNames[run.agent]} · ${run.id}`;
  target.append(title);
  const waiting = document.createElement("div");
  waiting.className = "log-line system";
  waiting.textContent =
    run.state === "cloning"
      ? "Preparing the workspace and cloning the repository…"
      : "Waiting for the first agent output…";
  target.append(waiting);
  let buffered = "",
    total = 0,
    dirty = false;
  /** @type {HTMLDivElement | null} */
  let stderr = null;
  /** @type {Map<string, HTMLDivElement>} */
  const nodes = new Map();
  /** @param {unknown} text @param {string} kind @param {string} [key] */
  const add = (text, kind = "", key) => {
    waiting.remove();
    let node = key ? nodes.get(key) : null;
    if (!node || node.parentNode !== target) {
      node = document.createElement("div");
      node.className = `log-line ${kind}`;
      target.append(node);
      total++;
      count.textContent = String(total);
      if (key) nodes.set(key, node);
    }
    node.textContent = String(text).slice(-activityLimits.lineCharacters);
    return node;
  };
  const changed = () => {
    // Keep the view bounded without retaining private output in browser storage.
    while (
      target.childNodes.length > activityLimits.retainedNodes ||
      ((target.textContent || "").length > activityLimits.retainedCharacters &&
        target.childNodes.length > 2)
    )
      target.removeChild(target.childNodes[1]);
    for (const [key, node] of nodes)
      if (node.parentNode !== target) nodes.delete(key);
    if (follow.checked) target.scrollTop = target.scrollHeight;
  };
  let firstEntry = true;
  /** @param {string} raw */
  const line = (raw) => {
    if (!raw.trim()) return;
    /** @type {ActivityEvent | null} */
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      add(
        archived && firstEntry
          ? "One incomplete entry at the start of this archived log was skipped. Task status is shown separately."
          : "A log entry could not be displayed. Check the session status for the task result.",
        "system",
        "partial",
      );
      firstEntry = false;
      return;
    }
    firstEntry = false;
    if (!event || typeof event !== "object") return;
    const toolKey = `tool:${event.toolCallId || event.toolName || "unknown"}`;
    if (event.type === "tool_execution_start")
      add(
        `${event.toolName || "tool"}  ${JSON.stringify(event.args || {})}`,
        "tool",
        `${toolKey}:start`,
      );
    else if (event.type === "tool_execution_update")
      add(textBlocks(event.partialResult?.content) || "Running…", "", toolKey);
    else if (event.type === "tool_execution_end") {
      add(
        textBlocks(event.result?.content) ||
          (event.isError ? "Tool failed." : "Tool completed."),
        event.isError ? "error" : "",
        toolKey,
      );
      dirty = true;
    } else if (event.type === "message_end" && event.message?.errorMessage)
      add(event.message.errorMessage, "error");
    else if (event.type === "error")
      add(
        event.error?.data?.message || event.error?.name || "Agent error",
        "error",
      );
    // Other agent events can contain internal model state; only render explicit activity.
  };
  count.textContent = "0";
  if (archived)
    add(
      "Archived logs — latest 32 KB per output channel. Earlier entries may be omitted. This notice does not indicate a task failure.",
      "system",
    );
  return {
    /** @param {string} text */
    stdout(text) {
      dirty = false;
      buffered += text;
      let boundary;
      while ((boundary = buffered.indexOf("\n")) >= 0) {
        line(buffered.slice(0, boundary));
        buffered = buffered.slice(boundary + 1);
      }
      if (buffered.length > activityLimits.bufferedCharacters) {
        buffered = "";
        add("An oversized event was skipped.", "system");
      }
      changed();
      return dirty;
    },
    /** @param {string} text */
    stderr(text) {
      if (!stderr || stderr.parentNode !== target) stderr = add("", "error");
      stderr.textContent = (stderr.textContent + text).slice(
        -activityLimits.lineCharacters,
      );
      changed();
    },
    finish() {
      if (buffered.trim()) line(buffered);
      buffered = "";
      changed();
    },
    /** @param {string} text */
    note(text) {
      add(text, "system");
      changed();
    },
  };
}
