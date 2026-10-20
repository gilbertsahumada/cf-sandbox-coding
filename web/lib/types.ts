export type Agent = "pi" | "opencode";
export type RunState =
  | "cloning"
  | "running"
  | "stopping"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "lost"
  | "none";
export type Run = {
  id: string;
  agent: Agent;
  private: boolean;
  repository: string;
  ref: string;
  state: RunState;
  startedAt: number | null;
  finishedAt?: number;
};
export type Turn = {
  number: number;
  id: string;
  prompt: string;
  response?: string;
  state: string;
  startedAt: number;
  finishedAt?: number;
};
export type Conversation = {
  turns: Turn[];
  turn: number;
  state: RunState;
  canContinue: boolean;
  reason?: string;
  warning?: string;
  checkpointSaved: boolean;
};
export type Repository = {
  installationId: number;
  repositoryId: number;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
};
export type GitHubStatus = {
  connected: boolean;
  accounts: string[];
  permissionsUrl?: string;
  manageUrl?: string;
};
export type Proposal = {
  available: boolean;
  reason?: string;
  pr?: { url: string; number: number; branch: string };
};
export const agentNames: Record<Agent, string> = {
  pi: "Pi",
  opencode: "OpenCode",
};
export const stateNames: Record<RunState, string> = {
  cloning: "Preparing",
  running: "Working",
  stopping: "Stopping",
  cancelled: "Stopped",
  succeeded: "Ready for your reply",
  failed: "Failed",
  lost: "Workspace lost",
  none: "No task",
};
export const isActive = (state: RunState) =>
  ["cloning", "running", "stopping"].includes(state);
