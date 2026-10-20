import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
const base = (process.argv[2] || JSON.parse(await readFile('runner.json', 'utf8')).url).replace(/\/$/, '');
const { RUNNER_API_TOKEN } = parseEnv(await readFile('.dev.vars', 'utf8'));
const headers = { authorization: `Bearer ${RUNNER_API_TOKEN}` };
const metrics = [];
async function api(path, body, method = body ? 'POST' : 'GET', extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response;
}
const anonymous = await fetch(base + '/sandboxes/sse-auth-check/events');
assert.equal(anonymous.status, 401);
const invalid = await fetch(base + '/sandboxes/sse-auth-check/events?cursor=-1:0', { headers });
assert.equal(invalid.status, 400);
for (const agent of ['pi', 'opencode']) {
  const id = `${agent}-sse-${crypto.randomUUID()}`;
  const result = { agent, id, streamedBeforeCompletion: false, reconnected: false, disconnectKeptTaskRunning: false, cancelled: false, stdoutFrames: 0, statusEvents: [], cleanedUp: false };
  const path = `/sandboxes/${id}`;
  const script = `require('fs').writeFileSync('sse-check.txt','verified\\n');console.log('SSE_STEP_ONE');setTimeout(()=>console.log('SSE_STEP_TWO'),${agent === 'pi' ? 6000 : 30000})`;
  const prompt = `Run exactly one bash command: node -e ${JSON.stringify(script)}. It creates sse-check.txt, prints a marker and waits. Do not change any other file. Do not commit. After the command finishes, reply Verified.`;
  let cursor = '0:0', rawBuffer = '', toolSeen = false, interrupted = false, done = false;
  try {
    await api(`${path}/repository`, { url: 'https://github.com/octocat/Hello-World' });
    await api(`${path}/task`, { agent, prompt });
    const until = Date.now() + 150000;
    while (!done) {
      assert.ok(Date.now() < until, 'SSE verification timed out');
      const response = await api(`${path}/events`, undefined, 'GET', { 'last-event-id': cursor });
      assert.ok(response.headers.get('content-type')?.startsWith('text/event-stream'));
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let frames = '', reconnect = false;
      try {
        while (!done && !reconnect) {
          const chunk = await reader.read();
          if (chunk.done) break;
          frames += decoder.decode(chunk.value, { stream: true });
          let boundary;
          while ((boundary = frames.indexOf('\n\n')) >= 0) {
            const frame = frames.slice(0, boundary); frames = frames.slice(boundary + 2);
            const fields = Object.fromEntries(frame.split('\n').filter(line => !line.startsWith(':')).map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trimStart()]));
            if (!fields.event) continue;
            if (fields.id) cursor = fields.id;
            const data = JSON.parse(fields.data);
            if (fields.event === 'reset') rawBuffer = '';
            if (fields.event === 'status') result.statusEvents.push(data.state);
            if (fields.event === 'stdout') {
              result.stdoutFrames++; rawBuffer += data;
              let newline;
              while ((newline = rawBuffer.indexOf('\n')) >= 0) {
                const line = rawBuffer.slice(0, newline); rawBuffer = rawBuffer.slice(newline + 1);
                try { if (JSON.parse(line).type === 'tool_execution_start') toolSeen = true; } catch {}
              }
              if (toolSeen && !interrupted) {
                interrupted = true;
                const current = await (await api(`${path}/task`)).json();
                result.streamedBeforeCompletion = current.state === 'running';
                if (agent === 'pi') {
                  await reader.cancel();
                  const state = await (await api(`${path}/task`)).json();
                  result.disconnectKeptTaskRunning = state.state === 'running';
                  result.reconnected = cursor !== '0:0';
                  reconnect = true;
                } else {
                  await new Promise(resolve => setTimeout(resolve, 1500));
                  const stopped = await (await api(`${path}/task`, undefined, 'DELETE')).json();
                  result.cancelled = stopped.state === 'cancelled' && stopped.containerRunning === false;
                }
              }
            }
            if (fields.event === 'done') { done = true; break; }
            if (reconnect) break;
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    const status = await (await api(`${path}/task`)).json();
    assert.equal(status.state, agent === 'pi' ? 'succeeded' : 'cancelled');
    assert.ok(result.streamedBeforeCompletion, 'No tool event arrived while the task was running');
    if (agent === 'pi') { assert.ok(result.disconnectKeptTaskRunning); assert.ok(result.reconnected); }
    else {
      assert.ok(result.cancelled);
      // This task only contains the public fixture and the known test file it creates.
      const patch = await (await api(`${path}/diff`)).text();
      result.archivedTestChange = patch.includes('sse-check.txt');
      assert.ok(result.archivedTestChange, 'Cancelled task changes were not archived');
    }
  } finally {
    const stop = await (await api(`${path}/task`, undefined, 'DELETE')).json();
    result.cleanedUp = stop.containerRunning === false;
    metrics.push(result);
    await mkdir('verification', { recursive: true });
    await writeFile('verification/sse-live.json', JSON.stringify({ anonymousStatus: anonymous.status, invalidCursorStatus: invalid.status, tasks: metrics }, null, 2) + '\n');
    console.log(JSON.stringify(result));
  }
}
