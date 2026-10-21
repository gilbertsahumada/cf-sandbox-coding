// Presentation defaults for this deployment; model credentials remain in the Worker.
export const workspaceConfig = {
  modelLabel: "Qwen 3.7 Flash",
  exampleRepository: {
    fullName: "octocat/Hello-World",
    url: "https://github.com/octocat/Hello-World",
  },
  demoRepository: {
    fullName: "gilbertsahumada/cf-sandbox-coding",
    url: "https://github.com/gilbertsahumada/cf-sandbox-coding",
  },
  maxPromptLength: 32_000,
  maxOpenDocuments: 20,
} as const;

// Client scheduling and history bounds do not change sandbox execution budgets.
export const runnerConfig = {
  historyLimit: 12,
  monitorIntervalMs: 10_000,
  monitorTimeoutMs: 15_000,
  monitorConcurrency: 3,
  historyStorageKey: "sandbox-runs",
  updateChannelName: "sandbox-task-updates",
  requestTimeoutMs: 180_000,
  loginTimeoutMs: 15_000,
  changeReadTimeoutMs: 30_000,
  diffDebounceMs: 2_000,
  authRecheckMs: 10_000,
} as const;
