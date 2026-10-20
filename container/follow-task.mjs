import { open, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Keep byte cursors on UTF-8 boundaries so reconnecting never loses half a character.
export function completeUtf8Length(buffer) {
  if (!buffer.length) return 0;
  let start = buffer.length - 1;
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80 && buffer.length - start <= 4) start--;
  if (start < 0) return buffer.length;
  const lead = buffer[start];
  const length = lead >= 0xf0 && lead <= 0xf4 ? 4 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xc2 && lead <= 0xdf ? 2 : 1;
  return start + length > buffer.length ? start : buffer.length;
}
export async function followTask(directory, initial = [0, 0], write = async text => {
  if (!process.stdout.write(text)) await once(process.stdout, 'drain');
}) {
  const offsets = [...initial];
  const paths = ['stdout.log', 'stderr.log'];
  const frame = (type, data) => `id: ${offsets.join(':')}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  let lastHeartbeat = Date.now();
  for (;;) {
    let exitCode;
    try { exitCode = Number((await readFile(`${directory}/exit-code`, 'utf8')).trim()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let changed = false;
    for (let index = 0; index < paths.length; index++) {
      let handle;
      try {
        handle = await open(`${directory}/${paths[index]}`, 'r');
        const size = (await handle.stat()).size;
        if (offsets[index] > size) throw Error('Log cursor is beyond the available output');
        const chunk = Buffer.alloc(Math.min(16384, size - offsets[index]));
        if (!chunk.length) continue;
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offsets[index]);
        const bytes = chunk.subarray(0, bytesRead);
        const length = exitCode !== undefined && offsets[index] + bytesRead === size ? bytesRead : completeUtf8Length(bytes);
        if (!length) continue;
        offsets[index] += length;
        changed = true;
        await write(frame(index === 0 ? 'stdout' : 'stderr', bytes.subarray(0, length).toString('utf8')));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      finally { await handle?.close(); }
    }
    if (exitCode !== undefined && !changed) return;
    if (Date.now() - lastHeartbeat > 5000) { await write(': keep-alive\n\n'); lastHeartbeat = Date.now(); }
    if (!changed) await new Promise(resolve => setTimeout(resolve, 100));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const offsets = (process.argv[3] || '0:0').split(':').map(Number);
  if (offsets.length !== 2 || offsets.some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('Invalid log cursor');
  await followTask(process.argv[2], offsets);
}
