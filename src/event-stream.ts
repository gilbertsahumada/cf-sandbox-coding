export function logCursor(value: string): string | null {
  if (!/^\d{1,16}:\d{1,16}$/.test(value)) return null;
  const offsets = value.split(':').map(Number);
  return offsets.every(offset => Number.isSafeInteger(offset) && offset >= 0) ? offsets.join(':') : null;
}
export function eventFrame(type: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
