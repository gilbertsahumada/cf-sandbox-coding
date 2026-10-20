# Contributing

Thank you for your interest in improving this project. This runner executes coding agents (Pi and OpenCode) inside Cloudflare Sandboxes with an OpenAI-compatible model provider. Contributions are reviewed before being merged or deployed — there are no automatic merges or deployments.

## How contributions work

The codebase is hosted at [gilbertsahumada/cf-sandbox-coding](https://github.com/gilbertsahumada/cf-sandbox-coding). Use the runner's web interface to assign a bounded task to Pi or OpenCode against this repository:

1. Authorize this repository in the runner's GitHub App connection.
2. In the interface, select this repo, choose Pi or OpenCode, and provide a scoped task.
3. The agent works in an isolated clone. Reply in the task chat to continue with its context and changes; logs and the patch update each turn.
4. Review the diff and press **Create PR** to publish a draft branch (`sandbox/TASK-ID`) and a draft pull request from the Worker. Describe tests run; run checks before accepting the proposal.
5. Incorporate changes after review, then deploy. The next task will clone the updated version.

GitHub Actions verifies commits and pull requests without exposure of model or Cloudflare credentials. No continuous improvement loop runs without a defined task, budget, and stop condition.

## Code standards

- Write code comments, commit messages, pull request titles and descriptions, and review comments in **English**.
- Keep all user-facing interface text, accessibility labels, loading states, and application-generated messages in **English**.
- Solve one concrete task per execution. Limit changes to what is necessary for that task.
- Do not add secrets, API keys, tokens, or private files to code, logs, prompts, patches, or commits. `.dev.vars`, `.env`, and private keys must remain local.
- Do not expand network permissions, access scopes, dependencies, or execution budgets unless the task explicitly requires it.
- Maintain read-only access for the agent and its GitHub tokens. The explicit "Create PR" flow uses a write token scoped only to the selected repository, issued solely inside the Worker.

## Development

```sh
npm install           # Install dependencies.
npm run check         # Lint and type-check.
npm test              # Run the automated test suite.
npm run build         # Build the web interface.
```

Development commands:

```sh
npm run dev           # Compile the interface and start the local Worker.
npm run dev:ui        # Vite with hot reload; requires the local Worker at :8787.
npm run preview:editor # Interface with simulated data at :8795, no keys or external network.
```

Verify Docker build and container isolation:

```sh
npx wrangler deploy --dry-run --outdir dist
docker build --platform linux/amd64 -t cf-sandbox-coding:local .
```

## Testing

Run `npm run check` and `npm test` before submitting any change. Add tests when they cover a real bug fix or a meaningful new behavior. The existing suite includes 49 automated tests covering paths, SSE events, PR links, static assets under CSP, and more.

Simulated previews (`npm run preview:editor`) exercise UI states, navigation, drafts, and save flows without running real agent tasks or contacting external APIs. They do not replace verification against a deployed environment.

## Pull requests

PRs created by the agent are **drafts**. When reviewing manually submitted PRs:

- Ensure every change addresses a single well-defined task.
- Verify that `npm run check` and `npm test` pass.
- Confirm no secrets, credentials, or sensitive data are present.
- Check that diffs include binary files, deletions, renames, symlink updates, and permission changes where applicable.
- Validate that the PR title and description describe the changes and any tests performed.

The Runner's "Create PR" button creates a commit on top of the initial SHA, a `sandbox/ID-DE-TAREA` branch, and a draft PR toward the source branch. Retries reuse the branch and PR; a branch with different content is never overwritten. There are no automatic merges or deployments.

## Workspace tree management

- An subagent never deletes its own worktree; it reports its path to the main agent.
- If the main agent is inside a worktree, ask for confirmation before deleting it.
- From the repository root, the main agent can only clean up worktrees it created itself.

## What we're looking for

- Bug fixes and edge-case coverage.
- Improvements to testing, error handling, and observability.
- Cleanups and refactors that improve maintainability without changing behaviour.
- Documentation improvements.
- Dependencies prepared in the Docker image so agents can verify the project within the sandbox.

## Reporting issues

Describe the issue, steps to reproduce, expected vs. actual results, and relevant logs or screenshots. If the issue involves credentials, environments, or specific agent configurations, note those details without exposing any secret values.
