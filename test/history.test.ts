import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import { historyForStorage, recoveredRun } from '../public/run-history.js';
const id = 'pi-c1b27699-7c4d-47c3-8196-cc624194d6de';
test('private runs survive reload without persisting repository details, instructions, logs or credentials', () => {
  const run = { id, agent: 'pi', private: true, repository: 'https://github.com/owner/secret-project.git', ref: 'secret-branch', prompt: 'confidential task', token: 'sensitive-credential', stdout: 'private-code', startedAt: 1000, state: 'running' };
  const stored = JSON.stringify(historyForStorage([run]));
  for (const secret of ['secret-project', 'secret-branch', 'confidential task', 'sensitive-credential', 'private-code']) assert.ok(!stored.includes(secret));
  const [restored] = historyForStorage(JSON.parse(stored));
  assert.equal(restored.id, id);
  assert.equal(restored.state, 'running');
  assert.equal(restored.private, true);
  assert.equal(restored.repository, 'Repositorio privado');
});
test('recovery accepts task identifiers without inventing a start time or restarting an agent', () => {
  const run = recoveredRun(id);
  assert.equal(run.agent, 'pi');
  assert.equal(run.startedAt, null);
  assert.equal(run.private, true);
  for (const value of [null, '', '../task', 'pi-../../secret', 'https://evil.example', 'x'.repeat(64), 'unknown-id']) assert.equal(recoveredRun(value), null);
});
test('history validation discards malformed entries and preserves public history', () => {
  const publicRun = { id, agent: 'pi', repository: 'https://github.com/octocat/Hello-World', ref: 'main', state: 'succeeded', startedAt: 1000, finishedAt: 2000 };
  const saved = historyForStorage([null, {}, { ...publicRun, id: '../bad' }, publicRun]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].repository, publicRun.repository);
  assert.equal(saved[0].finishedAt, 2000);
  assert.equal(historyForStorage(Array.from({ length: 20 }, () => publicRun)).length, 12);
});
