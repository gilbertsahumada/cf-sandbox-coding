import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSession, startupText } from '../web/lib/session-start';
test('session presentation happens before a pending clone, and the agent starts only after the repository is ready', async () => {
  const events: string[] = [];
  let cloned!: () => void;
  const clone = new Promise<void>(resolve => { cloned = resolve; });
  const launch = prepareSession('opencode-test', { url: 'https://github.com/example/repo' }, { agent: 'opencode', prompt: 'Do the task' },
    async path => { events.push(path); if (path.endsWith('/repository')) await clone; },
    () => events.push('show-session-and-close-dialog'), () => events.push('starting-agent'));
  assert.deepEqual(events, ['show-session-and-close-dialog', '/sandboxes/opencode-test/repository']);
  cloned(); await launch;
  assert.deepEqual(events.slice(2), ['starting-agent', '/sandboxes/opencode-test/task']);
});
test('failed preparation never launches an agent and has a distinct visible failure message', async () => {
  const paths: string[] = [];
  await assert.rejects(prepareSession('pi-test', {}, { agent: 'pi', prompt: 'Task' }, async path => { paths.push(path); throw Error('Clone denied'); }, () => {}, () => assert.fail('Agent must not start')), /Clone denied/);
  assert.deepEqual(paths, ['/sandboxes/pi-test/repository']);
  const startup = { task: 'pi-test', prompt: 'Task', agent: 'pi' as const, startedAt: 0, stage: 'failed' as const, error: 'Clone denied' };
  assert.match(startupText(startup), /Session preparation failed.*Clone denied/);
  assert.match(startupText({ ...startup, stage: 'starting' }), /Starting Pi/);
});
