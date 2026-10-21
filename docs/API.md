# HTTP API

All routes below require `Authorization: Bearer <RUNNER_API_TOKEN>` or the runner's authenticated session cookie. The page, static assets, and GitHub flow callbacks have separate handling. Model configuration must exist before sandbox operations.

Browser sign-in sends `POST /session` with the Bearer token and an `Origin` matching the Worker. It sets an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Cookie-authenticated mutations require that same origin. Bearer clients can call task endpoints directly; browser credentials are never stored in localStorage.

## Session and GitHub

| Method | Route                         | Behavior                                                                           |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| POST   | `/session`                    | Establish the browser session; requires Bearer plus same origin.                   |
| GET    | `/session`                    | Return authentication status and configured model ID.                              |
| DELETE | `/session`                    | Clear the browser cookie; does not cancel work.                                    |
| GET    | `/health`                     | Return Worker health and supported agent names.                                    |
| GET    | `/github/status`              | Connection and management metadata without credentials.                            |
| POST   | `/github/connect`             | Start App registration or installation; sets a browser-bound flow cookie.          |
| GET    | `/github/repositories?page=1` | Retrieve a page of authorized repositories. Search in the UI filters loaded pages. |
| GET    | `/github/selected-repository` | Retrieve the remembered repository after validating current access.                |
| PUT    | `/github/selected-repository` | Remember `{ "installationId": 123, "repositoryId": 456 }` after authorization.     |
| DELETE | `/github/connection`          | Disconnect installations and request revocation.                                   |

GitHub redirects use `/github/manifest/callback` and `/github/install/callback`. These validate a temporary state bound to the flow cookie rather than the runner's `SameSite=Strict` session cookie. Do not treat callback URLs as general unauthenticated APIs or log their codes/state.

## Task resources

Every route in this table is prefixed with `/sandboxes/:id`. Choose a unique ID for a new conversation: lowercase letters, digits, and hyphens, starting with a letter or digit, up to 63 characters. A sandbox owns one conversation, not a sequence of unrelated tasks.

| Method | Resource                   | Request or result                                                                                                                                                                                |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/repository`              | Clone `{ "url": "https://github.com/owner/repo", "ref": "main" }`, or use `{ "installationId": 123, "repositoryId": 456, "ref": "main" }` for an authorized GitHub selection. `ref` is optional. |
| POST   | `/task`                    | Start `{ "agent": "pi", "prompt": "..." }`; agent also accepts `opencode`. A successful start returns 202.                                                                                       |
| GET    | `/task`                    | Return execution state: `none`, `running`, `stopping`, `cancelled`, `lost`, `succeeded`, or `failed`.                                                                                            |
| DELETE | `/task`                    | Stop the process group, preserve logs/diff/checkpoint when possible, and stop the container. Existing archives remain.                                                                           |
| GET    | `/messages`                | Return saved turns, current turn, continuation eligibility/reason, and checkpoint status.                                                                                                        |
| POST   | `/messages`                | Continue with `{ "id": "UUID", "prompt": "..." }`. Reuse the same UUID when retrying the same message.                                                                                           |
| GET    | `/logs`                    | Return the available stdout/stderr tails, up to 32,000 bytes per channel.                                                                                                                        |
| GET    | `/events`                  | Stream stdout, stderr, and status using Server-Sent Events.                                                                                                                                      |
| GET    | `/diff`                    | Return a plain-text cumulative Git patch against the initial commit, including new and binary files.                                                                                             |
| GET    | `/pull-request`            | Return proposal availability, a blocking reason, or the existing draft PR link.                                                                                                                  |
| POST   | `/pull-request`            | Publish `{ "title": "...", "description": "..." }` as a draft PR.                                                                                                                                |
| GET    | `/files?path=...&cursor=0` | List a repository directory, up to 200 entries per page. Empty path means the root.                                                                                                              |
| GET    | `/file?path=...`           | Read a regular UTF-8 text file and its content revision.                                                                                                                                         |
| PUT    | `/file`                    | Save `{ "path": "...", "content": "...", "version": "..." }` using the revision returned by the read.                                                                                            |

Prompts are nonempty and limited to 32,000 characters. A PR title is one line, up to 200 characters; its description is at most 20,000 characters. File saves require a current SHA-256 revision and are limited to 256 KiB of UTF-8 content. An active agent blocks concurrent message sends and manual saves. Ordinary validation errors return 400; rejected state transitions or save conflicts generally return 409. Oversized bodies return 413. Do not assume every error body is JSON; some routes return plain text.

## Streaming and retries

`GET /events` accepts `Last-Event-ID` or `?cursor=stdoutBytes:stderrBytes`. The optional `turn` query parameter scopes the observation to a conversation turn. Cursors count bytes, not JavaScript string characters. Reset offsets when the turn changes and do not merge old-turn events into new output.

Reconnect the observer after a transport interruption; do not start another task to reconnect logs. Disconnecting SSE leaves the agent running. After container shutdown, the stream can replay only the archived tails. A leading event clipped by the archive boundary is skipped as incomplete archived output, not reported as a failed task.

Publication retries reconcile the saved commit, branch, and PR. A branch containing different content is rejected rather than overwritten. Follow-up message IDs are a separate idempotency mechanism: preserve the original UUID until the client knows whether the send was accepted.
