# Cloudflare coding sessions

Run **Pi or OpenCode in Cloudflare Sandbox**, with an OpenAI-compatible model provider of your choice. The browser manages conversations, repository files, live tool activity, cumulative changes, and draft pull requests. AI Gateway is not required.

Owner access remains single-operator: owner sessions and the internal API token share access to the owner workspace. A separate demo code grants isolated visitor sessions with public repositories only; it cannot access the owner GitHub account or owner sessions. Visitors can explicitly publish draft PRs in public repositories authorized in the owner’s GitHub App. Different sessions can run concurrently in isolated sandboxes. Each session accepts one agent turn at a time; new-session preparation is serialized in the browser.

## Start a conversation

1. Open your deployed Worker and sign in with your `WEB_ACCESS_CODE`, or share the separate `DEMO_ACCESS_CODE` for an isolated demo.
2. Choose **New chat**, then select Pi or OpenCode and a repository in the message composer. Connect GitHub to browse authorized public and private repositories, or use the public example.
3. Send your first message to create the cloud session. Preparation and cloning appear in the conversation immediately.
4. Continue in the same chat after each reply. **Tools** shows live activity; **Changes** opens the cumulative diff, repository explorer, and editor.
5. Review the changes and use **Create PR** to publish a draft, or download the patch. Publication is explicit; agents do not merge or deploy changes.

Changing selectors or opening a new chat does not start an agent. Repository search filters the loaded catalog; **Load more** retrieves additional entries. The selected repository is remembered on the server after access validation.

A `/?task=ID` link reopens a known task after authentication; `/?new=1` opens an empty chat. Overview tracks sessions known to the current browser, not an account-wide server list. Browser history keeps the 12 most recent sessions plus running or unverified sessions so starting more work does not lose their references. Closing a tab or signing out does **not** stop running work: use **Stop**.

Overview and the session header separately show whether the agent is working and whether its cloud workspace is running or stopped. Use the Running filter to find active agents and idle workspaces, and stop any session directly from Overview without opening its chat. **Stop session** is available even while the agent is idle; it stops the container while preserving the completed task and its saved context. Status is checked on opening/focusing the page, every 10 seconds while the page is visible, or with the Overview refresh button. Status requests are bounded to three at a time and do not download background tool logs. An unavailable status is shown explicitly. Continuing can restore a stopped session when its current checkpoint is available.

**Start session** (Play) restores a stopped workspace from its current checkpoint without sending a model instruction. The runtime control shows a spinner while starting or while the agent works, a ready indicator for an idle running workspace, and **Stop session** beside the state. Sessions without a recoverable checkpoint cannot be started this way; their archived patch remains available.

Change and PR checks run independently of the tool stream, with a 30-second read timeout. A failed check shows **Retry changes** instead of an indefinite loading message, and cached changes remain reviewable while publication stays blocked until revalidated.

After a turn finishes, the chat shows a change summary with **Review changes** and **Create PR**. Publication opens the review form; an existing proposal offers **View PR**. Creation is blocked while the agent runs, when file edits are unsaved, or when publication requirements are not met.

## Local setup

Use Node.js 24 and install the locked dependencies:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Set `MODEL_API_KEY`, a long random `RUNNER_API_TOKEN` for programmatic API access, and a separate random `WEB_ACCESS_CODE` for browser owner access in the local `.dev.vars` file. Keep both secret; the file is excluded from Git and the Docker build context. Never use real secrets in the simulated preview.

Configure the model's base URL and exact model ID:

```sh
npm run configure -- https://api.provider.example/v1 model-id
# If the provider uses Responses instead of Chat Completions:
npm run configure -- https://api.provider.example/v1 model-id responses
npm run types
```

The model must support tools and streaming. Review `MODEL_CONTEXT_WINDOW` and `MODEL_MAX_TOKENS` in `wrangler.jsonc`; the configured values are limits supplied to the adapters, not verified model capabilities. The checked-in configuration currently targets Qwen; replace it for another provider.

```sh
npm run dev            # Build UI and run the local Worker (Docker required).
npm run dev:ui         # Vite UI with hot reload; needs the Worker on :8787.
npm run preview:editor # Simulated UI on :8795; no Cloudflare or model calls.
```

The fixture preview uses `fixture-access-code-for-preview-only` if you test signing out and back in. Run it with `--slow`, `--slow-start`, `--long-running` (two-minute simulated turns), or `--fail-start` to inspect loading and error states. Wrangler serves the built UI, so rebuild after editing it unless using the Vite development server. Container TypeScript is compiled automatically by `check`, `test`, and `build`, and inside the Docker image build; see the [container build guide](docs/ARCHITECTURE.md#container-typescript-build).

## Validate and deploy

```sh
npm run format:check
npm run check
npm test
npm run build
```

Deployment needs Workers Paid, Docker, and a Cloudflare account with Containers access. Review the account and Worker name in `wrangler.jsonc` before deploying:

```sh
npx wrangler login
npx wrangler secret put MODEL_API_KEY
npx wrangler secret put RUNNER_API_TOKEN
npx wrangler secret put WEB_ACCESS_CODE
# Optional isolated demo access:
npx wrangler secret put DEMO_ACCESS_CODE
npm run deploy
```

The deployed assets and API share the Worker origin. The page is public, but task operations and results require authentication. The model key and GitHub credentials remain in Cloudflare, outside the browser and container.

For the CLI, set the deployed URL in `runner.json` or `WORKER_URL`. The client reads `RUNNER_API_TOKEN` from the environment or `.dev.vars` and accepts public GitHub URLs:

```sh
npm run task -- pi https://github.com/owner/repo "Fix the bug and run the relevant checks. Do not commit."
npm run task -- opencode https://github.com/owner/repo "Add parser tests. Do not commit."
```

## Maintenance guide

- [Contribution standards](CONTRIBUTING.md): formatting, types, comments, and required checks.
- [Architecture and code ownership](docs/ARCHITECTURE.md): modules, state transitions, and where to make changes.
- [API reference](docs/API.md): authentication, task endpoints, streaming, files, and publication.
- [Operations and security](docs/OPERATIONS.md): GitHub setup, recovery limits, data handling, testing, and deployment checks.
- [Self-improvement workflow](docs/SELF_IMPROVEMENT.md): use this repository as agent input while keeping changes reviewable.
- [Brand asset provenance](docs/BRAND_ASSETS.md): sources for the bundled agent and hosting marks.

Comments, interface text, accessibility labels, and application messages are in English. Keep comments focused on invariants and non-obvious decisions; use descriptive names and TypeScript types for the ordinary flow. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution standards. Local agent instructions are excluded from version control.

## Upstream references

The container coordination follows the [Cloudflare coding-agent runner](https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/), with adapters for [Pi](https://developers.cloudflare.com/sandbox/coding-agents/pi/) and [OpenCode](https://developers.cloudflare.com/sandbox/coding-agents/opencode/). Provider configuration references: [Pi models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) and [OpenCode providers](https://opencode.ai/docs/providers/).

## Sharing a demo

Set independent `WEB_ACCESS_CODE` and optional `DEMO_ACCESS_CODE` Worker secrets with at least 24 random characters. Never reuse the runner token, model key, or the same code for both roles. Local values go in ignored `.dev.vars`; deployed values must be uploaded separately with `wrangler secret put`. Do not use `VITE_` variables for credentials.

Browser login exchanges the access code for an expiring signed HttpOnly cookie containing only role, a random visitor ID, and expiry. It contains none of the access codes or internal/provider credentials. Owner sessions last eight hours; demo sessions last one hour. Rotating/removing an access code revokes its browser sessions. Deploying this change invalidates the old raw-token cookies and requires signing in again.

Demo visitors enter a public GitHub URL. New sessions can publish draft PRs if the owner’s GitHub App is authorized on that public repository; no visitor GitHub login is needed. The app bot creates the PR after the visitor explicitly clicks **Create PR**. Other public repositories support tasks and patch downloads, but cannot publish through this app. Older sessions without a publication grant must be started again. A repository becoming private or losing app authorization blocks new publication. Each browser login has its own server namespace, even if it requests the same task ID as another visitor or the owner. Demo access cannot connect GitHub or select private repositories; it can consume the shared model/Cloudflare budget within the existing execution limits. It is not a separate billing account or an unlimited public service. Expired/signed-out demo sessions cannot recover the old visitor namespace by guessing a task ID.

`AGENTS.md` is kept locally and ignored. Removing it from the current tree does not remove copies in earlier commits; review history before changing repository visibility.
