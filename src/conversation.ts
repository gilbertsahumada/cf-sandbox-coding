import { z } from 'zod';
export const ChatMessage = z.object({ id: z.string().uuid(), prompt: z.string().trim().min(1).max(32000) });
export type Turn = { number: number; id: string; prompt: string; startedAt: number; finishedAt?: number; state: string; response?: string };
export type Checkpoint = { generation: string; count: number; turn: number; digest: string };
export const activeStates = ['running', 'stopping'];
export function continuationReason(version: unknown, state: string, live: boolean, turn: number, checkpointTurn?: number): string | undefined {
  if (!version) return 'This older task has no saved conversation session. Start a new task; its patch is still available.';
  if (activeStates.includes(state)) return 'The agent is working. Stop it before sending another instruction.';
  if (!live && checkpointTurn !== turn) return 'This turn has no complete recovery checkpoint. Available conversation history and archived changes are preserved.';
}
