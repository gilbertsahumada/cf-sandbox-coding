import { z } from "zod";
import { runnerLimits } from "./runtime-config";
import { isActiveTask, type TaskState } from "./task-status";
export { activeStates } from "./task-status";
export const ChatMessage = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(runnerLimits.promptCharacters),
});
export type Turn = {
  number: number;
  id: string;
  prompt: string;
  startedAt: number;
  finishedAt?: number;
  state: TaskState;
  response?: string;
};
export type StoredTurn = Omit<Turn, "prompt" | "response"> & {
  promptChunks: number;
  responseChunks?: number;
};
export type Checkpoint = {
  generation: string;
  count: number;
  turn: number;
  digest: string;
  workspaceRevision?: number;
};
export function continuationReason(
  version: unknown,
  state: TaskState,
  live: boolean,
  turn: number,
  checkpointTurn?: number,
): string | undefined {
  if (!version)
    return "This older task has no saved conversation session. Start a new task; its patch is still available.";
  if (isActiveTask(state))
    return "The agent is working. Stop it before sending another instruction.";
  if (!live && checkpointTurn !== turn)
    return "This turn has no complete recovery checkpoint. Available conversation history and archived changes are preserved.";
}
