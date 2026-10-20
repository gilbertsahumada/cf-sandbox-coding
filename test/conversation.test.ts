import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readlinkSync, chmodSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { ChatMessage, continuationReason } from '../src/conversation';
// @ts-expect-error Standalone Node module shipped in the container.
import { saveCheckpoint, restoreCheckpoint } from '../container/workspace-checkpoint.mjs';

// Exercise the real Durable Object logic with in-memory Cloudflare/container transports.
let source = ts.transpileModule(readFileSync(new URL('../src/sandbox.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
source = source.replace(/import workspaceFilesSource from [^;]+;/, `const workspaceFilesSource = ${JSON.stringify(readFileSync(new URL('../container/workspace-files.mjs.txt', import.meta.url), 'utf8'))};`);
source = source.replace(/import .* from ["']cloudflare:workers["'];/, 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
source = source.replace(/import .* from ["']@cloudflare\/sandbox["'];/, 'class Files { constructor(container) { return container.files; } } const SandboxFileError = { is: error => error.code === "ENOENT" };');
source = source.replace(/from ["']\.\/([^"']+)["']/g, (_, path) => `from ${JSON.stringify(new URL(`../src/${path}.ts`, import.meta.url).href)}`);
const { AgentSandbox } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const config = { MODEL_BASE_URL: 'https://provider.test/v1', MODEL_ID: 'test', MODEL_API: 'chat-completions', MODEL_CONTEXT_WINDOW: '32768', MODEL_MAX_TOKENS: '4096' };
function fixture() {
  const stored = new Map<string, any>([['repositoryReady', true], ['baseCommit', 'a'.repeat(40)]]), files = new Map<string, string>();
  const fileRequests: any[] = []; let fileContent = 'before', lastLaunch = '';
  let lastDirectory = '', spawns = 0, restores = 0, checkpointFail = false, restoreFail = false;
  const container: any = {
    running: true, images: { agent: 'test' },
    setInactivityTimeout: async () => {}, interceptAllOutboundHttp: async () => {}, interceptOutboundHttps: async () => {},
    start() { this.running = true; }, destroy: async () => { container.running = false; files.clear(); },
    files: { mkdir: async () => {}, remove: async (path: string) => { files.delete(path); }, writeFile: async (path: string, value: string) => { if (restoreFail && path === '/workspace/checkpoint.b64') { restoreFail = false; throw Error('Interrupted write'); } files.set(path, value); },
      readFile: async (path: string) => { if (!files.has(path)) throw Object.assign(Error('Missing'), { code: 'ENOENT' }); return new Response(files.get(path)); } },
    exec: async (args: string[]) => {
      let stdout = '', stderr = '', exitCode = 0;
      if (args[0] === '/bin/sh' && args[3] === 'agent') {
        spawns++; lastLaunch = args.at(-1)!; lastDirectory = args[4]; files.set(lastDirectory + '/stdout.log', ''); files.set(lastDirectory + '/stderr.log', '');
      } else if (args[0] === 'tail') stdout = files.get(args.at(-1)!) || '';
      else if (args[1] === '/opt/workspace-files.mjs') { const body = JSON.parse(files.get(args[2])!); fileRequests.push(body); const changed = body.operation === 'write' && body.content !== fileContent; if (body.operation === 'write') fileContent = body.content; stdout = JSON.stringify({ path: body.path, content: fileContent, version: 'b'.repeat(64), changed }); }
      else if (args[1] === '/opt/workspace-checkpoint.mjs') {
        if (args[2] === 'save') { if (checkpointFail) { exitCode = 1; stderr = 'Checkpoint limit'; } else stdout = Buffer.from('test archive').toString('base64'); }
        else restores++;
      } else if (args[1] === '/opt/stop-task.mjs') files.set(lastDirectory + '/exit-code', '143');
      else if (args[0] === '/bin/sh') stdout = 'diff --git a/file b/file\n+change';
      return { output: async () => ({ exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }) };
    },
  };
  const ctx = { container, exports: { Outbound: () => ({}) }, blockConcurrencyWhile: (fn: any) => fn(),
    storage: { kv: { get: (key: string) => structuredClone(stored.get(key)), put: (key: string, value: unknown) => { assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024, 'KV value is bounded'); stored.set(key, structuredClone(value)); }, delete: (key: string) => stored.delete(key) }, setAlarm: async () => {}, deleteAlarm: async () => {} } };
  const sandbox = new AgentSandbox(ctx, config);
  return { sandbox, stored, container, fileRequests, get lastLaunch() { return lastLaunch; }, get spawns() { return spawns; }, get restores() { return restores; }, restart: () => new AgentSandbox(ctx, config), failCheckpoint: () => { checkpointFail = true; }, failRestore: () => { restoreFail = true; },
    complete: (text: string) => { files.set(lastDirectory + '/exit-code', '0'); files.set(lastDirectory + '/stdout.log', JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } }) + '\n' + JSON.stringify({ type: 'agent_settled' }) + '\n'); } };
}
test('chat validates idempotency identifiers and refuses empty or oversized input', () => {
  assert.ok(ChatMessage.safeParse({ id: crypto.randomUUID(), prompt: ' yes ' }).success);
  for (const value of [{ id: 'invalid', prompt: 'yes' }, { id: crypto.randomUUID(), prompt: ' ' }, { id: crypto.randomUUID(), prompt: 'x'.repeat(32001) }]) assert.equal(ChatMessage.safeParse(value).success, false);
});
test('continuation requires a native session and a current durable checkpoint when the container is gone', () => {
  assert.match(continuationReason(undefined, 'succeeded', false, 0)!, /older task/);
  assert.match(continuationReason(1, 'running', true, 1)!, /working/);
  assert.match(continuationReason(1, 'lost', false, 2, 1)!, /checkpoint/);
  assert.equal(continuationReason(1, 'succeeded', false, 2, 2), undefined);
});
test('two turns retain conversation, invalidate stale diff/PR caches and reject duplicate or concurrent generation', async () => {
  const f = fixture(); await f.sandbox.startTask('First instruction', 'pi');
  await assert.rejects(f.sandbox.sendMessage(crypto.randomUUID(), 'too early'), /working/);
  f.complete('Should I continue?'); const first = await f.sandbox.conversation();
  assert.equal(first.turns[0].response, 'Should I continue?'); assert.equal(first.checkpointSaved, true);
  f.stored.set('pullRequest', { url: 'old' }); f.stored.set('proposalChunks', 1);
  const id = crypto.randomUUID();
  assert.deepEqual(await f.sandbox.sendMessage(id, 'Yes, implement it'), { turn: 2 });
  assert.deepEqual(await f.sandbox.sendMessage(id, 'Yes, implement it'), { turn: 2 });
  await assert.rejects(f.sandbox.sendMessage(id, 'Different instruction'), /another message/);
  assert.equal(f.spawns, 2); assert.equal(f.stored.has('diffChunks'), false); assert.equal(f.stored.has('pullRequest'), false); assert.equal(f.stored.has('proposalChunks'), false);
  f.complete('Implemented'); const final = await f.sandbox.conversation();
  assert.deepEqual(final.turns.map((turn: any) => [turn.prompt, turn.response]), [['First instruction', 'Should I continue?'], ['Yes, implement it', 'Implemented']]);
});
test('a restarted Durable Object restores a stopped workspace before resuming the same task', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.complete('Ready'); await f.sandbox.conversation();
  await f.sandbox.stopTask(); assert.equal(f.container.running, false);
  const restarted = f.restart(); assert.equal((await restarted.conversation()).canContinue, true);
  await restarted.sendMessage(crypto.randomUUID(), 'Continue');
  assert.equal(f.restores, 1); assert.equal(f.spawns, 2); assert.equal(f.stored.get('turn'), 2);
});
test('failed or corrupt checkpoints never start a fresh empty conversation after shutdown', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.failCheckpoint(); f.complete('Ready');
  const live = await f.sandbox.conversation(); assert.equal(live.canContinue, true); assert.equal(live.checkpointSaved, false); assert.equal(live.warning, 'Checkpoint limit');
  await f.sandbox.stopTask(); assert.equal((await f.sandbox.conversation()).canContinue, false);
  await assert.rejects(f.sandbox.sendMessage(crypto.randomUUID(), 'Continue'), /checkpoint/); assert.equal(f.spawns, 1);
  const g = fixture(); await g.sandbox.startTask('First', 'pi'); g.complete('Ready'); await g.sandbox.conversation(); await g.sandbox.stopTask();
  const checkpoint = g.stored.get('checkpoint'); g.stored.delete(`checkpoint:${checkpoint.generation}:0`);
  await assert.rejects(g.sandbox.sendMessage(crypto.randomUUID(), 'Continue'), /incomplete/); assert.equal(g.spawns, 1);
});
test('cancelling an active turn preserves a recoverable conversation and its cancelled status', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi');
  const stopped = await f.sandbox.stopTask(); assert.equal(stopped.state, 'cancelled'); assert.equal(stopped.containerRunning, false);
  const chat = await f.sandbox.conversation(); assert.equal(chat.turns[0].state, 'cancelled'); assert.equal(chat.canContinue, true);
});
test('workspace checkpoints preserve repository data, native session files, symlinks and executable permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-checkpoint-'));
  try {
    mkdirSync(join(root, 'repo/.git'), { recursive: true }); mkdirSync(join(root, 'conversation'), { recursive: true });
    writeFileSync(join(root, 'repo/file.bin'), Buffer.from([0, 128, 255]));
    writeFileSync(join(root, 'repo/run.sh'), '#!/bin/sh\n'); chmodSync(join(root, 'repo/run.sh'), 0o755); symlinkSync('file.bin', join(root, 'repo/link'));
    writeFileSync(join(root, 'conversation/session.jsonl'), 'native context');
    const checkpoint = join(root, 'saved.b64'); writeFileSync(checkpoint, saveCheckpoint(root));
    rmSync(join(root, 'repo'), { recursive: true }); rmSync(join(root, 'conversation'), { recursive: true });
    restoreCheckpoint(checkpoint, root);
    assert.equal(readFileSync(join(root, 'conversation/session.jsonl'), 'utf8'), 'native context');
    assert.deepEqual(readFileSync(join(root, 'repo/file.bin')), Buffer.from([0, 128, 255]));
    assert.equal(readlinkSync(join(root, 'repo/link')), 'file.bin'); assert.equal(statSync(join(root, 'repo/run.sh')).mode & 0o777, 0o755);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('SSE announces a changed turn before replay and does not use a stale cursor for the new turn', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.complete('Ready'); await f.sandbox.conversation();
  const response = await f.sandbox.streamEvents('999999:0', 0);
  const text = await response.text(); assert.match(text, /event: turn\ndata: {"turn":1}/); assert.doesNotMatch(text, /event: stdout/);
});
test('simultaneous follow-ups cannot launch two agent processes', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.complete('Ready'); await f.sandbox.conversation();
  const results = await Promise.allSettled([f.sandbox.sendMessage(crypto.randomUUID(), 'Second'), f.sandbox.sendMessage(crypto.randomUUID(), 'Third')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.spawns, 2);
});
let routeSource = ts.transpileModule(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
routeSource = routeSource.replace(/export \{[^}]+\} from ["'][^"']+["'];/g, '');
routeSource = routeSource.replace(/from ["']\.\/([^"']+)["']/g, (_, path) => `from ${JSON.stringify(new URL(`../src/${path}.ts`, import.meta.url).href)}`);
routeSource = routeSource.replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve('zod'))}`);
const handler = (await import('data:text/javascript;base64,' + Buffer.from(routeSource).toString('base64'))).default;
test('chat routes enforce authentication, same-origin mutations and validated message identifiers', async () => {
  const received: any[] = [];
  const env = { ...config, MODEL_API_KEY: 'test-key', RUNNER_API_TOKEN: 'test-runner', SANDBOX: { getByName: () => ({
    conversation: async () => ({ turns: [], canContinue: true }), sendMessage: async (...args: unknown[]) => { received.push(args); return { turn: 2 }; },
  }) } };
  const url = 'https://runner.test/sandboxes/pi-chat/messages';
  assert.equal((await handler.fetch(new Request(url), env)).status, 401);
  assert.equal((await handler.fetch(new Request(url, { method: 'POST', headers: { origin: 'https://other.test' }, body: '{}' }), env)).status, 403);
  const id = crypto.randomUUID(), headers = { authorization: 'Bearer test-runner', 'content-type': 'application/json' };
  assert.equal((await handler.fetch(new Request(url, { headers }), env)).status, 200);
  assert.equal((await handler.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify({ id, prompt: ' Continue ' }) }), env)).status, 202);
  assert.deepEqual(received, [[id, 'Continue']]);
  assert.equal((await handler.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify({ prompt: 'invalid' }) }), env)).status, 400);
  assert.equal(received.length, 1);
});

test('an interrupted restoration cannot leave an empty live container that silently loses context on retry', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.complete('Ready'); await f.sandbox.conversation(); await f.sandbox.stopTask();
  f.failRestore(); await assert.rejects(f.sandbox.sendMessage(crypto.randomUUID(), 'Continue'), /saved checkpoint is preserved/);
  assert.equal(f.container.running, false); assert.equal(f.spawns, 1);
  await f.restart().sendMessage(crypto.randomUUID(), 'Continue'); assert.equal(f.restores, 1); assert.equal(f.spawns, 2);
});
test('large Unicode prompts and responses round-trip without exceeding individual KV value limits', async () => {
  const f = fixture(), prompt = '界'.repeat(32000), response = '答'.repeat(16000);
  await f.sandbox.startTask(prompt, 'pi'); f.complete(response);
  const chat = await f.sandbox.conversation(); assert.equal(chat.turns[0].prompt, prompt); assert.equal(chat.turns[0].response, response);
});


test('compiled UI and self-hosted fonts remain public while task data stays protected', async () => {
  const fetched: string[] = [];
  const env = { RUNNER_API_TOKEN: 'test-runner', ASSETS: { fetch: async (request: Request) => { fetched.push(new URL(request.url).pathname); return new Response('static'); } } };
  for (const path of ['/', '/favicon.svg', '/assets/index-hash.js', '/assets/font-hash.woff2']) {
    const response = await handler.fetch(new Request(`https://runner.test${path}`), env);
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy')!;
    assert.ok(csp.includes("font-src 'self'")); assert.ok(!csp.includes('unsafe-inline'));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const path of ['/sandboxes/pi-private/diff', '/sandboxes/pi-private/messages', '/.dev.vars', '/assets/../.dev.vars']) assert.equal((await handler.fetch(new Request(`https://runner.test${path}`), env)).status, 401);
  assert.equal(fetched.length, 4);
});

test('manual edits refresh durable checkpoints, invalidate publication caches and reach the next native turn', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi'); f.complete('Done'); await f.sandbox.conversation();
  f.stored.set('pullRequest', { url: 'previous' }); f.stored.set('proposalChunks', 1);
  const saved = await f.sandbox.repositoryFiles('write', 'file.ts', 0, 'manual change', 'a'.repeat(64));
  assert.equal(saved.checkpointSaved, true); assert.equal(f.stored.get('workspaceRevision'), 1); assert.equal(f.stored.has('pullRequest'), false);
  assert.equal(f.stored.get('checkpoint').workspaceRevision, 1); assert.equal(f.stored.get('proposalChunks'), undefined);
  await f.container.destroy(); await f.restart().repositoryFiles('read', 'file.ts'); assert.equal(f.restores, 1);
  await f.sandbox.sendMessage(crypto.randomUUID(), 'Continue'); assert.ok(f.lastLaunch.includes('file.ts')); assert.ok(f.lastLaunch.includes('Re-read relevant files'));
  assert.equal(f.stored.has('editorPaths'), false); assert.equal(f.spawns, 2);
});
test('file writes cannot race an active agent and a failed manual checkpoint never restores stale files', async () => {
  const f = fixture(); await f.sandbox.startTask('First', 'pi');
  await assert.rejects(f.sandbox.repositoryFiles('write','file.ts',0,'changed','a'.repeat(64)), /Stop the agent/); assert.equal(f.fileRequests.length, 0);
  f.complete('Done'); await f.sandbox.conversation(); f.failCheckpoint();
  const saved = await f.sandbox.repositoryFiles('write','file.ts',0,'changed','a'.repeat(64)); assert.equal(saved.checkpointSaved, false); assert.match(saved.warning, /recovery could not be updated/);
  const info = await f.sandbox.conversation(); assert.equal(info.checkpointSaved,false);
  await f.container.destroy(); await assert.rejects(f.restart().repositoryFiles('read','file.ts'), /no recoverable workspace/); assert.equal(f.restores,0);
});
test('file routes preserve authentication, CSRF checks, version validation and private cache headers', async () => {
  const received: unknown[][] = [];
  const env = { ...config, MODEL_API_KEY:'test-key', RUNNER_API_TOKEN:'test-runner', SANDBOX:{getByName:()=>({repositoryFiles:async(...args:unknown[])=>{received.push(args);return {path:'file.ts',content:'text',version:'a'.repeat(64)};}})}};
  const root = 'https://runner.test/sandboxes/pi-editor';
  assert.equal((await handler.fetch(new Request(root+'/files'),env)).status,401);
  assert.equal((await handler.fetch(new Request(root+'/file',{method:'PUT',headers:{origin:'https://evil.test'},body:'{}'}),env)).status,403);
  const headers={authorization:'Bearer test-runner','content-type':'application/json'};
  const response=await handler.fetch(new Request(root+'/files?path=src',{headers}),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await handler.fetch(new Request(root+'/file',{method:'PUT',headers,body:JSON.stringify({path:'src/file.ts',content:'hello',version:'a'.repeat(64)})}),env)).status,200);
  assert.equal((await handler.fetch(new Request(root+'/file',{method:'PUT',headers,body:JSON.stringify({path:'src/file.ts',content:'hello',version:'old'})}),env)).status,400);
  assert.deepEqual(received,[['list','src',0],['write','src/file.ts',0,'hello','a'.repeat(64)]]);
});
test('the editor nonce matches its CSP and never enables arbitrary inline styles or scripts',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('<html><head></head><body></body></html>',{headers:{etag:'old','content-type':'text/html'}})}};
 const response=await handler.fetch(new Request('https://runner.test/'),env);const html=await response.text();const nonce=/name="csp-nonce" content="([^"]+)"/.exec(html)?.[1];
 assert.ok(nonce);assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!response.headers.get('content-security-policy').includes('unsafe-inline'));
});
