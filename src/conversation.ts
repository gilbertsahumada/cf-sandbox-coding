import { z } from 'zod';
export const ChatMessage = z.object({ id: z.string().uuid(), prompt: z.string().trim().min(1).max(32000) });
export type Turn = { number: number; id: string; prompt: string; startedAt: number; finishedAt?: number; state: string; response?: string };
export type Checkpoint = { generation: string; count: number; turn: number; digest: string };
export const activeStates = ['running', 'stopping'];
export function continuationReason(version: unknown, state: string, live: boolean, turn: number, checkpointTurn?: number): string | undefined {
  if (!version) return 'Esta tarea antigua no guardó una sesión de conversación. Crea una tarea nueva; su patch sigue disponible.';
  if (activeStates.includes(state)) return 'El agente está trabajando. Puedes detenerlo antes de enviar otra instrucción.';
  if (!live && checkpointTurn !== turn) return 'No hay un punto de recuperación completo para este turno. Conservamos la conversación y los cambios archivados disponibles.';
}
