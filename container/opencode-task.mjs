import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openCodeEvents } from './opencode-events.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

// Use the server's awaited message response as the completion boundary.
// This also shuts down OpenCode's background services deterministically.
const [modelID, prompt] = process.argv.slice(2);
const password = randomBytes(24).toString('hex');
const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '4096'], {
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', chunk => process.stderr.write(chunk));
server.stderr.on('data', chunk => process.stderr.write(chunk));
let spawnError;
server.on('error', error => { spawnError = error; });
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
async function request(path, body, timeout = 29 * 60_000) {
  const url = new URL(path, 'http://127.0.0.1:4096');
  url.searchParams.set('directory', process.cwd());
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', headers: { authorization, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`OpenCode API ${response.status}: ${(await response.text()).slice(-2000)}`);
  return response.json();
}
const eventsController = new AbortController();
async function followEvents(sessionID, onReady) {
  const url = new URL('/event', 'http://127.0.0.1:4096');
  url.searchParams.set('directory', process.cwd());
  const response = await fetch(url, { headers: { authorization }, signal: eventsController.signal });
  if (!response.ok || !response.body) throw new Error('OpenCode event stream is unavailable');
  const normalize = openCodeEvents(sessionID);
  onReady();
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const frames = buffered.split(/\r?\n\r?\n/);
    buffered = frames.pop() || '';
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      for (const normalized of normalize(event)) console.log(JSON.stringify(normalized));
    }
  }
}
let exitCode = 0;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error('OpenCode server stopped during startup');
    try { await request('/global/health', undefined, 1000); ready = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('OpenCode server did not become ready');
  const sessionFile = process.env.OPENCODE_SESSION_FILE || '/workspace/conversation/opencode-session.json';
  let session;
  try {
    const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
    if (!/^ses_[a-zA-Z0-9]+$/.test(saved.id)) throw Error('Invalid saved OpenCode session');
    session = await request(`/session/${saved.id}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    session = await request('/session', { permission: [
      { permission: '*', pattern: '*', action: 'allow' },
      ...['question', 'plan_enter', 'plan_exit'].map(permission => ({ permission, pattern: '*', action: 'deny' })),
    ] });
    await mkdir(sessionFile.slice(0, sessionFile.lastIndexOf('/')), { recursive: true });
    await writeFile(sessionFile, JSON.stringify({ id: session.id }), { mode: 0o600 });
  }
  let markReady, failReady;
  const subscribed = new Promise((resolve, reject) => { markReady = resolve; failReady = reject; });
  const events = followEvents(session.id, markReady).catch(error => { failReady(error); if (error.name !== 'AbortError') console.error('Live events unavailable:', error.message); });
  const subscriptionTimeout = setTimeout(() => failReady(new Error('OpenCode event subscription timed out')), 5000);
  try { await subscribed; } finally { clearTimeout(subscriptionTimeout); }
  const result = await request(`/session/${session.id}/message`, {
    model: { providerID: 'custom', modelID }, parts: [{ type: 'text', text: prompt }],
  });
  if (result.info?.error) throw new Error(result.info.error.data?.message ?? result.info.error.name ?? 'OpenCode failed');
  if (!result.info || !Array.isArray(result.parts)) throw new Error('Invalid OpenCode response');
  const text = result.parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n');
  console.log(JSON.stringify({ type: 'text', part: { text } }));
} catch (error) {
  exitCode = 1;
  console.log(JSON.stringify({ type: 'error', error: { name: 'OpenCodeError', data: { message: error.message } } }));
} finally {
  eventsController.abort();
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  process.exit(exitCode);
}
