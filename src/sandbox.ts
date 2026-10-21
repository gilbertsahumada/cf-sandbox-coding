import { runnerLimits, sandboxTiming, workspacePaths } from "./runtime-config";
import {
  isActiveTask,
  type TaskStatus,
  type ExecutionStatus,
} from "./task-status";
export type { TaskStatus } from "./task-status";
import type {
  RepositoryFileOperation,
  RepositoryFilesResult,
} from "./workspace-files";
import workspaceFilesSource from "../dist/container/workspace-files.mjs.txt";
import { createHash } from "node:crypto";
import {
  continuationReason,
  type Turn,
  type StoredTurn,
  type Checkpoint,
} from "./conversation";
import {
  validateChanges,
  type Proposal,
  type PullRequest,
} from "./pull-request";
import { eventFrame } from "./event-stream";
import { Files, SandboxFileError } from "@cloudflare/sandbox";
import type { RepositoryGrant } from "./github-api";
import { DurableObject } from "cloudflare:workers";
import {
  agentCommand,
  agentEnv,
  providerConfigs,
  parseOutcome,
  type AgentName,
} from "./agents";

const taskKey = "task";

const caPath = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
// The CA alone replaces the system trust store. This works because
// Outbound intercepts every HTTPS request from the container.
const trustEnv = {
  NODE_EXTRA_CA_CERTS: caPath,
  GIT_SSL_CAINFO: caPath,
  CURL_CA_BUNDLE: caPath,
  SSL_CERT_FILE: caPath,
};

// Runs the command in its own process group. Records its process ID when
// it starts and its exit code when it ends.
const taskScript = `dir=$1; shift
setsid sh -c 'echo "$$ $(cat /proc/sys/kernel/random/boot_id)" >"$0/pid"; exec "$@"' \\
	"$dir" "$@" >"$dir/stdout.log" 2>"$dir/stderr.log"
echo "$?" >"$dir/exit-code.tmp" && mv "$dir/exit-code.tmp" "$dir/exit-code"`;

// Succeeds while the process in the file runs and started in this instance.
const taskRunningScript = `read -r pid boot <"$1" &&
	[ "$boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] &&
	kill -0 "$pid"`;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class AgentSandbox extends DurableObject<Env> {
  private changing = false;
  private finalizing: Promise<void> | undefined;
  private get turn() {
    return this.ctx.storage.kv.get<number>("turn") || 0;
  }
  private get taskDirectory() {
    return this.turn
      ? `${workspacePaths.task}/turn-${this.turn}`
      : workspacePaths.task;
  }
  private get eventsPath() {
    return `${this.taskDirectory}/stdout.log`;
  }
  private get stderrPath() {
    return `${this.taskDirectory}/stderr.log`;
  }
  private get exitCodePath() {
    return `${this.taskDirectory}/exit-code`;
  }
  private get pidPath() {
    return `${this.taskDirectory}/pid`;
  }
  private publishing: Promise<PullRequest> | undefined;
  private readonly container: Container;
  private readonly files: Files;
  private setup: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const container = ctx.container;

    if (!container) {
      throw new Error("The container binding is not configured");
    }

    this.container = container;
    this.files = new Files(container);

    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(sandboxTiming.inactivityMs),
      );
    }
  }

  async cloneRepository(
    repository: string,
    ref: string | undefined,
    grant?: RepositoryGrant,
  ): Promise<CommandResult> {
    if (this.ctx.storage.kv.get("repositoryReady"))
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Use a new sandbox for each task",
      };
    if (grant) this.ctx.storage.kv.put("githubGrant", grant);
    await this.startSandbox();
    const branch = ref === undefined ? [] : ["--branch", ref];

    const result = await this.run(
      [
        "git",
        "clone",
        "--depth",
        "1",
        ...branch,
        "--",
        repository,
        workspacePaths.repository,
      ],
      workspacePaths.root,
      trustEnv,
    );
    if (result.exitCode === 0) {
      const revision = await this.run(
        ["git", "rev-parse", "HEAD"],
        workspacePaths.repository,
        {},
      );
      if (revision.exitCode !== 0) return revision;
      this.ctx.storage.kv.put("baseCommit", revision.stdout.trim());
      const branchName = await this.run(
        ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
        workspacePaths.repository,
        {},
      );
      if (branchName.exitCode === 0)
        this.ctx.storage.kv.put("baseBranch", branchName.stdout.trim());
      this.ctx.storage.kv.put("repositoryReady", true);
    }
    return result;
  }

  async startTask(
    prompt: string,
    agent: AgentName,
  ): Promise<"started" | "busy"> {
    if (this.changing || this.ctx.storage.kv.get(taskKey) !== undefined)
      return "busy";
    this.changing = true;
    try {
      if (!this.ctx.storage.kv.get("repositoryReady"))
        throw Error("Clone a repository first");
      if (!this.container.running)
        throw Error("Workspace expired; use a new sandbox");
      this.ctx.storage.kv.put("conversationVersion", 1);
      await this.launchTurn(prompt, agent, crypto.randomUUID());
      return "started";
    } finally {
      this.changing = false;
    }
  }

  async sendMessage(id: string, prompt: string): Promise<{ turn: number }> {
    const existing = this.ctx.storage.kv.get<number>(`request:${id}`);
    if (existing) {
      if (this.getTurn(existing)?.prompt !== prompt)
        throw Error("That identifier already belongs to another message.");
      return { turn: existing };
    }
    if (this.changing || this.publishing)
      throw Error("Wait for the current operation to finish.");
    this.changing = true;
    try {
      const status = await this.readTask();
      const checkpoint = this.currentCheckpoint();
      const reason = continuationReason(
        this.ctx.storage.kv.get("conversationVersion"),
        status.state,
        this.container.running,
        this.turn,
        checkpoint?.turn,
      );
      if (reason) throw Error(reason);
      if (this.turn >= runnerLimits.conversationTurns)
        throw Error(
          "This conversation reached 100 turns. Save the patch and start a new task.",
        );
      if (
        !this.container.running ||
        this.ctx.storage.kv.get("workspaceRestorePending")
      ) {
        if (this.container.running) await this.container.destroy();
        await this.restoreWorkspace(checkpoint!);
      }
      await this.launchTurn(
        prompt,
        this.ctx.storage.kv.get<AgentName>(taskKey)!,
        id,
      );
      return { turn: this.turn };
    } finally {
      this.changing = false;
    }
  }

  async repositoryFiles(
    operation: RepositoryFileOperation,
    path: string,
    cursor = 0,
    content?: string,
    version?: string,
  ): Promise<RepositoryFilesResult> {
    if (this.changing || this.publishing)
      throw Error("Wait for the current operation to finish.");
    this.changing = true;
    const input = `${workspacePaths.root}/.editor-request-${crypto.randomUUID()}.json`;
    try {
      const status = await this.readTask();
      if (operation === "write" && isActiveTask(status.state))
        throw Error(
          "Stop the agent or wait for it to finish before saving files.",
        );
      if (
        operation === "write" &&
        !this.ctx.storage.kv.get("conversationVersion")
      )
        throw Error(
          "This older session cannot save a recoverable workspace. Start a new session.",
        );
      if (!this.ctx.storage.kv.get("repositoryReady"))
        throw Error("Choose a session with a cloned repository.");
      if (
        !this.container.running ||
        this.ctx.storage.kv.get("workspaceRestorePending")
      ) {
        const checkpoint = this.currentCheckpoint();
        if (!checkpoint || checkpoint.turn !== this.turn)
          throw Error(
            "This session has no recoverable workspace. Its archived patch is still available.",
          );
        if (this.container.running) await this.container.destroy();
        await this.restoreWorkspace(checkpoint);
      }
      // Install the helper for existing containers too; no agent restart is required.
      await this.files.writeFile(
        "/opt/workspace-files.mjs",
        workspaceFilesSource,
      );
      await this.files.writeFile(
        input,
        JSON.stringify({ operation, path, cursor, content, version }),
      );
      const result = await this.run(
        ["node", "/opt/workspace-files.mjs", input],
        "/",
        {},
      );
      if (result.exitCode) throw Error("Could not access repository files.");
      // The helper ships with this Worker; repository data remains untrusted text.
      const value = JSON.parse(result.stdout) as RepositoryFilesResult;
      if (value.error) return value;
      if (operation === "write" && value.changed) {
        this.ctx.storage.kv.put(
          "workspaceRevision",
          (this.ctx.storage.kv.get<number>("workspaceRevision") || 0) + 1,
        );
        const edited = this.ctx.storage.kv.get<string[]>("editorPaths") || [];
        this.ctx.storage.kv.put(
          "editorPaths",
          [...new Set([...edited, path])].slice(
            -runnerLimits.rememberedEditorPaths,
          ),
        );
        for (const key of [
          "diffChunks",
          "proposalChunks",
          "proposalError",
          "pullRequest",
          "checkpointError",
        ])
          this.ctx.storage.kv.delete(key);
        try {
          const diff = await this.readDiff();
          if (!diff.exitCode) this.saveDiff(diff);
        } catch {
          /* A later diff request can retry. */
        }
        await this.archiveProposal();
      }
      if (operation === "write") {
        if (this.currentCheckpoint()?.turn !== this.turn)
          await this.saveWorkspaceCheckpoint();
        value.checkpointSaved = this.currentCheckpoint()?.turn === this.turn;
        if (!value.checkpointSaved)
          value.warning =
            "Saved in the running workspace, but recovery could not be updated. Keep this session open and download the patch before leaving.";
      }
      await this.container.setInactivityTimeout(
        this.currentCheckpoint()?.turn === this.turn
          ? sandboxTiming.archivedInactivityMs
          : sandboxTiming.inactivityMs,
      );
      return value;
    } finally {
      try {
        if (this.container.running)
          await this.files.remove(input, { force: true });
      } catch {
        /* Temporary inputs are not part of checkpoints. */
      }
      this.changing = false;
    }
  }

  private async launchTurn(prompt: string, agent: AgentName, id: string) {
    await this.startSandbox();
    const number = this.turn + 1;
    this.ctx.storage.kv.put("turn", number);
    this.ctx.storage.kv.put(taskKey, agent);
    this.ctx.storage.kv.put(`request:${id}`, number);
    this.putTurn({
      number,
      id,
      prompt,
      startedAt: Date.now(),
      state: "running",
    });
    // Every turn gets fresh output and publication caches; the repository and native session stay intact.
    for (const key of [
      "result",
      "logs",
      "diffChunks",
      "proposalChunks",
      "proposalError",
      "pullRequest",
      "stopRequested",
      "checkpointError",
    ])
      this.ctx.storage.kv.delete(key);
    this.ctx.storage.kv.put("startedAt", Date.now());
    try {
      await this.files.mkdir(this.taskDirectory, { recursive: true });
      await this.files.mkdir(workspacePaths.conversation, { recursive: true });
      await this.files.mkdir(workspacePaths.piConfig, { recursive: true });
      await this.files.writeFile(
        `${workspacePaths.piConfig}/models.json`,
        JSON.stringify(providerConfigs(this.env).pi),
      );
      await this.container.exec(
        [
          "/bin/sh",
          "-c",
          taskScript,
          "agent",
          this.taskDirectory,
          ...agentCommand(
            agent,
            this.ctx.storage.kv.get<string[]>("editorPaths")?.length
              ? `${prompt}\n\nFiles edited through the workspace since your previous turn (paths only): ${JSON.stringify(this.ctx.storage.kv.get("editorPaths"))}. Re-read relevant files before changing them.`
              : prompt,
            this.env,
          ),
        ],
        {
          cwd: workspacePaths.repository,
          env: {
            ...trustEnv,
            ...agentEnv(agent, this.env),
            PWD: workspacePaths.repository,
          },
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      this.ctx.storage.kv.delete("editorPaths");
      await this.ctx.storage.setAlarm(Date.now() + sandboxTiming.taskCheckMs);
    } catch (error) {
      this.ctx.storage.kv.put("result", {
        state: "failed",
        error: "Could not start the turn. Try sending another message.",
      } satisfies TaskStatus);
      throw error;
    }
  }

  private putTurn(turn: Turn) {
    const { prompt, response, ...metadata } = turn;
    const write = (name: string, text: string) =>
      this.writeTextChunks(`turn:${turn.number}:${name}`, text);
    this.ctx.storage.kv.put(`turn:${turn.number}`, {
      ...metadata,
      promptChunks: write("prompt", prompt),
      responseChunks:
        response === undefined ? undefined : write("response", response),
    } satisfies StoredTurn);
  }

  private getTurn(number: number): Turn | undefined {
    const metadata = this.ctx.storage.kv.get<StoredTurn>(`turn:${number}`);
    if (!metadata) return;
    const read = (name: string, count: number) =>
      this.readTextChunks(`turn:${number}:${name}`, count);
    const { promptChunks, responseChunks, ...turn } = metadata;
    return {
      ...turn,
      prompt: read("prompt", promptChunks),
      response:
        responseChunks === undefined
          ? undefined
          : read("response", responseChunks),
    };
  }

  async conversation() {
    const status = await this.readTask();
    const checkpoint = this.currentCheckpoint();
    const reason = continuationReason(
      this.ctx.storage.kv.get("conversationVersion"),
      status.state,
      this.container.running,
      this.turn,
      checkpoint?.turn,
    );
    const turns: Turn[] = [];
    for (let i = 1; i <= this.turn; i++) {
      const turn = this.getTurn(i);
      if (turn) turns.push(turn);
    }
    return {
      turns,
      turn: this.turn,
      state: status.state,
      canContinue: !reason && this.turn < runnerLimits.conversationTurns,
      reason:
        reason ||
        (this.turn >= runnerLimits.conversationTurns
          ? "This conversation reached the 100-turn limit."
          : undefined),
      checkpointSaved: checkpoint?.turn === this.turn,
      warning: this.ctx.storage.kv.get<string>("checkpointError"),
    };
  }

  async alarm(): Promise<void> {
    if (this.changing || this.publishing) {
      await this.ctx.storage.setAlarm(Date.now() + sandboxTiming.taskCheckMs);
      return;
    }
    if (!this.container.running) return;
    const status = await this.readTask();
    if (status.state === "running") {
      if (
        Date.now() -
          (this.ctx.storage.kv.get<number>("startedAt") || Date.now()) >
        sandboxTiming.turnTimeoutMs
      ) {
        await this.run(
          ["node", "/opt/stop-task.mjs", this.taskDirectory],
          "/",
          {},
        );
        await this.finishTurn({
          state: "failed",
          error: "This turn exceeded 30 minutes.",
        });
        await this.container.destroy();
      } else
        await this.ctx.storage.setAlarm(Date.now() + sandboxTiming.taskCheckMs);
    }
  }

  async stopTask(): Promise<{
    state: TaskStatus["state"];
    containerRunning: boolean;
  }> {
    if (this.changing || this.publishing)
      throw Error("Wait for the current operation to finish.");
    this.changing = true;
    try {
      const original = await this.readTask();
      const active = isActiveTask(original.state);
      if (active) this.ctx.storage.kv.put("stopRequested", true);
      await this.ctx.storage.deleteAlarm();
      if (this.container.running) {
        if (active) {
          const stopped = await this.run(
            ["node", "/opt/stop-task.mjs", this.taskDirectory],
            "/",
            {},
          );
          if (stopped.exitCode !== 0)
            throw Error("Could not stop the process safely.");
        }
        await this.finishTurn(
          active
            ? { state: "cancelled", error: "Task stopped by user" }
            : original,
        );
        await this.container.destroy();
      }
      this.ctx.storage.kv.delete("stopRequested");
      return {
        state: (await this.readTask()).state,
        containerRunning: this.container.running,
      };
    } catch (error) {
      this.ctx.storage.kv.delete("stopRequested");
      if (this.container.running)
        await this.ctx.storage.setAlarm(Date.now() + sandboxTiming.taskCheckMs);
      throw error;
    } finally {
      this.changing = false;
    }
  }

  private async finishTurn(status: TaskStatus) {
    if (["none", "running", "stopping"].includes(status.state)) return;
    if (this.finalizing) return this.finalizing;
    if (
      this.ctx.storage.kv.get<number>("finishedTurn") === this.turn &&
      this.ctx.storage.kv.get("result")
    )
      return;
    this.finalizing = (async () => {
      this.ctx.storage.kv.put("result", status);
      const turn = this.getTurn(this.turn);
      if (turn)
        this.putTurn({
          ...turn,
          state: status.state,
          finishedAt: Date.now(),
          response:
            "result" in status
              ? status.result
              : "error" in status
                ? status.error
                : "The workspace was lost.",
        });
      if (this.container.running) {
        try {
          this.ctx.storage.kv.put("logs", await this.readLogs());
        } catch {
          console.warn("Could not archive logs");
        }
        try {
          const diff = await this.readDiff();
          if (!diff.exitCode) this.saveDiff(diff);
        } catch {
          console.warn("Could not archive diff");
        }
        await this.archiveProposal();
        await this.saveWorkspaceCheckpoint();
        const safe =
          !this.ctx.storage.kv.get("conversationVersion") ||
          this.currentCheckpoint()?.turn === this.turn;
        await this.container.setInactivityTimeout(
          safe
            ? sandboxTiming.archivedInactivityMs
            : sandboxTiming.inactivityMs,
        );
      }
      this.ctx.storage.kv.put("finishedTurn", this.turn);
    })();
    try {
      await this.finalizing;
    } finally {
      this.finalizing = undefined;
    }
  }

  private async saveWorkspaceCheckpoint() {
    if (!this.ctx.storage.kv.get("conversationVersion")) return;
    try {
      const saved = await this.run(
        ["node", "/opt/workspace-checkpoint.mjs", "save"],
        "/",
        {},
      );
      if (saved.exitCode !== 0)
        throw Error(saved.stderr || "Could not save the workspace.");
      const old = this.ctx.storage.kv.get<Checkpoint>("checkpoint");
      const generation = crypto.randomUUID(),
        count = this.writeTextChunks(
          `checkpoint:${generation}`,
          saved.stdout,
          runnerLimits.checkpointChunkCharacters,
        );
      this.ctx.storage.kv.put("checkpoint", {
        generation,
        count,
        turn: this.turn,
        workspaceRevision:
          this.ctx.storage.kv.get<number>("workspaceRevision") || 0,
        digest: createHash("sha256").update(saved.stdout).digest("hex"),
      } satisfies Checkpoint);
      this.ctx.storage.kv.delete("checkpointError");
      if (old)
        for (let i = 0; i < old.count; i++)
          this.ctx.storage.kv.delete(`checkpoint:${old.generation}:${i}`);
    } catch (error) {
      this.ctx.storage.kv.put(
        "checkpointError",
        error instanceof Error
          ? error.message
          : "Could not save the workspace.",
      );
    }
  }

  private currentCheckpoint(): Checkpoint | undefined {
    const saved = this.ctx.storage.kv.get<Checkpoint>("checkpoint");
    return saved &&
      (saved.workspaceRevision || 0) ===
        (this.ctx.storage.kv.get<number>("workspaceRevision") || 0)
      ? saved
      : undefined;
  }

  private async restoreWorkspace(checkpoint: Checkpoint) {
    const encoded = this.readTextChunks(
      `checkpoint:${checkpoint.generation}`,
      checkpoint.count,
    );
    if (
      createHash("sha256").update(encoded).digest("hex") !== checkpoint.digest
    )
      throw Error(
        "The recovery checkpoint is incomplete. The conversation was not restarted.",
      );
    this.ctx.storage.kv.put("workspaceRestorePending", true);
    try {
      await this.startSandbox();
      await this.files.writeFile(workspacePaths.checkpointInput, encoded);
      const restored = await this.run(
        [
          "node",
          "/opt/workspace-checkpoint.mjs",
          "restore",
          workspacePaths.checkpointInput,
        ],
        "/",
        {},
      );
      if (restored.exitCode) throw Error("Restore failed");
      await this.files.remove(workspacePaths.checkpointInput, { force: true });
      this.ctx.storage.kv.delete("workspaceRestorePending");
    } catch {
      if (this.container.running) await this.container.destroy();
      throw Error(
        "Could not restore the workspace. The saved checkpoint is preserved; you can retry.",
      );
    }
  }

  private async archiveProposal(): Promise<void> {
    if (
      this.ctx.storage.kv.get("proposalChunks") !== undefined ||
      !this.container.running
    )
      return;
    if (!this.ctx.storage.kv.get("githubGrant")) return;
    try {
      const baseCommit = this.ctx.storage.kv.get<string>("baseCommit");
      if (!baseCommit) throw Error("The task has no saved initial commit.");
      const result = await this.run(
        [
          "node",
          "/opt/export-changes.mjs",
          workspacePaths.repository,
          baseCommit,
        ],
        "/",
        {},
      );
      const value = JSON.parse(result.stdout);
      if (result.exitCode || value.error)
        throw Error(value.error || "Could not preserve the files.");
      const encoded = JSON.stringify(validateChanges(value));
      const chunks = this.writeTextChunks("proposal", encoded);
      this.ctx.storage.kv.put("proposalChunks", chunks);
      this.ctx.storage.kv.delete("proposalError");
    } catch (error) {
      this.ctx.storage.kv.put(
        "proposalError",
        error instanceof Error
          ? error.message
          : "Could not preserve the proposal.",
      );
    }
  }

  async pullRequestStatus(): Promise<{
    pr?: PullRequest;
    available: boolean;
    reason?: string;
  }> {
    const pr = this.ctx.storage.kv.get<PullRequest>("pullRequest");
    if (pr) return { pr, available: true };
    const state = (await this.readTask()).state;
    if (["none", "running", "stopping"].includes(state))
      return { available: false, reason: "Wait for the task to finish." };
    if (!this.ctx.storage.kv.get("githubGrant"))
      return {
        available: false,
        reason: "Run the task with a repository from the GitHub selector.",
      };
    if (!this.ctx.storage.kv.get("baseBranch"))
      return {
        available: false,
        reason:
          "No source branch was saved. Start a new task from a branch to create a PR.",
      };
    await this.archiveProposal();
    const available = this.ctx.storage.kv.get("proposalChunks") !== undefined;
    return {
      available,
      reason: available
        ? undefined
        : this.ctx.storage.kv.get<string>("proposalError") ||
          "This older task only has a saved patch. Start a new task to create a PR.",
    };
  }

  async createPullRequest(
    taskId: string,
    title: string,
    description: string,
  ): Promise<PullRequest> {
    if (this.changing) throw Error("Wait for the current operation to finish.");
    if (this.publishing) return this.publishing;
    this.publishing = (async () => {
      const status = await this.pullRequestStatus();
      if (status.pr) return status.pr;
      if (!status.available) throw Error(status.reason);
      const count = this.ctx.storage.kv.get<number>("proposalChunks")!;
      const encoded = this.readTextChunks("proposal", count);
      const proposal: Proposal = {
        ...validateChanges(JSON.parse(encoded)),
        baseCommit: this.ctx.storage.kv.get<string>("baseCommit")!,
        baseBranch: this.ctx.storage.kv.get<string>("baseBranch")!,
      };
      const grant = this.ctx.storage.kv.get<RepositoryGrant>("githubGrant")!;
      const body = `${description}\n\n---\nCreated from sandbox task \`${taskId}\` (${this.ctx.storage.kv.get<string>(taskKey)}).\nStatus: ${(await this.readTask()).state}.\nTests: review the task activity; checks have not been independently verified.\nBase commit: \`${proposal.baseCommit}\`.\n\nThis draft requires review before merging.`;
      const revision =
        this.ctx.storage.kv.get<number>("workspaceRevision") || 0;
      const publicationId =
        (this.turn > 1 ? `${taskId}-turn-${this.turn}` : taskId) +
        (revision ? `-edit-${revision}` : "");
      const pr = await this.env.GITHUB.getByName("owner").createPullRequest(
        grant,
        publicationId,
        proposal,
        title,
        body,
      );
      this.ctx.storage.kv.put("pullRequest", pr);
      return pr;
    })();
    try {
      return await this.publishing;
    } finally {
      this.publishing = undefined;
    }
  }

  async streamEvents(cursor: string, expectedTurn?: number): Promise<Response> {
    const observedTurn = this.turn;
    const observedDirectory = this.taskDirectory;
    const status = await this.readTask();
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const writer = writable.getWriter();
    let observer: ExecProcess | undefined;
    let exited = false;
    let disconnected = false;
    const stopObserver = () => {
      disconnected = true;
      // Disconnecting the browser must never signal the independent agent process.
      if (observer && !exited) {
        try {
          observer.kill();
        } catch {}
      }
    };
    void writer.closed.catch(stopObserver);
    const heartbeat = setInterval(() => {
      void writer
        .write(new TextEncoder().encode(": keep-alive\n\n"))
        .catch(stopObserver);
    }, sandboxTiming.eventHeartbeatMs);
    const send = (type: string, data: unknown) =>
      writer.write(eventFrame(type, data));
    const pump = async () => {
      try {
        if (this.turn !== observedTurn) {
          await send("turn", { turn: this.turn });
          return;
        }
        await send("turn", { turn: observedTurn });
        if (expectedTurn !== undefined && expectedTurn !== observedTurn) return;
        await send("status", status);
        if (this.container.running && this.ctx.storage.kv.get(taskKey)) {
          observer = await this.container.exec(
            ["node", "/opt/follow-task.mjs", observedDirectory, cursor],
            { cwd: "/", stderr: "ignore" },
          );
          void observer.exitCode.then(
            () => {
              exited = true;
            },
            () => {
              exited = true;
            },
          );
          if (disconnected) {
            stopObserver();
            return;
          }
          if (!observer.stdout) throw Error("Missing observer output");
          let buffered = "";
          // Forward whole SSE frames so heartbeat comments cannot split a JSON payload.
          for await (const text of observer.stdout.pipeThrough(
            new TextDecoderStream(),
          )) {
            buffered += text;
            let boundary: number;
            while ((boundary = buffered.indexOf("\n\n")) >= 0) {
              await writer.write(
                new TextEncoder().encode(buffered.slice(0, boundary + 2)),
              );
              buffered = buffered.slice(boundary + 2);
            }
          }
          if (buffered) throw Error("Incomplete observer frame");
          if ((await observer.exitCode) !== 0)
            throw Error("Log observer stopped");
        } else {
          // Archived output is a bounded tail, so explicitly replace any partial replay.
          await send("reset", { archived: true });
          const logs = this.ctx.storage.kv.get<{
            stdout: string;
            stderr: string;
          }>("logs");
          if (logs?.stdout) await send("stdout", logs.stdout);
          if (logs?.stderr) await send("stderr", logs.stderr);
        }
        const final = await this.readTask();
        if (this.turn !== observedTurn) {
          await send("turn", { turn: this.turn });
          return;
        }
        await send("status", final);
        if (!isActiveTask(final.state)) await send("done", {});
      } catch (error) {
        if (!disconnected) {
          console.warn(
            "Log observer interrupted",
            error instanceof Error ? error.message : "unknown",
          );
          try {
            if (this.turn !== observedTurn) {
              await send("turn", { turn: this.turn });
              return;
            }
            const final = await this.readTask();
            await send("status", final);
            if (!isActiveTask(final.state)) await send("done", {});
            else await send("notice", { message: "Reconnecting activity…" });
          } catch {}
        }
      } finally {
        clearInterval(heartbeat);
        stopObserver();
        await writer.close().catch(() => {});
      }
    };
    void pump();
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  async executionStatus(): Promise<ExecutionStatus> {
    const status = await this.readTask();
    // Reading this flag does not start a stopped container or restore a checkpoint.
    return { ...status, containerRunning: this.container.running };
  }

  async readTask(): Promise<TaskStatus> {
    if (this.ctx.storage.kv.get("stopRequested")) return { state: "stopping" };
    const saved = this.ctx.storage.kv.get<TaskStatus>("result");
    const status: TaskStatus =
      saved ||
      (!this.container.running
        ? this.ctx.storage.kv.get(taskKey) === undefined
          ? { state: "none" }
          : { state: "lost" }
        : await this.taskStatus());
    await this.finishTurn(status);
    return status;
  }

  async readLogs(): Promise<{ stdout: string; stderr: string }> {
    const saved = this.ctx.storage.kv.get<{ stdout: string; stderr: string }>(
      "logs",
    );
    if (saved) return saved;
    if (!this.container.running)
      return { stdout: "", stderr: "Workspace is no longer running" };
    const stdout = await this.run(
      ["tail", "-c", String(runnerLimits.archivedLogBytes), this.eventsPath],
      "/",
      {},
    );
    const stderr = await this.run(
      ["tail", "-c", String(runnerLimits.archivedLogBytes), this.stderrPath],
      "/",
      {},
    );
    return { stdout: stdout.stdout, stderr: stderr.stdout };
  }

  async readDiff(): Promise<CommandResult> {
    const count = this.ctx.storage.kv.get<number>("diffChunks");
    if (count !== undefined) {
      const stdout = this.readTextChunks("diff", count);
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (!this.container.running)
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Workspace is no longer running and no diff was saved",
      };
    await this.startSandbox();

    return this.run(
      [
        "/bin/sh",
        "-c",
        'git -c core.hooksPath=/dev/null add --intent-to-add . && git --no-pager diff --binary --no-ext-diff --no-textconv "$1" -- .',
        "diff",
        this.ctx.storage.kv.get<string>("baseCommit") ?? "HEAD",
      ],
      workspacePaths.repository,
      {},
    );
  }

  private saveDiff(diff: CommandResult): void {
    const chunks = this.writeTextChunks("diff", diff.stdout);
    this.ctx.storage.kv.put("diffChunks", chunks);
  }

  // Text chunks allow worst-case UTF-8 expansion; larger checkpoint chunks contain only base64.
  // Existing prefixes and separate count records preserve compatibility with archived tasks.
  private writeTextChunks(
    prefix: string,
    text: string,
    size: number = runnerLimits.storageTextChunkCharacters,
  ): number {
    const count = Math.ceil(text.length / size);
    for (let i = 0; i < count; i++)
      this.ctx.storage.kv.put(
        `${prefix}:${i}`,
        text.slice(i * size, (i + 1) * size),
      );
    return count;
  }

  private readTextChunks(prefix: string, count: number): string {
    let text = "";
    for (let i = 0; i < count; i++)
      text += this.ctx.storage.kv.get<string>(`${prefix}:${i}`) ?? "";
    return text;
  }

  private async startSandbox(): Promise<void> {
    // Set up each new container, and a running container
    // after this Durable Object restarts.
    if (this.setup === undefined || !this.container.running) {
      this.setup = this.setUpSandbox().catch((error) => {
        this.setup = undefined;
        throw error;
      });
    }

    await this.setup;
  }

  private async setUpSandbox(): Promise<void> {
    if (!this.container.running) {
      this.container.start({
        image: this.container.images.agent,
        instance: "standard-1",
        enableInternet: false,
      });
    }

    try {
      const grant = this.ctx.storage.kv.get<RepositoryGrant>("githubGrant");
      const outbound = this.ctx.exports.Outbound({
        props: { ...(grant ? { grant } : {}) },
      });
      await this.container.interceptAllOutboundHttp(outbound);
      await this.container.interceptOutboundHttps("*", outbound);
      await this.container.setInactivityTimeout(sandboxTiming.inactivityMs);
    } catch (error) {
      // The next request starts a new container.
      await this.container.destroy();
      throw error;
    }
  }

  private async taskStatus(): Promise<TaskStatus> {
    const exitCode = await this.readOptionalText(this.exitCodePath);

    if (exitCode !== undefined) {
      return this.outcome(Number.parseInt(exitCode, 10));
    }

    const pid = await this.readOptionalText(this.pidPath);

    if (pid === undefined) {
      // The task writes its process ID right after it starts.
      return this.ctx.storage.kv.get(taskKey) === undefined
        ? { state: "none" }
        : { state: "running" };
    }

    const probe = await this.run(
      ["/bin/sh", "-c", taskRunningScript, "probe", this.pidPath],
      "/",
      {},
    );

    if (probe.exitCode === 0) {
      return { state: "running" };
    }

    // The task can finish after the first read, so read the exit code
    // again.
    const lateExitCode = await this.readOptionalText(this.exitCodePath);

    if (lateExitCode !== undefined) {
      return this.outcome(Number.parseInt(lateExitCode, 10));
    }

    return { state: "lost" };
  }

  private async outcome(exitCode: number): Promise<TaskStatus> {
    const agent = this.ctx.storage.kv.get<AgentName>(taskKey);
    if (!agent) return { state: "lost" };
    const events = await this.files.readFile(this.eventsPath);
    return parseOutcome(
      agent,
      exitCode,
      readLines(events.body),
      (await this.readOptionalText(this.stderrPath)) ?? "",
    );
  }

  private async readOptionalText(path: string): Promise<string | undefined> {
    try {
      return await (await this.files.readFile(path)).text();
    } catch (error) {
      if (SandboxFileError.is(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  private async run(
    command: string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<CommandResult> {
    const process = await this.container.exec(command, { cwd, env });
    const output = await process.output();
    const decoder = new TextDecoder();

    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }
}

async function* readLines(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (body === null) {
    return;
  }

  const decoder = new TextDecoder();
  let buffered = "";

  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    yield* lines;
  }

  buffered += decoder.decode();

  if (buffered !== "") {
    yield buffered;
  }
}
