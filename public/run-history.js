const agents = new Set(['pi', 'opencode']);
const states = new Set(['cloning', 'running', 'stopping', 'cancelled', 'succeeded', 'failed', 'lost', 'none']);
export function recoveredRun(id) {
  if (typeof id !== 'string' || id.length > 63 || !/^(pi|opencode)-[a-z0-9-]+$/.test(id)) return null;
  return { id, agent: id.startsWith('opencode-') ? 'opencode' : 'pi', private: true, repository: 'Sesión recuperada', ref: '', state: 'running', startedAt: null };
}
export function historyForStorage(runs) {
  return runs.filter(run => run && agents.has(run.agent) && recoveredRun(run.id) && typeof run.repository === 'string').slice(0, 12).map(run => ({
    id: run.id, agent: run.agent, private: Boolean(run.private),
    repository: run.private ? 'Repositorio privado' : run.repository,
    ref: run.private ? '' : (typeof run.ref === 'string' ? run.ref : ''),
    startedAt: Number.isFinite(run.startedAt) ? run.startedAt : null,
    ...(Number.isFinite(run.finishedAt) ? { finishedAt: run.finishedAt } : {}),
    state: states.has(run.state) ? run.state : 'none',
  }));
}
