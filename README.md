# Cloudflare coding sessions

Run **Pi or OpenCode in Cloudflare Sandbox**, with an OpenAI-compatible model provider of your choice. The browser manages conversations, repository files, live tool activity, cumulative changes, and draft pull requests. AI Gateway is not required.

This is a **single-operator runner**, not a multi-user service. Everyone with the runner access token shares access to its tasks and connected repositories. The interface currently allows one active task at a time per browser; it does not schedule concurrent agents.

## Start a conversation

1. Open your deployed Worker and sign in with `RUNNER_API_TOKEN` (not the model API key).
2. Choose **New chat**, then select Pi or OpenCode and a repository in the message composer. Connect GitHub to browse authorized public and private repositories, or use the public example.
3. Send your first message to create the cloud session. Preparation and cloning appear in the conversation immediately.
4. Continue in the same chat after each reply. **Tools** shows live activity; **Changes** opens the cumulative diff, repository explorer, and editor.
5. Review the changes and use **Create PR** to publish a draft, or download the patch. Publication is explicit; agents do not merge or deploy changes.

Changing selectors or opening a new chat does not start an agent. Repository search filters the loaded catalog; **Load more** retrieves additional entries. The selected repository is remembered on the server after access validation.

A `/?task=ID` link reopens a known task after authentication; `/?new=1` opens an empty chat. Recent sessions are the last 12 tasks known to the current browser, not an account-wide server list. Closing a tab or signing out does **not** stop running work: use **Stop**.

## Local setup

Use Node.js 24 and install the locked dependencies:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Set `MODEL_API_KEY` and a long random `RUNNER_API_TOKEN` in the local `.dev.vars` file. Keep both secret; the file is excluded from Git and the Docker build context. Never use real secrets in the simulated preview.

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

The fixture preview uses `fixture-runner-token` if you test signing out and back in. Run it with `--slow`, `--slow-start`, or `--fail-start` to inspect loading and error states. Wrangler serves the built UI, so rebuild after editing it unless using the Vite development server.

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

Comments, interface text, accessibility labels, and application messages are in English. Keep comments focused on invariants and non-obvious decisions; use descriptive names and TypeScript types for the ordinary flow. See [AGENTS.md](AGENTS.md) for repository instructions.

## Upstream references

The container coordination follows the [Cloudflare coding-agent runner](https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/), with adapters for [Pi](https://developers.cloudflare.com/sandbox/coding-agents/pi/) and [OpenCode](https://developers.cloudflare.com/sandbox/coding-agents/opencode/). Provider configuration references: [Pi models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) and [OpenCode providers](https://opencode.ai/docs/providers/).
