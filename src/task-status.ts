/** Persisted and HTTP task states; keep these literals compatible with archived tasks. */
export type TaskStatus =
  | { state: "none" }
  | { state: "running" }
  | { state: "stopping" }
  | { state: "cancelled"; error: string }
  | { state: "lost" }
  | { state: "succeeded"; result: string }
  | { state: "failed"; error: string };

export type TaskState = TaskStatus["state"];
export type ActiveTaskState = "running" | "stopping";
export const activeStates: readonly TaskState[] = ["running", "stopping"];
export function isActiveTask(state: TaskState): state is ActiveTaskState {
  return activeStates.includes(state);
}
