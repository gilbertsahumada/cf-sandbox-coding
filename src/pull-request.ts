import { createHash } from 'node:crypto';
import { z } from 'zod';
export const ChangeSet = z.object({ files: z.array(z.object({
  path: z.string().min(1).max(4096).refine(path => !path.startsWith('/') && !path.split('/').some(part => !part || ['.', '..', '.git'].includes(part)) && !/[\u0000-\u001f\ufffd]/u.test(path)),
  mode: z.enum(['100644', '100755', '120000', '160000']),
  type: z.enum(['blob', 'commit']), sha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  content: z.string().max(7 * 1024 * 1024).optional(),
})).max(200) });
export type Changes = z.infer<typeof ChangeSet>;
export type Proposal = Changes & { baseCommit: string; baseBranch: string };
export type PullRequest = { url: string; number: number; branch: string };
export function validateChanges(input: unknown): Changes {
  const changes = ChangeSet.parse(input);
  if (!changes.files.length) throw Error('This task has no changes to publish.');
  const paths = new Set<string>();
  let size = 0;
  for (const file of changes.files) {
    if (paths.has(file.path)) throw Error('The proposal contains duplicate paths.');
    paths.add(file.path);
    if (file.path.startsWith('.github/workflows/')) throw Error('This proposal modifies workflows. Download the patch to review and publish it locally.');
    if (!['.env.example', '.dev.vars.example'].includes(file.path.split('/').at(-1)!) && /(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|id_rsa|id_ed25519)$|\.(pem|key)$/i.test(file.path)) throw Error('The proposal contains a credential file. Review it locally.');
    if (changes.files.some(other => other.path !== file.path && other.path.startsWith(file.path + '/'))) throw Error('The proposal replaces a file with a directory or vice versa. Download the patch to publish it locally.');
    if ((file.mode === '160000') !== (file.type === 'commit')) throw Error('Invalid Git object mode');
    if (file.sha && file.type === 'blob') {
      if (file.content === undefined || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw Error('Invalid blob encoding');
      const bytes = Buffer.from(file.content, 'base64'); size += bytes.length;
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (sha !== file.sha) throw Error('The file content does not match its Git identifier.');
    } else if (file.content !== undefined) throw Error('Unexpected blob content');
  }
  if (size > 5 * 1024 * 1024) throw Error('The proposal exceeds 5 MB. Download the patch.');
  return changes;
}

type Api = (path: string, body?: unknown, method?: string) => Promise<any>;
// Each checkpoint is persisted before the next write. Retries reconcile references and PRs.
export async function publishProposal(api: Api, repo: string, taskId: string, proposal: Proposal,
  title: string, body: string, saved: { commit?: string }, checkpoint: (value: { commit: string }) => void): Promise<PullRequest> {
  const root = `/repos/${repo}`, branch = `sandbox/${taskId}`;
  let commit = saved.commit;
  if (!commit) {
    const base = await api(`${root}/git/commits/${proposal.baseCommit}`);
    const tree = [];
    for (const file of proposal.files) {
      let sha = file.sha;
      if (sha && file.type === 'blob') sha = (await api(`${root}/git/blobs`, { content: file.content, encoding: 'base64' })).sha;
      tree.push({ path: file.path, mode: file.mode, type: file.type, sha });
    }
    const next = await api(`${root}/git/trees`, { base_tree: base.tree.sha, tree });
    commit = (await api(`${root}/git/commits`, { message: title, tree: next.sha, parents: [proposal.baseCommit] })).sha as string;
    checkpoint({ commit });
  }
  let ref;
  try { ref = await api(`${root}/git/ref/heads/${branch}`); }
  catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
  if (ref && ref.object.sha !== commit) throw Error('The task branch already exists with different content. It was not overwritten.');
  if (!ref) {
    try { await api(`${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit }); }
    catch (error) {
      const found = await api(`${root}/git/ref/heads/${branch}`).catch(() => null);
      if (found?.object.sha !== commit) throw error;
    }
  }
  const query = `?state=all&head=${encodeURIComponent(repo.split('/')[0] + ':' + branch)}&base=${encodeURIComponent(proposal.baseBranch)}`;
  let pr = (await api(`${root}/pulls${query}`))[0];
  if (!pr) {
    try { pr = await api(`${root}/pulls`, { title, body, head: branch, base: proposal.baseBranch, draft: true }); }
    catch (error) { pr = (await api(`${root}/pulls${query}`))[0]; if (!pr) throw error; }
  }
  if (!Number.isSafeInteger(pr.number) || pr.html_url !== `https://github.com/${repo}/pull/${pr.number}`) throw Error('GitHub returned an unexpected link.');
  return { url: pr.html_url, number: pr.number, branch };
}
