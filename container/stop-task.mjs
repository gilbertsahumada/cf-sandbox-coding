import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function stopTaskProcess(directory, bootPath = '/proc/sys/kernel/random/boot_id') {
  let record;
  try { record = await readFile(`${directory}/pid`, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const [pid, boot] = record.trim().split(/\s+/);
  const currentBoot = (await readFile(bootPath, 'utf8')).trim();
  if (!/^[1-9][0-9]*$/.test(pid) || boot !== currentBoot) return;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try { process.kill(-Number(pid), signal); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await stopTaskProcess(process.argv[2]);
