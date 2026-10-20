import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { appJwt, appManifest, gitReadRequest, validState } from '../src/github-api';
const grant = { installationId: 1, repositoryId: 42, fullName: 'owner/private-repo' };
test('GitHub App requests only read access and no user OAuth scopes or webhooks', () => {
  const manifest = appManifest('https://runner.example', 'test');
  assert.deepEqual(manifest.default_permissions, { contents: 'read', metadata: 'read' });
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
  assert.equal(manifest.request_oauth_on_install, false);
  assert.equal(manifest.setup_url, 'https://runner.example/github/install/callback');
});
test('app JWT is signed with RS256 and expires within GitHub ten-minute maximum', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 1792454400000;
  const jwt = appJwt({ id: 123, slug: 'test', pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), owner: 'owner' }, now);
  const [header, payload, signature] = jwt.split('.');
  assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, '123'); assert.equal(claims.iat, now / 1000 - 60); assert.equal(claims.exp, now / 1000 + 540);
});
test('callback state must match, including byte length; absent state is rejected', () => {
  assert.ok(validState('random-state', 'random-state'));
  for (const candidate of ['', 'different', 'random-statex']) assert.equal(validState(candidate, 'random-state'), false);
  assert.equal(validState('', ''), false);
});
test('private clone gets credentials only on exact read-only smart Git paths', () => {
  for (const [method, suffix] of [['GET', '/info/refs?service=git-upload-pack'], ['POST', '/git-upload-pack']]) {
    const result = gitReadRequest(new Request(`https://github.com/owner/private-repo.git${suffix}`, { method, headers: { cookie: 'not-forwarded=1', authorization: 'attacker' } }), grant, 'test-credential');
    assert.ok(result instanceof Request);
    assert.equal(result.headers.get('authorization'), 'Basic ' + btoa('x-access-token:test-credential'));
    assert.equal(result.headers.get('cookie'), null);
    assert.equal(result.redirect, 'manual');
  }
});
test('private clone denies push, other repositories, other ports, redirects and API requests', () => {
  const blocked = [
    ['POST','https://github.com/owner/private-repo.git/git-receive-pack'],
    ['GET','https://github.com/owner/private-repo.git/info/refs?service=git-receive-pack'],
    ['GET','https://github.com/owner/another.git/info/refs?service=git-upload-pack'],
    ['GET','http://github.com/owner/private-repo.git/info/refs?service=git-upload-pack'],
    ['GET','https://github.com:8443/owner/private-repo.git/info/refs?service=git-upload-pack'],
    ['GET','https://github.com.evil/owner/private-repo.git/info/refs?service=git-upload-pack'],
    ['GET','https://api.github.com/repos/owner/private-repo/contents'],
    ['GET','https://github.com/owner/private-repo.git/info/refs?service=git-upload-pack&extra=1'],
    ['POST','https://github.com/owner/private-repo.git/git-upload-pack?extra=1'],
  ];
  for (const [method,url] of blocked) {
    const response = gitReadRequest(new Request(url, { method }), grant, 'must-not-leak');
    assert.ok(response instanceof Response, url); assert.equal(response.status, 403);
  }
});

test('manifest exchange reports GitHub status without retaining credentials from the response', async (t) => {
  const { githubRequest, GitHubApiError } = await import('../src/github-api');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'API rate limit exceeded', pem: 'must-not-be-retained' }, { status: 403 }));
  await assert.rejects(githubRequest('/app-manifests/test-code/conversions', undefined, {}), error => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 403);
    assert.equal(error.operation, 'manifest');
    assert.equal(error.message, 'GitHub (403): API rate limit exceeded');
    assert.ok(!JSON.stringify(error).includes('must-not-be-retained'));
    return true;
  });
});


test('GitHub API uses Cloudflare-compatible manual redirects and rejects a redirected exchange', async (t) => {
  const { githubRequest, GitHubApiError } = await import('../src/github-api');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://other.example/secret' } });
  });
  await assert.rejects(githubRequest('/app-manifests/test-code/conversions', undefined, {}), error => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 302);
    return true;
  });
  assert.equal(calls, 1);
});
