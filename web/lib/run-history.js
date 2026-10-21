// @ts-check
import { agents, stateNames } from "./types";
import { runnerConfig } from "./config";

/** @typedef {import("./types").Run} Run */
/** @typedef {import("./types").Agent} Agent */
/** @typedef {import("./types").RunState} RunState */
/** @typedef {Record<string, unknown> & { id: string; agent: Agent; repository: string }} StoredRun */

/** @param {unknown} id @returns {Run | null} */
export function recoveredRun(id) {
  if (
    typeof id !== "string" ||
    id.length > 63 ||
    !/^(pi|opencode)-[a-z0-9-]+$/.test(id)
  )
    return null;
  return {
    id,
    agent: id.startsWith("opencode-") ? "opencode" : "pi",
    private: true,
    repository: "Recovered session",
    ref: "",
    state: "running",
    startedAt: null,
  };
}

/** @param {unknown} value @returns {value is StoredRun} */
function isStoredRun(value) {
  if (!value || typeof value !== "object") return false;
  const run = /** @type {Record<string, unknown>} */ (value);
  return (
    agents.some((agent) => agent === run.agent) &&
    recoveredRun(run.id) !== null &&
    typeof run.repository === "string"
  );
}

/** @param {unknown} value @returns {value is RunState} */
function isRunState(value) {
  return typeof value === "string" && Object.hasOwn(stateNames, value);
}

/**
 * Allowlist the history schema: private repository details and arbitrary API fields
 * must never reach persistent browser storage.
 * @param {unknown} runs
 * @returns {Run[]}
 */
export function historyForStorage(runs) {
  if (!Array.isArray(runs)) return [];
  return runs
    .filter(isStoredRun)
    .slice(0, runnerConfig.historyLimit)
    .map((run) => ({
      id: run.id,
      agent: run.agent,
      private: Boolean(run.private),
      repository: run.private ? "Private repository" : run.repository,
      ref: run.private ? "" : typeof run.ref === "string" ? run.ref : "",
      startedAt:
        typeof run.startedAt === "number" && Number.isFinite(run.startedAt)
          ? run.startedAt
          : null,
      ...(typeof run.finishedAt === "number" && Number.isFinite(run.finishedAt)
        ? { finishedAt: run.finishedAt }
        : {}),
      state: isRunState(run.state) ? run.state : "none",
    }));
}
