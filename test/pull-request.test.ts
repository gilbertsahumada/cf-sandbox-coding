import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateChanges, publishProposal, type Proposal } from '../src/pull-request';
// @ts-expect-error The exporter runs as a standalone container module.
import { exportChanges } from '../container/export-changes.mjs';
const blob = (path = 'file.txt', bytes = Buffer.from('changed')) => ({ path, mode: '100644' as const, type: 'blob' as const,
  sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), content: bytes.toString('base64') });
const proposal: Proposal = { baseCommit: 'a'.repeat(40), baseBranch: 'main', files: [blob()] };
test('export preserves binary data, deletions, renames, executable bits, symlinks and agent commits without changing the real index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'proposal-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
    writeFileSync(join(directory, 'delete.txt'), 'remove'); writeFileSync(join(directory, 'rename.txt'), 'rename');
    git('add', '.'); git('commit', '-qm', 'Initial'); const base = git('rev-parse', 'HEAD');
    rmSync(join(directory, 'delete.txt')); renameSync(join(directory, 'rename.txt'), join(directory, 'renamed.txt'));
    const bytes = Buffer.from([0, 255, 1, 128]); writeFileSync(join(directory, 'binary.bin'), bytes);
    writeFileSync(join(directory, 'script.sh'), '#!/bin/sh\n'); chmodSync(join(directory, 'script.sh'), 0o755);
    symlinkSync('binary.bin', join(directory, 'link')); mkdirSync(join(directory, 'dir')); writeFileSync(join(directory, 'dir/new.txt'), 'é🙂');
    git('add', '.'); git('commit', '-qm', 'Agent commit'); writeFileSync(join(directory, 'untracked.txt'), 'new');
    const index = readFileSync(join(directory, '.git/index'));
    const changes = validateChanges(exportChanges(directory, base));
    assert.deepEqual(readFileSync(join(directory, '.git/index')), index);
    assert.equal(changes.files.find(file => file.path === 'delete.txt')?.sha, null);
    assert.equal(changes.files.find(file => file.path === 'rename.txt')?.sha, null);
    assert.equal(changes.files.find(file => file.path === 'script.sh')?.mode, '100755');
    const link = changes.files.find(file => file.path === 'link')!; assert.equal(link.mode, '120000');
    assert.equal(Buffer.from(link.content!, 'base64').toString(), 'binary.bin');
    assert.deepEqual(Buffer.from(changes.files.find(file => file.path === 'binary.bin')!.content!, 'base64'), bytes);
    assert.equal(changes.files.length, 8);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('proposal validation refuses unsafe paths, secrets, workflows, corrupt bytes, duplicate files and empty proposals', () => {
  for (const path of ['../file', '/absolute', '.git/config', 'a/../b', 'a\u0000b', '.env', '.dev.vars', 'nested/.env.production', 'private.pem', '.github/workflows/deploy.yml']) {
    assert.throws(() => validateChanges({ files: [blob(path)] }), path);
  }
  assert.throws(() => validateChanges({ files: [{ ...blob(), content: 'Yg==' }] }));
  assert.throws(() => validateChanges({ files: [blob(), blob()] }));
  assert.throws(() => validateChanges({ files: [] }));
  assert.throws(() => validateChanges({ files: [{ ...blob(), mode: '160000' }] }));
  assert.doesNotThrow(() => validateChanges({ files: [blob('docs/normal.md'), blob('.env.example'), blob('.dev.vars.example')] }));
  assert.throws(() => validateChanges({ files: [{ ...blob('dir'), sha: null, content: undefined }, blob('dir/file')] }), /directory/);
});
function apiFixture() {
  const writes: { path: string; body: any }[] = [];
  let ref: any, pr: any, fail = false;
  const api = async (path: string, body?: any) => {
    if (body) writes.push({ path, body });
    if (path.includes('/git/commits/') && !body) return { tree: { sha: 'base-tree' } };
    if (path.endsWith('/git/blobs')) return { sha: proposal.files[0].sha };
    if (path.endsWith('/git/trees')) return { sha: 'new-tree' };
    if (path.endsWith('/git/commits')) return { sha: 'new-commit' };
    if (path.includes('/git/ref/heads/')) { if (ref) return ref; throw Object.assign(Error('Not found'), { status: 404 }); }
    if (path.endsWith('/git/refs')) { ref = { object: { sha: body.sha } }; return ref; }
    if (path.includes('/pulls?')) return pr ? [pr] : [];
    if (path.endsWith('/pulls')) {
      if (fail) { fail = false; throw Error('temporary failure'); }
      pr = { html_url: 'https://github.com/owner/repo/pull/8', number: 8 }; return pr;
    }
    throw Error(`Unexpected request: ${path}`);
  };
  return { api, writes, setRef: (sha: string) => ref = { object: { sha } }, failOnce: () => { fail = true; } };
}
test('publication preserves original parent and base tree, sends binary blobs, and creates a draft on its own branch', async () => {
  const fixture = apiFixture(); let saved = {};
  const result = await publishProposal(fixture.api, 'owner/repo', 'pi-test', proposal, 'Fix', 'Description', saved, value => saved = value);
  assert.equal(result.url, 'https://github.com/owner/repo/pull/8');
  assert.deepEqual(saved, { commit: 'new-commit' });
  assert.deepEqual(fixture.writes.find(write => write.path.endsWith('/git/commits'))?.body.parents, [proposal.baseCommit]);
  assert.equal(fixture.writes.find(write => write.path.endsWith('/git/trees'))?.body.base_tree, 'base-tree');
  assert.equal(fixture.writes.find(write => write.path.endsWith('/git/blobs'))?.body.encoding, 'base64');
  const request = fixture.writes.find(write => write.path.endsWith('/pulls'))!.body;
  assert.deepEqual(request, { title: 'Fix', body: 'Description', head: 'sandbox/pi-test', base: 'main', draft: true });
});
test('retry after PR failure reuses the checkpoint and branch; repeat publication returns the existing PR', async () => {
  const fixture = apiFixture(); fixture.failOnce(); let saved = {};
  const publish = () => publishProposal(fixture.api, 'owner/repo', 'pi-test', proposal, 'Fix', 'Body', saved, value => saved = value);
  await assert.rejects(publish());
  const first = await publish(), second = await publish(); assert.deepEqual(first, second);
  assert.equal(fixture.writes.filter(write => write.path.endsWith('/git/commits')).length, 1);
  assert.equal(fixture.writes.filter(write => write.path.endsWith('/git/refs')).length, 1);
  assert.equal(fixture.writes.filter(write => write.path.endsWith('/pulls')).length, 2);
});
test('publication never overwrites a conflicting branch', async () => {
  const fixture = apiFixture(); fixture.setRef('someone-elses-commit');
  await assert.rejects(publishProposal(fixture.api, 'owner/repo', 'pi-test', proposal, 'Fix', '', { commit: 'new-commit' }, () => {}), /not overwritten/);
  assert.equal(fixture.writes.length, 0);
});
