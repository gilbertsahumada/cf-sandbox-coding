import { agentNames, isActive, type Run } from "./types";

export function repositoryLabel(repository: string) {
  return (
    repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") ||
    "Repository session"
  );
}

// Prompt-derived titles stay in memory; private history retains its redacted label.
export function sessionTitle(run: Run, titles: Record<string, string>) {
  const title = titles[run.id]
    ?.split("\n")
    .find((line) => line.trim())
    ?.trim();
  return title
    ? title.split(/(?<=[.!?])\s/)[0].slice(0, 72)
    : `${agentNames[run.agent]} session · ${run.id.slice(-6)}`;
}

export function sessionGroup(run: Run) {
  if (isActive(run.state)) return "Working";
  if (run.state === "succeeded") return "Awaiting reply";
  return "Previous sessions";
}

export function relativeTime(value: number | null, now = Date.now()) {
  if (!value) return "Time unknown";
  const minutes = Math.max(0, Math.floor((now - value) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function matchesSession(
  run: Run,
  titles: Record<string, string>,
  query: string,
) {
  return `${sessionTitle(run, titles)} ${run.repository} ${run.agent} ${run.id}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
