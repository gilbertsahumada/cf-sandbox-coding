import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { saveCheckpoint, restoreCheckpoint } from '/opt/workspace-checkpoint.mjs';
const marker = randomUUID();
let calls = 0, secondContext = 0;
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(403); return res.end(); }
  let body = ''; for await (const chunk of req) body += chunk;
  const data = JSON.parse(body); calls++;
  const all = JSON.stringify(data.messages), second = all.includes('SECOND_TURN');
  const tool = data.tools?.find(tool => tool.function.name === 'bash');
  const done = data.messages?.some(message => message.role === 'tool' && JSON.stringify(message.content).includes(second ? 'TURN_TWO_DONE' : 'TURN_ONE_DONE'));
  if (tool && second) { if (!all.includes(marker)) { res.writeHead(400); return res.end('Missing previous conversation'); } secondContext++; }
  const command = second ? 'test "$(cat first.txt)" = first && printf second > second.txt && printf TURN_TWO_DONE' : 'printf first > first.txt && printf TURN_ONE_DONE';
  const delta = !tool || done ? { content: second ? 'Second change ready; first change preserved.' : 'First change ready. Should I continue?' }
    : { tool_calls: [{ index: 0, id: second ? 'call_second' : 'call_first', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ command, description: 'Verify conversation workspace' }) } }] };
  if (!data.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'title', choices: [{ message: { role: 'assistant', content: 'Test conversation' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [part, finish] of [[{ role: 'assistant', ...delta }, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']]) res.write('data: ' + JSON.stringify({ id: 'chat-smoke', object: 'chat.completion.chunk', created: 1, model: 'test-coder', choices: [{ index: 0, delta: part, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n');
  res.end('data: [DONE]\n\n');
});
server.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'));
await new Promise(resolve => server.listen(8788, '127.0.0.1', resolve));
try {
  for (const agent of ['pi', 'opencode']) {
    for (const path of ['repo', 'conversation', 'agent-config']) await rm('/workspace/' + path, { recursive: true, force: true });
    const cwd = '/workspace/repo', pi = '/workspace/agent-config/pi';
    await mkdir(cwd, { recursive: true }); await mkdir(pi, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd });
    const model = { id: 'test-coder', contextWindow: 32768, maxTokens: 4096 };
    const baseURL = 'http://127.0.0.1:8788/v1';
    await writeFile(pi + '/models.json', JSON.stringify({ providers: { custom: { baseUrl: baseURL, api: 'openai-completions', apiKey: 'placeholder', models: [model] } } }));
    const config = { enabled_providers: ['custom'], provider: { custom: { npm: '@ai-sdk/openai-compatible', name: 'Custom', options: { baseURL, apiKey: 'placeholder' }, models: { 'test-coder': { name: 'Test', limit: { context: 32768, output: 4096 } } } } } };
    const env = { ...process.env, PWD: cwd, HTTP_PROXY: 'http://127.0.0.1:8788', HTTPS_PROXY: 'http://127.0.0.1:8788', NO_PROXY: 'localhost,127.0.0.1',
      PI_CODING_AGENT_DIR: pi, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0',
      XDG_DATA_HOME: '/workspace/conversation/data', XDG_STATE_HOME: '/workspace/conversation/state',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_SHARE: '1' };
    const prior = secondContext;
    for (let turn = 1; turn <= 2; turn++) {
      const prompt = turn === 1 ? `Remember ${marker}. Create first.txt and ask whether to continue.` : 'SECOND_TURN: yes, continue; preserve the first change.';
      const command = agent === 'pi' ? ['pi', '--mode', 'json', '--session-id', 'task', '--session-dir', '/workspace/conversation/pi', '--provider', 'custom', '--model', 'test-coder', '--', prompt] : ['node', '/opt/opencode-task.mjs', 'test-coder', prompt];
      let stderr = '', output = '';
      const code = await new Promise(resolve => {
        const child = spawn(command[0], command.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000, killSignal: 'SIGKILL' });
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('exit', resolve);
      });
      if (code !== 0 || output.includes('"type":"error"')) throw Error(`${agent} turn ${turn} failed: ${stderr.slice(0, 1800)} ${output.slice(-1000)}`);
      if (await readFile(cwd + '/first.txt', 'utf8') !== 'first') throw Error('First change missing');
      if (turn === 1) {
        const saved = saveCheckpoint(); await writeFile('/tmp/chat-checkpoint.b64', saved);
        for (const path of ['repo', 'conversation', 'agent-config']) await rm('/workspace/' + path, { recursive: true, force: true });
        restoreCheckpoint('/tmp/chat-checkpoint.b64');
      } else if (await readFile(cwd + '/second.txt', 'utf8') !== 'second') throw Error('Second change missing');
    }
    if (secondContext <= prior) throw Error(`${agent} did not resume context`);
    console.log(JSON.stringify({ agent, turns: 2, rememberedFirstMessage: true, recoveredWorkspace: true, preservedBothChanges: true }));
  }
  console.log(JSON.stringify({ modelRequests: calls }));
} finally { server.close(); }
