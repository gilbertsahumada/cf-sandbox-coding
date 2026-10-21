# Operations, security, and verification

## Deployment configuration

Use Node.js 24, Docker, Workers Paid, and a Cloudflare account authorized for Containers. The checked-in `wrangler.jsonc` contains an account-specific `account_id`, Worker name, model settings, asset binding, and Durable Object bindings. Review these before deploying to another account. `npm run deploy` builds `dist/ui` and then invokes Wrangler; the container image installs the pinned Pi/OpenCode versions from `Dockerfile`.

Keep `MODEL_API_KEY`, `RUNNER_API_TOKEN`, `WEB_ACCESS_CODE`, and optional `DEMO_ACCESS_CODE` as Worker secrets; local `.dev.vars` exists only for local tooling. Do not put secrets in configuration, browser storage, commits, patches, or documentation. `runner.json` holds the CLI's default URL; `WORKER_URL` overrides it. Changing model endpoint/ID does not upload a secret: use `wrangler secret put` separately.

## GitHub connection and publication

1. Sign in to the runner and select **Connect GitHub** from the repository picker.
2. Create the proposed GitHub App from its manifest, then install it on authorized repositories. No copying private keys or personal access tokens is needed.
3. The catalog lists repositories granted to that installation. Access as a collaborator does not automatically grant installation access; the owning account must authorize the installation. The App is registered as private for its owner.
4. For publication, approve **Contents: Read and write**, **Pull requests: Read and write**, and **Metadata: Read**. Existing installations must explicitly approve changed permissions; changing the code's manifest alone does not upgrade them.

App keys and installation credentials are stored in the `GITHUB` Durable Object. Cloning uses a short-lived read-only token restricted to the chosen repository. The container receives no GitHub token and `.git/config` contains no credentials. Explicit **Create PR** mints a repository-restricted write token only in the Worker.

The remembered selection stores installation/repository IDs; retrieving it revalidates access and fetches current metadata. Disconnect clears that preference, blocks new tokens, and requests installation revocation. If GitHub cannot revoke an installation, the runner reports it; review remaining installations in [GitHub settings](https://github.com/settings/installations). The App identity remains so it can be reinstalled without another registration.

Draft publication uses the initial commit and source branch, exports the cumulative changes, and creates a `sandbox/...` branch. Retries reuse existing publication state. Later changed turns can create a separate draft. No automatic merge, deployment, or recurring self-improvement loop exists.

Publication supports binary files, deletions, executable bits, and symlinks, subject to limits below. Workflow edits, recognized credential filenames, and file/directory conversions must be reviewed and published locally with the patch. `.env.example` and `.dev.vars.example` are allowed templates. Filename detection does not replace human review. Failed/stopped tasks may publish if files were captured, with their state reflected in the PR description.

## Authentication and trust boundaries

Owner sessions and the internal API token share one owner catalog and task access. Owner browser login uses a separate `WEB_ACCESS_CODE`; optional `DEMO_ACCESS_CODE` sessions are isolated by signed visitor identity and cannot access GitHub accounts or publish PRs. The internal token is accepted only as an API bearer credential. Browser sessions use signed `HttpOnly`, `Secure`, `SameSite=Strict` cookies, expiring after eight hours for owners and one hour for demo visitors. Access codes need at least 24 characters and must differ from each other, the runner token, and model key. Rotation revokes sessions for that code. Cookies contain no credential values. Mutations with that cookie require the same origin. GitHub's separate temporary flow cookie uses `SameSite=Lax` to allow its redirect back.

The browser and native agents never receive the real model key. Agents use a placeholder; `Outbound` injects the credential only for POSTs to the configured HTTPS model origin and exact `/chat/completions` or `/responses` path. Redirects are not followed with the credential. Repository code can still make model requests through that proxy: hiding the secret is not a token budget.

Egress otherwise permits GitHub GET/POST traffic without browser/provider credentials. For a GitHub App-backed task, that access is narrowed to Git read operations for the selected repository; pushes and other repositories are rejected before a token is attached. Public-URL tasks use the broader unauthenticated GitHub allowance. Package registries and other destinations are blocked, so prepare required dependencies in `Dockerfile` instead of installing them during a task.

Treat agent output, repository contents, logs, and diffs as untrusted. The UI renders assistant Markdown without executing HTML or fetching remote images. Static assets/fonts are served from the Worker origin; production uses a restrictive CSP and a style nonce for editor styles. The simulated preview alone permits the inline style overlay needed by browser annotations; its relaxed policy is not the production policy.

## Retention and recovery limits

| Resource            | Current behavior                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution           | One agent turn per sandbox at a time, up to 100 turns per conversation; each turn is limited to 30 minutes. The configured instance is `standard-1`.                                                                       |
| Lifecycle           | A roughly one-minute alarm checks active work and archives completed turns. Completed containers may stop after inactivity.                                                                                                |
| Archived output     | Last 32,000 bytes per stdout/stderr channel. The final parsed result is limited to 16,000 characters. Archived tails are not a complete event history.                                                                     |
| Diff                | Accumulated against the initial commit and persisted in chunks without deliberate truncation; command/storage failures remain possible.                                                                                    |
| Recovery checkpoint | Up to 20 MiB compressed. Contains the repository including `.git`, native conversation data, and agent configuration under `/workspace`; integrity is checked before restoration. Other filesystem locations are excluded. |
| Checkpoint failure  | The UI warns; the current environment remains available temporarily, with a 30-minute inactivity allowance. Download the patch before leaving. Unexpected loss before a checkpoint is saved cannot be recovered reliably.  |
| PR export           | At most 200 changed files and 5 MiB of exported file content. Old tasks lacking exported files or a source branch cannot publish automatically.                                                                            |
| Editor              | Regular UTF-8 text files up to 256 KiB. Symlinks, hard links, binary files, Git internals, and recognized credential paths are protected. Directory listing pages contain up to 200 entries.                               |
| Browser history     | Last 12 browser-known tasks. Private metadata is redacted; private history entries disappear on sign-out. It is not a server-side task inventory.                                                                          |
| Unsent drafts       | Messages and file drafts live in browser memory. They survive view changes, not a full reload. Saving is required for durable file changes.                                                                                |
| Archived results    | No automatic expiration/cleanup is implemented; data remains in Durable Object storage until explicitly removed through platform administration.                                                                           |

Saved files use content revisions to prevent overwriting concurrent changes. A conflict preserves the browser draft until the user chooses to reload. A save refreshes the diff/publication state and checkpoint; a checkpoint warning means the write exists only in the running environment. Old tasks can retain patches and final messages without having enough native state to resume or edit files.

## Verification levels

Do not equate a passing parser test, simulated browser flow, container smoke check, and deployed integration. Report which level was actually run; do not copy historical success claims into a new release summary.

### Repository checks

```sh
npm run format:check
npm run check
npm test
npm run build
```

`check` compiles/checks the container helpers and checks TypeScript for the Worker and browser; it is not a general lint pass. `format` applies the repository's pinned Prettier configuration; `format:check` verifies it. CI runs formatting, build, type checks, and tests without model or Cloudflare secrets. See [CONTRIBUTING.md](../CONTRIBUTING.md) for change conventions.

### Simulated browser preview

```sh
npm run preview:editor
# A separate delayed fixture:
PREVIEW_PORT=8797 node scripts/preview-editor.mjs --slow --slow-start
# Clone failure fixture:
PREVIEW_PORT=8797 node scripts/preview-editor.mjs --slow-start --fail-start
```

The preview serves built UI with fake API, SSE, repositories, and task results. It can exercise loading, chat, selectors, cancellation controls, file drafts, conflicts, and PR UI. It does not authenticate to Cloudflare/GitHub, run real agents, or prove production recovery. Never enter real credentials there. Fixture restarts reset its simulated state.

### Local container checks

```sh
docker build --platform linux/amd64 -t cf-sandbox-coding:local .
docker run --rm --platform linux/amd64 --network none -v "$PWD/scripts/smoke-container.mjs:/test.mjs:ro" cf-sandbox-coding:local node /test.mjs
docker run --rm --platform linux/amd64 --network none -v "$PWD/scripts/smoke-chat.mjs:/test.mjs:ro" cf-sandbox-coding:local node /test.mjs
```

These use the installed CLIs with a simulated OpenAI-compatible provider inside the container. They check tools, continuation, and checkpoint behavior without a real provider, but do not establish Cloudflare integration or model quality. The image may be expensive to rebuild; dependency preparation is a build-time operation.

### Explicit deployed checks

```sh
npx wrangler deploy --dry-run --outdir dist
npm run verify:live -- https://your-worker.workers.dev
npm run verify:live -- https://your-worker.workers.dev --session
npm run verify:sse
```

A Wrangler dry run checks packaging without deploying. The live scripts create real cloud tasks on the public `octocat/Hello-World` repository and consume Containers/model resources. `verify:live` exercises both agents; `--session` also checks browser-cookie authentication and origin enforcement. `verify:sse` checks live streaming/reconnection for Pi and cancellation/change preservation for OpenCode. Inspect the scripts and target URL before running them. Results go under ignored `verification/`; report their actual outcome rather than assuming stored evidence is current.

These scripts do not cover every private-repository, PR-permission, or manual-edit integration. Test those explicitly in a disposable authorized repository when the changed behavior requires it. Live verification and deployment need separate authorization from a routine refactor.

## Common symptoms

- **Sign-in asks for an access token:** use the runner token, not the model key or a GitHub personal token.
- **A repository is missing:** check the App installation's authorized repositories, then load additional catalog pages. Search only covers loaded entries.
- **A completed task cannot resume:** inspect its checkpoint reason. An archived patch alone cannot restore a native session.
- **Tools says logs are archived:** only output tails are available after shutdown; inspect task status separately to determine success or failure.
- **Create PR is blocked:** inspect the reported reason (permissions, unsupported files, missing source branch, or export limits). Review the patch locally when automatic publication is unavailable.
- **Agent finished but the session is running:** a completed turn can retain an idle container. Use **Stop session** in the header to shut it down; completed status, archived changes and checkpoints remain available. Status checks do not start containers or poll tool logs.
- **Closing the page left work running:** reconnect using the task link and stop it explicitly. Browser history is not a complete list of server processes.
