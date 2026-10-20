import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
let secrets = {};
let runner = {};
try { secrets = parseEnv(await readFile('.dev.vars', 'utf8')); } catch {}
try { runner = JSON.parse(await readFile('runner.json', 'utf8')); } catch {}
const workerURL = process.env.WORKER_URL ?? runner.url;
const runnerToken = process.env.RUNNER_API_TOKEN ?? secrets.RUNNER_API_TOKEN;
const [agent, repository, prompt] = process.argv.slice(2);
if (!['pi', 'opencode'].includes(agent) || !repository || !prompt || !workerURL || !runnerToken) {
  console.error('Uso: WORKER_URL=... RUNNER_API_TOKEN=... npm run task -- pi|opencode https://github.com/owner/repo "Instrucción"');
  process.exit(1);
}
const name = `${agent}-${crypto.randomUUID()}`;
const base = `${workerURL.replace(/\/$/, '')}/sandboxes/${name}`;
async function request(resource, body) {
  const response = await fetch(`${base}/${resource}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${runnerToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response;
}
console.log(`Sandbox: ${name}`);
await request('repository', { url: repository });
await request('task', { agent, prompt });
for (;;) {
  const result = await (await request('task')).json();
  if (!['running', 'none'].includes(result.state)) {
    console.log(JSON.stringify(result, null, 2));
    console.log(await (await request('diff')).text());
    if (result.state !== 'succeeded') process.exitCode = 1;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 3000));
}
