import { repositorySelection, type RepositorySelection } from './repository-selection';
import { DurableObject } from 'cloudflare:workers';
import { appJwt, appManifest, githubRequest, validState, type GitHubApp, type GitHubRepository, type RepositoryGrant } from './github-api';
type Flow = { state: string; expires: number; phase: 'manifest' | 'exchange' | 'install'; codeHash?: string };
type Installation = { id: number; account: string };
// This runner is owned by one operator. Its GitHub App identity stays server-side.
export class GitHubConnection extends DurableObject<Env> {
  private tokens = new Map<string, { token: string; expires: number }>();
  async begin(origin: string) {
    const app = this.ctx.storage.kv.get<GitHubApp>('app');
    const state = crypto.randomUUID() + crypto.randomUUID();
    this.ctx.storage.kv.put('flow', { state, expires: Date.now() + 30 * 60_000, phase: app ? 'install' : 'manifest' } satisfies Flow);
    if (app) return { state, url: this.installUrl(app.slug, state) };
    return { state, action: `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`, manifest: appManifest(origin, crypto.randomUUID().slice(0, 8)) };
  }
  async completeManifest(code: string, state: string) {
    try { return await this.exchangeManifest(code, state); } catch (error) {
      this.ctx.storage.kv.put('lastError', { stage: 'manifest', message: error instanceof Error ? error.message : 'No se pudo intercambiar el registro.' });
      throw error;
    }
  }
  private async exchangeManifest(code: string, state: string) {
    const flow = this.ctx.storage.kv.get<Flow>('flow');
    if (!flow || flow.expires < Date.now() || !validState(state, flow.state)) throw new Error('La conexión venció. Pulsa Conectar GitHub para volver a intentarlo.');
    const existing = this.ctx.storage.kv.get<GitHubApp>('app');
    if (existing && flow.phase === 'install') return this.installUrl(existing.slug, state);
    if (!['manifest', 'exchange'].includes(flow.phase)) throw new Error('El registro ya se procesó.');
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))).toString('hex');
    if (flow.codeHash && !validState(hash, flow.codeHash)) throw new Error('El código no coincide con el registro en curso.');
    this.ctx.storage.kv.put('flow', { ...flow, phase: 'exchange', codeHash: hash });
    try {
      const data = await githubRequest(`/app-manifests/${encodeURIComponent(code)}/conversions`, undefined, {});
      const id = Number(data.id);
      const slug = typeof data.slug === 'string' ? data.slug : '';
      if (!Number.isSafeInteger(id) || typeof data.pem !== 'string' || !/^[a-zA-Z0-9-]+$/.test(slug)) {
        this.ctx.storage.kv.put('registrationShape', { idType: typeof data.id, hasPem: typeof data.pem === 'string', slug });
        throw new Error('GitHub devolvió una configuración de registro inesperada.');
      }
      const app: GitHubApp = { id, slug, pem: data.pem, owner: data.owner?.login || '' };
      this.ctx.storage.kv.put('app', app);
      this.ctx.storage.kv.put('flow', { ...flow, phase: 'install' });
      this.ctx.storage.kv.delete('lastError');
      return this.installUrl(app.slug, state);
    } catch (error) {
      this.ctx.storage.kv.put('lastError', { stage: 'manifest', message: error instanceof Error ? error.message : 'No se pudo intercambiar el registro.' });
      throw error;
    }
  }
  async completeInstallation(id: number, state: string) {
    this.checkFlow(state, 'install');
    const app = this.app();
    const info = await githubRequest(`/app/installations/${id}`, appJwt(app));
    if (info.app_id !== app.id || info.suspended_at) throw new Error('La instalación no corresponde a esta aplicación o está suspendida.');
    const installations = this.ctx.storage.kv.get<Installation[]>('installations') || [];
    this.ctx.storage.kv.put('installations', [...installations.filter(item => item.id !== id), { id, account: info.account.login }]);
    this.ctx.storage.kv.delete('flow');
    this.tokens.clear();
  }
  async recordSetupFailure(message: string) {
    this.ctx.storage.kv.put('lastError', { stage: 'callback', message });
  }
  async status() {
    const app = this.ctx.storage.kv.get<GitHubApp>('app');
    const installations = this.ctx.storage.kv.get<Installation[]>('installations') || [];
    return { connected: installations.length > 0, accounts: installations.map(item => item.account), registered: Boolean(app),
      setupPhase: this.ctx.storage.kv.get<Flow>('flow')?.phase || null, setupExpired: (this.ctx.storage.kv.get<Flow>('flow')?.expires || 0) < Date.now(), lastError: this.ctx.storage.kv.get('lastError') || null, registrationShape: this.ctx.storage.kv.get('registrationShape') || null,
      manageUrl: app ? `https://github.com/settings/installations` : null };
  }
  async repositories(page: number) {
    const installations = this.ctx.storage.kv.get<Installation[]>('installations') || [];
    if (!installations.length) throw new Error('Conecta GitHub para elegir tus repositorios.');
    const batches = await Promise.all(installations.map(async installation => {
      const token = await this.installationToken(installation.id);
      const response = await githubRequest(`/installation/repositories?per_page=100&page=${page}`, token);
      return { total: response.total_count as number, more: response.repositories.length === 100, repositories: response.repositories.map((repo: any): GitHubRepository => ({
        installationId: installation.id, repositoryId: repo.id, fullName: repo.full_name,
        url: `https://github.com/${repo.full_name}.git`, private: repo.private, defaultBranch: repo.default_branch,
      })) };
    }));
    return { repositories: batches.flatMap(batch => batch.repositories), total: batches.reduce((sum, batch) => sum + batch.total, 0), hasMore: batches.some(batch => batch.more) };
  }
  async repository(installationId: number, repositoryId: number): Promise<GitHubRepository> {
    const token = await this.installationToken(installationId, repositoryId);
    const repo = await githubRequest(`/repositories/${repositoryId}`, token);
    if (repo.id !== repositoryId || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) throw new Error('Repositorio inválido.');
    return { installationId, repositoryId, fullName: repo.full_name, url: `https://github.com/${repo.full_name}.git`, private: repo.private, defaultBranch: repo.default_branch };
  }
  async selectedRepository(): Promise<{ repository: GitHubRepository | null; warning?: string }> {
    const selection = this.ctx.storage.kv.get<RepositorySelection>('selectedRepository');
    if (!selection) return { repository: null };
    try { return { repository: await this.repository(selection.installationId, selection.repositoryId) }; }
    catch { return { repository: null, warning: 'No pudimos recuperar el repositorio anterior. Comprueba que siga autorizado en GitHub.' }; }
  }
  async rememberRepository(value: unknown): Promise<{ repository: GitHubRepository }> {
    const selection = repositorySelection(value);
    if (!selection) throw new Error('Repositorio inválido.');
    const repository = await this.repository(selection.installationId, selection.repositoryId);
    this.ctx.storage.kv.put('selectedRepository', selection);
    return { repository };
  }
  async tokenForRepository(grant: RepositoryGrant): Promise<string> {
    return this.installationToken(grant.installationId, grant.repositoryId);
  }
  async disconnect() {
    const installations = this.ctx.storage.kv.get<Installation[]>('installations') || [];
    this.ctx.storage.kv.delete('installations');
    this.ctx.storage.kv.delete('selectedRepository');
    this.ctx.storage.kv.delete('flow');
    this.tokens.clear();
    // Removing the installations revokes even the short-lived tokens minted earlier.
    const app = this.ctx.storage.kv.get<GitHubApp>('app');
    if (app) {
      const results = await Promise.allSettled(installations.map(item => githubRequest(`/app/installations/${item.id}`, appJwt(app), undefined, 'DELETE')));
      if (results.some(result => result.status === 'rejected')) return { disconnected: true, warning: 'El runner se desconectó. Revisa en GitHub las instalaciones que no se pudieron revocar.' };
    }
    return { disconnected: true };
  }
  private app(): GitHubApp {
    const app = this.ctx.storage.kv.get<GitHubApp>('app');
    if (!app) throw new Error('Primero registra la conexión con GitHub.');
    return app;
  }
  private checkFlow(state: string, phase: Flow['phase']): Flow {
    const flow = this.ctx.storage.kv.get<Flow>('flow');
    if (!flow || flow.expires < Date.now() || flow.phase !== phase || !validState(state, flow.state)) throw new Error('La conexión venció o no pertenece a este navegador. Vuelve a conectar GitHub.');
    return flow;
  }
  private installUrl(slug: string, state: string) { return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`; }
  private async installationToken(id: number, repositoryId?: number): Promise<string> {
    const installations = this.ctx.storage.kv.get<Installation[]>('installations') || [];
    if (!installations.some(item => item.id === id)) throw new Error('Esta cuenta de GitHub no está conectada.');
    const key = `${id}:${repositoryId || 'list'}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const result = await githubRequest(`/app/installations/${id}/access_tokens`, appJwt(this.app()), { permissions: { contents: 'read' }, ...(repositoryId ? { repository_ids: [repositoryId] } : {}) });
    this.tokens.set(key, { token: result.token, expires: Date.parse(result.expires_at) });
    return result.token;
  }
}
