import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticated, hasBearer, sameOrigin, sessionCookie } from '../src/auth';
const token = 'test-token-only';
test('bearer and protected cookie authenticate; empty and malformed credentials fail', () => {
  assert.ok(hasBearer(new Request('https://runner.test/health', { headers: { authorization: `Bearer ${token}` } }), token));
  assert.ok(authenticated(new Request('https://runner.test/health', { headers: { cookie: `other=1; __Host-runner=${token}` } }), token));
  for (const cookie of ['__Host-runner=wrong', '__Host-runner=%zz', 'other=test-token-only']) assert.equal(authenticated(new Request('https://runner.test/health', { headers: { cookie } }), token), false);
  assert.equal(authenticated(new Request('https://runner.test'), ''), false);
});
test('cookie mutations require the exact page origin', () => {
  for (const origin of ['https://evil.test', 'https://runner.test.evil', 'http://runner.test', 'null']) assert.equal(sameOrigin(new Request('https://runner.test/task', { headers: { origin } })), false);
  assert.ok(sameOrigin(new Request('https://runner.test/task', { headers: { origin: 'https://runner.test' } })));
  assert.equal(sameOrigin(new Request('https://runner.test/task')), false);
});
test('session cookie is inaccessible to scripts, secure, host-only, and expires on logout', () => {
  const cookie = sessionCookie(token);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes('Domain='));
  assert.ok(sessionCookie('', true).includes('Max-Age=0'));
  assert.ok(sessionCookie('abc; injected').includes('abc%3B%20injected'));
});
