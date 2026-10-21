# Architecture and maintenance map

The browser owns presentation and temporary drafts. The Worker authenticates requests and validates external input. A named `AgentSandbox` Durable Object owns each cloud conversation and its container. A separate `GitHubConnection` Durable Object owns the operator's GitHub App registration and installations.

```text
React UI / CLI
    │ authenticated HTTP and SSE
Worker routes ───────────── GitHubConnection ── GitHub API
    │                              │
AgentSandbox                  server-only tokens
    │ container lifecycle          │
Linux: repository + agent ── Outbound policy ── model / GitHub read proxy
```

## Module boundaries

| Location                                                       | Responsibility                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                 | HTTP entry point, authentication gate, request validation, task resource routing, and static asset security headers.                                                                                                                                                            |
| `src/sandbox.ts`                                               | Per-task lifecycle: clone, start/continue/stop, event streams, archives, checkpoints, file access, and PR orchestration.                                                                                                                                                        |
| `src/agents.ts`                                                | Supported agent names, provider configuration, commands/environment, and final outcome parsing.                                                                                                                                                                                 |
| `src/conversation.ts`, `src/task-status.ts`                    | Conversation validation, saved turn/checkpoint shapes, execution state contracts, and continuation eligibility.                                                                                                                                                                 |
| `src/runtime-config.ts`                                        | Worker policy limits, lifecycle timing, and workspace paths; separately shipped container scripts enforce their own bounds.                                                                                                                                                     |
| `src/github-routes.ts`                                         | Browser connection flow and catalog/preference HTTP routes.                                                                                                                                                                                                                     |
| `src/github.ts`                                                | GitHub App registration, installation credentials, repository authorization, and remembered selection.                                                                                                                                                                          |
| `src/github-api.ts`, `src/repository-selection.ts`             | GitHub request policy, repository grants, and catalog selection helpers.                                                                                                                                                                                                        |
| `src/outbound.ts`, `src/network.ts`                            | Container egress checks and server-side credential injection.                                                                                                                                                                                                                   |
| `src/pull-request.ts`                                          | Exported change validation and idempotent GitHub draft publication.                                                                                                                                                                                                             |
| `src/workspace-files.ts`, `src/event-stream.ts`, `src/auth.ts` | File result contracts, SSE framing/cursors, and authentication helpers.                                                                                                                                                                                                         |
| `container/`                                                   | Processes and filesystem operations executed inside Linux: agent adapters, stop/follow helpers, change export, checkpoints, and safe file access.                                                                                                                               |
| `web/App.tsx`                                                  | Session-first shell, navigation, and composition of conversation, tools, and contextual code views.                                                                                                                                                                             |
| `web/hooks/use-runner.ts`                                      | Authenticated browser requests, task/catalog state, conversation updates, and SSE lifecycle.                                                                                                                                                                                    |
| `web/hooks/use-workspace.ts`                                   | Explorer state, in-memory document drafts, saves, and conflict handling.                                                                                                                                                                                                        |
| `web/lib/`                                                     | Typed API/UI contracts, presentation configuration, and focused history, activity, diff, Markdown, and startup helpers. `api-types.ts` describes successful same-origin payloads without claiming runtime validation; `config.ts` separates UI defaults from execution budgets. |
| `web/components/`                                              | Product components; `ui/` contains shadcn/Radix primitives.                                                                                                                                                                                                                     |
| `web/styles.css`                                               | Theme tokens, compact layout, component styling, and responsive rules.                                                                                                                                                                                                          |
| `scripts/`                                                     | Configuration/CLI clients, simulated preview, local container smoke checks, and explicit live verification.                                                                                                                                                                     |
| `test/`                                                        | Node test suite for contracts, policy, parsers, filesystem behavior, and lifecycle decisions.                                                                                                                                                                                   |

`wrangler.jsonc` binds Worker assets, the Sandbox class, and GitHub storage. `Dockerfile` pins the native agent installations and copies the container helpers. `worker-configuration.d.ts` is generated with `npm run types`; update configuration rather than hand-maintaining generated bindings.

## Conversation lifecycle

1. The first browser message allocates a unique task ID and shows local preparation feedback. The repository endpoint clones into `/workspace/repo` and records the initial commit.
2. Starting a task records the first turn and launches the chosen agent. Pi uses native JSON session events; OpenCode runs through a local HTTP server adapter. Each turn has a 30-minute execution limit.
3. SSE forwards stdout, stderr, and task state. Closing an observer only ends the stream; it does not terminate the process.
4. Completion or cancellation collects the response, output tails, cumulative diff, publishable files, and a recovery checkpoint when possible. The diff remains relative to the initial commit, including agent-created commits.
5. A follow-up message reuses the native agent session. If the container expired, the runner first restores the matching checkpoint. Missing or invalid recovery data produces an explanation instead of silently creating a fresh conversation.
6. Manual saves happen only while the agent is idle. They refresh the cumulative diff, invalidate stale publication state, update recovery data, and notify the next agent turn of manually edited paths.
7. Explicit PR creation sends exported files to GitHub from the Worker. Subsequent changed turns can publish a new draft without overwriting the previous PR.

Local preparation (`cloning`) and the backend's execution states have different responsibilities. Keep UI labels separate from transport state values. A completed response means the agent is awaiting another instruction; it does not prove the requested checks passed.

## State and ownership rules

- Durable Object storage owns archived results, turns, checkpoints, and publication metadata. Browser memory owns unsent messages and unsaved document contents.
- Recent-task storage contains only the browser-known history. Private entries redact repository metadata and are removed on sign-out. Do not add source, prompts, logs, diffs, or secrets to localStorage.
- Asynchronous browser results must belong to the current authentication/task generation before changing visible state. Preserve cancellation and stale-response guards when extracting hooks.
- Message UUIDs make follow-up retries idempotent. A lost HTTP response is not permission to allocate another message ID or start another native session.
- File versions detect conflicting saves. Keep the user's draft on conflict; reloading must be an explicit choice.
- Tool activity stays mounted when hidden so navigation does not lose its streamed output. Avoid creating duplicate stream owners during layout changes.

## Where to change things

For a new agent, start with the validated agent contract, provider/command adapter, native container helper, and outcome tests; then add UI labels and the image installation. For an endpoint, validate its boundary and document its request/response behavior in [API.md](API.md). For a UI-only change, prefer existing product components and shadcn primitives without changing execution semantics.

Use literal unions or inferred schema types for finite states and external inputs. Share a constant only when several consumers represent the same policy; keep local presentation values near their component. Do not turn unrelated strings or numbers into a global constants bag. Document the reason behind retry, storage, and security behavior where it is enforced.

See [OPERATIONS.md](OPERATIONS.md) for runtime limits and verification levels before reporting a change as tested.
