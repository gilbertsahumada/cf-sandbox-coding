import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const checkpointLimit = 20 * 1024 * 1024;
const roots = ['repo', 'conversation', 'agent-config'];
// Checkpoints stay server-side. Neither model nor GitHub credentials exist here.
export function saveCheckpoint(root = '/workspace') {
  const temp = mkdtempSync(join(tmpdir(), 'checkpoint-'));
  try {
    const archive = join(temp, 'workspace.tgz');
    execFileSync('tar', ['-czf', archive, '-C', root, '--', ...roots.filter(path => existsSync(join(root, path)))], { timeout: 25000 });
    if (statSync(archive).size > checkpointLimit) throw Error('El punto de recuperación supera 20 MB. El entorno seguirá abierto temporalmente; descarga el patch antes de salir.');
    return readFileSync(archive).toString('base64');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function restoreCheckpoint(encodedFile, root = '/workspace') {
  const bytes = Buffer.from(readFileSync(encodedFile, 'utf8'), 'base64');
  if (bytes.length > checkpointLimit) throw Error('Checkpoint too large');
  const temp = mkdtempSync(join(tmpdir(), 'checkpoint-'));
  try {
    const archive = join(temp, 'workspace.tgz'); writeFileSync(archive, bytes);
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (names.split('\n').filter(Boolean).some(path => path.startsWith('/') || path.split('/').includes('..') || !roots.includes(path.split('/')[0]))) throw Error('Invalid checkpoint paths');
    mkdirSync(root, { recursive: true });
    for (const path of roots) rmSync(join(root, path), { recursive: true, force: true });
    execFileSync('tar', ['-xzf', archive, '--no-same-owner', '-C', root], { timeout: 25000 });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'save') process.stdout.write(saveCheckpoint());
    else if (process.argv[2] === 'restore') restoreCheckpoint(process.argv[3]);
    else throw Error('Invalid checkpoint command');
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
