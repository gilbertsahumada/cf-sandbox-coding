# Improving the runner with its own agents

The runner can clone [this repository](https://github.com/gilbertsahumada/cf-sandbox-coding) as input to a cloud coding session. Treat every execution as a bounded proposal, with human review before publication, merge, or deployment.

## Workflow

1. Authorize this repository in the runner's GitHub App installation.
2. Open **New chat**, choose this repository and Pi/OpenCode, and send one concrete task with expected behavior and relevant checks.
3. Continue in the same conversation to preserve native agent context and workspace changes. Inspect **Tools** and **Changes**; an agent's claim of success is not independent verification.
4. Run `npm run check`, `npm test`, and the relevant build/format checks when dependencies are available. Report unavailable tools or blocked checks honestly; the sandbox cannot fetch packages from registries.
5. Review the cumulative diff. Use **Create PR** to publish a draft explicitly from the Worker, or download the patch for local review/publication if export restrictions apply.
6. Merge and deploy only after review and the required checks. A later session clones the updated repository; existing sessions keep their own baseline.

No scheduled or continuous self-improvement loop is enabled. Do not introduce one without a concrete task, execution budget, stopping condition, and explicit authorization. Concurrent sessions are started explicitly by the operator; Overview status monitoring does not schedule or restart agents.

## Suggested task shape

> Reproduce [specific problem] and fix its demonstrated cause. Keep existing security and recovery behavior. Add a focused regression test if appropriate. Run the required checks, explain which integrations still need live verification, and return the diff. Do not commit, push, merge, or deploy from the sandbox.

Read [AGENTS.md](../AGENTS.md), [README.md](../README.md), and [ARCHITECTURE.md](ARCHITECTURE.md) before changing the runner. Keep English comments and messages; explain non-obvious decisions without narrating each line. Prefer focused contracts and module ownership over scattered state strings or a general-purpose constants file.

## Manual edits during a session

Open **Changes** to browse repository files and edit existing text files. Save after the agent has finished or stopped, then send the next instruction in the same chat. Saves update the cumulative patch and checkpoint and tell the next agent turn which files changed manually.

On a save conflict, keep the draft until you deliberately choose to reload. Browser-only drafts are lost on full reload. If checkpoint creation fails, the save exists in the current running environment but is not guaranteed to survive container loss. Old sessions with archived patches but no current checkpoint cannot restore their files or native conversation.

## Boundaries to preserve

- Model and GitHub secrets stay in the Worker; agents receive no real credentials.
- App-backed cloning/agent access remains read-only for the selected repository. Explicit PR publication uses a separate restricted write token only in the Worker.
- Do not expand network access, dependency installation, permissions, or execution budgets as incidental cleanup.
- Do not read or include `.dev.vars`, `.env`, private keys, or secret values in prompts, logs, patches, or commits.
- Describe local, simulated, container, and live verification separately. See [OPERATIONS.md](OPERATIONS.md) for commands and limits.

Potential future work includes preparing additional build/test dependencies in the image and configurable archive cleanup. These are separate changes, not prerequisites for routine tasks.
