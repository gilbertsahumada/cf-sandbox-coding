import type { TaskState } from "../../src/task-status";
export const agents = ["pi", "opencode"] as const;
export type Agent = (typeof agents)[number];
// Cloning is a browser preparation state; persisted task states come from the server.
export type RunState = TaskState | "cloning";
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
export const agentNames = {
  pi: "Pi",
  opencode: "OpenCode",
} as const satisfies Record<Agent, string>;
export const stateNames = {
  cloning: "Preparing",
  running: "Working",
  stopping: "Stopping",
  cancelled: "Stopped",
  succeeded: "Ready for your reply",
  failed: "Failed",
  lost: "Workspace lost",
  none: "No task",
} as const satisfies Record<RunState, string>;
export const isActive = (state: RunState) =>
  state === "cloning" || state === "running" || state === "stopping";

export type StreamState = "" | "Connecting" | "Live" | "Reconnecting" | "Saved";
