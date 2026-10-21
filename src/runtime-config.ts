/** Worker-side policy values. Container helpers are independently shipped Node scripts. */
export const runnerLimits = {
  promptCharacters: 32_000,
  resultCharacters: 16_000,
  diagnosticCharacters: 2_000,
  archivedLogBytes: 32_000,
  conversationTurns: 100,
  rememberedEditorPaths: 50,
  requestBytes: 96 * 1024,
  fileRequestBytes: 2 * 1024 * 1024,
  fileCharacters: 256 * 1024,
  repositoryPathCharacters: 2_048,
  storageTextChunkCharacters: 16_000,
  checkpointChunkCharacters: 50_000,
} as const;

export const sandboxTiming = {
  inactivityMs: 30 * 60_000,
  turnTimeoutMs: 30 * 60_000,
  taskCheckMs: 60_000,
  archivedInactivityMs: 60_000,
  eventHeartbeatMs: 5_000,
} as const;

export const workspacePaths = {
  root: "/workspace",
  repository: "/workspace/repo",
  task: "/workspace/task",
  conversation: "/workspace/conversation",
  piConfig: "/workspace/agent-config/pi",
  piSession: "/workspace/conversation/pi",
  openCodeData: "/workspace/conversation/data",
  openCodeState: "/workspace/conversation/state",
  checkpointInput: "/workspace/checkpoint.b64",
} as const;
