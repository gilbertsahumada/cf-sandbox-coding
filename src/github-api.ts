import { sign, timingSafeEqual } from 'node:crypto';
export type GitHubApp = { id: number; slug: string; pem: string; owner: string };
export type RepositoryGrant = { installationId: number; repositoryId: number; fullName: string };
export type GitHubRepository = RepositoryGrant & { url: string; private: boolean; defaultBranch: string };
export const githubHeaders = (token?: string): Record<string, string> => ({
  accept: 'application/vnd.github+json', 'user-agent': 'cf-sandbox-coding',
  'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}),
});
export function appJwt(app: GitHubApp, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: String(app.id) })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), app.pem).toString('base64url')}`;
}
export function validState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
export function appManifest(origin: string, suffix: string) {
  return {
    name: `Sandbox Coding ${suffix}`, url: origin,
    description: 'Seleccionar repositorios y clonarlos en sandboxes de programación con acceso de lectura.',
    public: false, hook_attributes: { url: `${origin}/github/events`, active: false },
    redirect_url: `${origin}/github/manifest/callback`, setup_url: `${origin}/github/install/callback`,
    setup_on_update: true, request_oauth_on_install: false,
    default_permissions: { contents: 'read', metadata: 'read' }, default_events: [],
  };
}
export class GitHubApiError extends Error {
  constructor(public readonly status: number, public readonly operation: string, message: string) { super(message); this.name = 'GitHubApiError'; }
}
export async function githubRequest(path: string, token?: string, body?: unknown, method?: string): Promise<any> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: method || (body ? 'POST' : 'GET'), headers: { ...githubHeaders(token), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let reason = '';
    try { const data = await response.json() as { message?: string }; reason = typeof data.message === 'string' ? data.message.slice(0, 180) : ''; } catch {}
    const operation = path.startsWith('/app-manifests/') ? 'manifest' : path.includes('/access_tokens') ? 'token' : 'api';
    // Only GitHub's error message is retained; never store response credentials or request headers.
    throw new GitHubApiError(response.status, operation, `GitHub (${response.status}): ${reason || 'No se pudo completar la operación.'}`);
  }
  return response.status === 204 ? null : response.json();
}
export function isGitReadRequest(request: Request, grant: RepositoryGrant): boolean {
  const url = new URL(request.url);
  const prefix = `/${grant.fullName}.git`;
  const allowed = (request.method === 'GET' && url.pathname === `${prefix}/info/refs` && url.search === '?service=git-upload-pack') ||
    (request.method === 'POST' && url.pathname === `${prefix}/git-upload-pack` && url.search === '');
  return url.origin === 'https://github.com' && allowed;
}
export function gitReadRequest(request: Request, grant: RepositoryGrant, token: string): Request | Response {
  if (!isGitReadRequest(request, grant)) return new Response('GitHub access is limited to reading the selected repository', { status: 403 });
  const headers = new Headers(request.headers);
  for (const key of ['authorization', 'cookie', 'x-api-key', 'cf-aig-authorization']) headers.delete(key);
  headers.set('authorization', `Basic ${btoa(`x-access-token:${token}`)}`);
  return new Request(request, { headers, redirect: 'manual' });
}
