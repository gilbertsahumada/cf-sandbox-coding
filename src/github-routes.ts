import { repositorySelection } from './repository-selection';
import { validState } from './github-api';
const flowCookie = '__Host-github-flow';
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const cookie = (state: string, clear = false) => `${flowCookie}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 1800}`;
function flowState(request: Request): string {
  return request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${flowCookie}=`))?.slice(flowCookie.length + 1) || '';
}
export async function githubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!validState(state, flowState(request))) return new Response('The GitHub connection expired or belongs to another browser. Return to the app and reconnect.', { status: 400, headers });
  const connection = env.GITHUB.getByName('owner');
  try {
    if (url.pathname === '/github/manifest/callback') {
      const code = url.searchParams.get('code');
      if (!code || code.length > 256) return new Response('GitHub did not return a valid code.', { status: 400, headers });
      const location = await connection.completeManifest(code, state);
      return new Response(null, { status: 303, headers: { ...headers, location } });
    }
    const id = Number(url.searchParams.get('installation_id'));
    if (!Number.isSafeInteger(id) || id <= 0) return new Response('GitHub did not return a valid installation.', { status: 400, headers });
    await connection.completeInstallation(id, state);
    return new Response(null, { status: 303, headers: { ...headers, location: '/?github=connected', 'set-cookie': cookie('', true) } });
  } catch (error) {
    // RPC failures can happen before the registration method begins. Record a redacted diagnostic too.
    let detail = error instanceof Error ? error.message : 'GitHub callback failed';
    for (const secret of [state, url.searchParams.get('code')]) if (secret) detail = detail.split(secret).join('[redacted]');
    await connection.recordSetupFailure(detail.slice(0, 240));
    const status = await connection.status();
    const message = status.setupExpired
      ? 'The GitHub connection attempt expired. Return to the app and click Connect GitHub to try again.'
      : 'GitHub could not complete registration. Diagnostics were saved for review. Return to the app to continue.';
    return new Response(message, { status: 400, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
  }
}
export async function githubRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const connection = env.GITHUB.getByName('owner');
  try {
    if (url.pathname === '/github/status' && request.method === 'GET') return Response.json(await connection.status(), { headers });
    if (url.pathname === '/github/connect' && request.method === 'POST') {
      const flow = await connection.begin(url.origin);
      const { state, ...publicFlow } = flow;
      return Response.json(publicFlow, { headers: { ...headers, 'set-cookie': cookie(state) } });
    }
    if (url.pathname === '/github/selected-repository' && request.method === 'GET') return Response.json(await connection.selectedRepository(), { headers });
    if (url.pathname === '/github/selected-repository' && request.method === 'PUT') {
      const selection = repositorySelection(await request.json().catch(() => null));
      if (!selection) return Response.json({ message: 'Choose a valid repository.' }, { status: 400, headers });
      return Response.json(await connection.rememberRepository(selection), { headers });
    }
    if (url.pathname === '/github/repositories' && request.method === 'GET') {
      const page = Number(url.searchParams.get('page') || '1');
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return new Response('Invalid page', { status: 400 });
      return Response.json(await connection.repositories(page), { headers });
    }
    if (url.pathname === '/github/connection' && request.method === 'DELETE') return Response.json(await connection.disconnect(), { headers });
    return new Response('Not found', { status: 404, headers });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : 'Could not query GitHub.' }, { status: 502, headers });
  }
}
