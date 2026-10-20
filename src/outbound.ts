import { WorkerEntrypoint } from "cloudflare:workers";
import { outboundRequest } from "./network";
import { gitReadRequest, type RepositoryGrant } from "./github-api";
export class Outbound extends WorkerEntrypoint<Env, { grant?: RepositoryGrant }> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const grant = this.ctx.props.grant;
    if (grant && url.hostname === 'github.com') {
      // Reject other repositories and pushes before minting or attaching a token.
      const probe = gitReadRequest(request, grant, 'probe');
      if (probe instanceof Response) return probe;
      try {
        const token = await this.env.GITHUB.getByName('owner').tokenForRepository(grant);
        const authorized = gitReadRequest(request, grant, token);
        return authorized instanceof Response ? authorized : fetch(authorized);
      } catch { return new Response('GitHub access was revoked or is unavailable', { status: 403 }); }
    }
    const result = outboundRequest(request, this.env.MODEL_BASE_URL, this.env.MODEL_API_KEY);
    return result instanceof Response ? result : fetch(result);
  }
}
