import { WorkerEntrypoint } from "cloudflare:workers";
import { outboundRequest } from "./network";
import { gitReadRequest, isGitReadRequest, type RepositoryGrant } from "./github-api";
export class Outbound extends WorkerEntrypoint<Env, { grant?: RepositoryGrant }> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const grant = this.ctx.props.grant;
    if (grant && url.hostname === 'github.com') {
      // Reject other repositories and pushes before minting or attaching a token.
      if (!isGitReadRequest(request, grant)) {
        console.info('GitHub clone', { stage: 'policy', method: request.method, status: 403, operation: url.pathname.endsWith('/git-upload-pack') ? 'upload-pack' : 'other', hasQuery: Boolean(url.search) });
        return new Response('GitHub access is limited to reading the selected repository', { status: 403 });
      }
      try {
        const token = await this.env.GITHUB.getByName('owner').tokenForRepository(grant);
        const authorized = gitReadRequest(request, grant, token);
        const response = authorized instanceof Response ? authorized : await fetch(authorized);
        console.info('GitHub clone', { stage: 'upstream', method: request.method, status: response.status, operation: url.pathname.endsWith('/git-upload-pack') ? 'upload-pack' : 'refs', hasQuery: Boolean(url.search) });
        return response;
      } catch (error) {
        console.info('GitHub clone', { stage: 'authorization', method: request.method, status: 403, reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        return new Response('GitHub access was revoked or is unavailable', { status: 403 });
      }
    }
    const result = outboundRequest(request, this.env.MODEL_BASE_URL, this.env.MODEL_API_KEY);
    return result instanceof Response ? result : fetch(result);
  }
}
