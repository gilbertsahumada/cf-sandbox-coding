import type { Agent } from "./types";
export type Startup = { task: string; prompt: string; agent: Agent; startedAt: number; stage: "cloning" | "starting" | "failed"; error?: string };
export function startupText(startup: Startup): string {
  if (startup.stage === "failed") return `Session preparation failed. ${startup.error || "Please try again."}`;
  if (startup.stage === "starting") return `Repository ready. Starting ${startup.agent === "pi" ? "Pi" : "OpenCode"}…`;
  return "Preparing the cloud workspace and cloning your repository…";
}
export async function prepareSession(
  task: string, repository: object, instruction: { agent: Agent; prompt: string },
  request: (path: string, body: object) => Promise<unknown>,
  preparing: () => void, starting: () => void,
) {
  // Present the session before waiting for a cold container or repository clone.
  preparing();
  await request(`/sandboxes/${task}/repository`, repository);
  starting();
  await request(`/sandboxes/${task}/task`, instruction);
}
