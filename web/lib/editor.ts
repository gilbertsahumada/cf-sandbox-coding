export type DiffLine = {
  text: string;
  kind: "add" | "remove" | "context" | "meta";
  before?: number;
  after?: number;
};
export type ChangedFile = {
  path: string;
  patch: string;
  added: number;
  removed: number;
  status: "A" | "D" | "M" | "R";
  lines: DiffLine[];
};
export const fileStatusNames = {
  A: "Added",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
} as const satisfies Record<ChangedFile["status"], string>;

function gitPath(value: string, prefixed = true) {
  if (value.startsWith('"') && value.endsWith('"')) {
    const raw = value.slice(1, -1),
      bytes: number[] = [];
    for (let i = 0; i < raw.length; ) {
      if (raw[i] === "\\") {
        const octal = /^[0-7]{3}/.exec(raw.slice(i + 1));
        if (octal) {
          bytes.push(parseInt(octal[0], 8));
          i += 4;
        } else {
          const c = raw[++i];
          bytes.push(
            ...new TextEncoder().encode(
              ({ t: "\t", n: "\n", r: "\r" } as Record<string, string>)[c] || c,
            ),
          );
          i++;
        }
      } else {
        const c = String.fromCodePoint(raw.codePointAt(i)!);
        bytes.push(...new TextEncoder().encode(c));
        i += c.length;
      }
    }
    value = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return prefixed ? value.replace(/^[ab]\//, "") : value;
}
export function parseDiff(patch: string): ChangedFile[] {
  return patch
    .split(/(?=^diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((part) => {
      const raw = part.trimEnd().split("\n");
      const plus = raw.find((line) => line.startsWith("+++ "))?.slice(4),
        minus = raw.find((line) => line.startsWith("--- "))?.slice(4);
      const header =
        /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/.exec(
          raw[0],
        );
      const rename = raw
        .find((line) => line.startsWith("rename to "))
        ?.slice(10);
      const path = rename
        ? gitPath(rename, false)
        : plus && plus !== "/dev/null"
          ? gitPath(plus)
          : minus && minus !== "/dev/null"
            ? gitPath(minus)
            : gitPath(header?.[2] || raw[0].slice(11));
      let before = 0,
        after = 0,
        inHunk = false,
        added = 0,
        removed = 0;
      const lines: DiffLine[] = raw.map((text) => {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
        if (hunk) {
          before = Number(hunk[1]);
          after = Number(hunk[2]);
          inHunk = true;
          return { text, kind: "meta" };
        }
        if (!inHunk || text.startsWith("\\")) return { text, kind: "meta" };
        if (text.startsWith("+")) {
          added++;
          return { text, kind: "add", after: after++ };
        }
        if (text.startsWith("-")) {
          removed++;
          return { text, kind: "remove", before: before++ };
        }
        return { text, kind: "context", before: before++, after: after++ };
      });
      return {
        path,
        patch: part,
        added,
        removed,
        lines,
        status:
          plus === "/dev/null" ||
          raw.some((line) => line.startsWith("deleted file mode"))
            ? "D"
            : minus === "/dev/null" ||
                raw.some((line) => line.startsWith("new file mode"))
              ? "A"
              : rename
                ? "R"
                : "M",
      };
    });
}
// Only assistant-facing text is eligible for the conversation panel.
export function assistantStream(write: (text: string) => void) {
  let buffer = "",
    text = "";
  return {
    reset() {
      buffer = "";
      text = "";
    },
    push(chunk: string) {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        if (
          event.type === "message_start" &&
          event.message?.role === "assistant"
        )
          text = "";
        else if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        )
          text += event.assistantMessageEvent.delta || "";
        else if (
          event.type === "message_end" &&
          event.message?.role === "assistant"
        )
          text = Array.isArray(event.message.content)
            ? event.message.content
                .filter((part: { type?: string }) => part.type === "text")
                .map((part: { text?: string }) => part.text || "")
                .join("\n")
            : text;
        else if (["message_text", "text"].includes(event.type))
          text = event.part?.text || "";
        else continue;
        text = text.slice(-16000);
        write(text);
      }
      if (buffer.length > 2_000_000) buffer = "";
    },
  };
}
export function githubPullRequestURL(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" &&
      /^\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url.pathname) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
