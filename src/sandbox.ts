import { createHash } from 'node:crypto';
import { continuationReason, activeStates, type Turn, type Checkpoint } from './conversation';
import { validateChanges, type Proposal, type PullRequest } from './pull-request';
import { eventFrame } from './event-stream';
import { Files, SandboxFileError } from "@cloudflare/sandbox";
import type { RepositoryGrant } from "./github-api";
import { DurableObject } from "cloudflare:workers";
import { agentCommand, agentEnv, providerConfigs, parseOutcome, type AgentName } from "./agents";

const repositoryDirectory = "/workspace/repo";
const taskRoot = "/workspace/task";
const inactivityTimeout = 30 * 60 * 1000;
const taskCheckInterval = 60 * 1000;
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

export type TaskStatus =
	| { state: "none" }
	| { state: "running" }
    | { state: "stopping" }
    | { state: "cancelled"; error: string }
	| { state: "lost" }
	| { state: "succeeded"; result: string }
	| { state: "failed"; error: string };

export type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export class AgentSandbox extends DurableObject<Env> {
  private changing = false;
  private finalizing: Promise<void> | undefined;
  private get turn() { return this.ctx.storage.kv.get<number>('turn') || 0; }
  private get taskDirectory() { return this.turn ? `${taskRoot}/turn-${this.turn}` : taskRoot; }
  private get eventsPath() { return `${this.taskDirectory}/stdout.log`; }
  private get stderrPath() { return `${this.taskDirectory}/stderr.log`; }
  private get exitCodePath() { return `${this.taskDirectory}/exit-code`; }
  private get pidPath() { return `${this.taskDirectory}/pid`; }
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
				container.setInactivityTimeout(inactivityTimeout),
			);
		}
	}

	async cloneRepository(
		repository: string,
		ref: string | undefined,
        grant?: RepositoryGrant,
	): Promise<CommandResult> {
        if (this.ctx.storage.kv.get("repositoryReady")) return { exitCode: 1, stdout: "", stderr: "Use a new sandbox for each task" };
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
				repositoryDirectory,
			],
			"/workspace",
			trustEnv,
		);
        if (result.exitCode === 0) {
            const revision = await this.run(["git", "rev-parse", "HEAD"], repositoryDirectory, {});
            if (revision.exitCode !== 0) return revision;
            this.ctx.storage.kv.put("baseCommit", revision.stdout.trim());
            const branchName = await this.run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], repositoryDirectory, {});
            if (branchName.exitCode === 0) this.ctx.storage.kv.put('baseBranch', branchName.stdout.trim());
            this.ctx.storage.kv.put("repositoryReady", true);
        }
        return result;
	}

    async startTask(prompt: string, agent: AgentName): Promise<'started' | 'busy'> {
        if (this.changing || this.ctx.storage.kv.get(taskKey) !== undefined) return 'busy';
        this.changing = true;
        try {
            if (!this.ctx.storage.kv.get('repositoryReady')) throw Error('Clone a repository first');
            if (!this.container.running) throw Error('Workspace expired; use a new sandbox');
            this.ctx.storage.kv.put('conversationVersion', 1);
            await this.launchTurn(prompt, agent, crypto.randomUUID());
            return 'started';
        } finally { this.changing = false; }
    }

    async sendMessage(id: string, prompt: string): Promise<{ turn: number }> {
        const existing = this.ctx.storage.kv.get<number>(`request:${id}`);
        if (existing) {
            if (this.getTurn(existing)?.prompt !== prompt) throw Error('Ese identificador ya pertenece a otro mensaje.');
            return { turn: existing };
        }
        if (this.changing || this.publishing) throw Error('Espera a que termine la operación actual.');
        this.changing = true;
        try {
            const status = await this.readTask();
            const checkpoint = this.ctx.storage.kv.get<Checkpoint>('checkpoint');
            const reason = continuationReason(this.ctx.storage.kv.get('conversationVersion'), status.state, this.container.running, this.turn, checkpoint?.turn);
            if (reason) throw Error(reason);
            if (this.turn >= 100) throw Error('Esta conversación alcanzó 100 turnos. Conserva el patch y abre una tarea nueva.');
            if (!this.container.running || this.ctx.storage.kv.get('workspaceRestorePending')) {
                if (this.container.running) await this.container.destroy();
                await this.restoreWorkspace(checkpoint!);
            }
            await this.launchTurn(prompt, this.ctx.storage.kv.get<AgentName>(taskKey)!, id);
            return { turn: this.turn };
        } finally { this.changing = false; }
    }

    private async launchTurn(prompt: string, agent: AgentName, id: string) {
        await this.startSandbox();
        const number = this.turn + 1;
        this.ctx.storage.kv.put('turn', number);
        this.ctx.storage.kv.put(taskKey, agent);
        this.ctx.storage.kv.put(`request:${id}`, number);
        this.putTurn({ number, id, prompt, startedAt: Date.now(), state: 'running' });
        // Every turn gets fresh output and publication caches; the repository and native session stay intact.
        for (const key of ['result', 'logs', 'diffChunks', 'proposalChunks', 'proposalError', 'pullRequest', 'stopRequested', 'checkpointError']) this.ctx.storage.kv.delete(key);
        this.ctx.storage.kv.put('startedAt', Date.now());
        try {
            await this.files.mkdir(this.taskDirectory, { recursive: true });
            await this.files.mkdir('/workspace/conversation', { recursive: true });
            await this.files.mkdir('/workspace/agent-config/pi', { recursive: true });
            await this.files.writeFile('/workspace/agent-config/pi/models.json', JSON.stringify(providerConfigs(this.env).pi));
            await this.container.exec(['/bin/sh', '-c', taskScript, 'agent', this.taskDirectory, ...agentCommand(agent, prompt, this.env)], {
                cwd: repositoryDirectory, env: { ...trustEnv, ...agentEnv(agent, this.env), PWD: repositoryDirectory }, stdout: 'ignore', stderr: 'ignore',
            });
            await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
        } catch (error) {
            this.ctx.storage.kv.put('result', { state: 'failed', error: 'No se pudo iniciar el turno. Puedes reintentar enviando otro mensaje.' } satisfies TaskStatus);
            throw error;
        }
    }

    private putTurn(turn: Turn) {
        const { prompt, response, ...metadata } = turn;
        const write = (name: string, text: string) => {
            const count = Math.ceil(text.length / 16000);
            for (let i = 0; i < count; i++) this.ctx.storage.kv.put(`turn:${turn.number}:${name}:${i}`, text.slice(i * 16000, (i + 1) * 16000));
            return count;
        };
        this.ctx.storage.kv.put(`turn:${turn.number}`, { ...metadata, promptChunks: write('prompt', prompt), responseChunks: response === undefined ? undefined : write('response', response) });
    }

    private getTurn(number: number): Turn | undefined {
        const metadata = this.ctx.storage.kv.get<Omit<Turn, 'prompt' | 'response'> & { promptChunks: number; responseChunks?: number }>(`turn:${number}`);
        if (!metadata) return;
        const read = (name: string, count: number) => { let text = ''; for (let i = 0; i < count; i++) text += this.ctx.storage.kv.get<string>(`turn:${number}:${name}:${i}`) || ''; return text; };
        const { promptChunks, responseChunks, ...turn } = metadata;
        return { ...turn, prompt: read('prompt', promptChunks), response: responseChunks === undefined ? undefined : read('response', responseChunks) };
    }

    async conversation() {
        const status = await this.readTask();
        const checkpoint = this.ctx.storage.kv.get<Checkpoint>('checkpoint');
        const reason = continuationReason(this.ctx.storage.kv.get('conversationVersion'), status.state, this.container.running, this.turn, checkpoint?.turn);
        const turns: Turn[] = [];
        for (let i = 1; i <= this.turn; i++) { const turn = this.getTurn(i); if (turn) turns.push(turn); }
        return { turns, turn: this.turn, state: status.state, canContinue: !reason && this.turn < 100, reason: reason || (this.turn >= 100 ? 'Esta conversación alcanzó el límite de 100 turnos.' : undefined),
            checkpointSaved: checkpoint?.turn === this.turn, warning: this.ctx.storage.kv.get<string>('checkpointError') };
    }

    async alarm(): Promise<void> {
        if (this.changing || this.publishing) { await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval); return; }
        if (!this.container.running) return;
        const status = await this.readTask();
        if (status.state === 'running') {
            if (Date.now() - (this.ctx.storage.kv.get<number>('startedAt') || Date.now()) > 30 * 60_000) {
                await this.run(['node', '/opt/stop-task.mjs', this.taskDirectory], '/', {});
                await this.finishTurn({ state: 'failed', error: 'Este turno superó 30 minutos.' });
                await this.container.destroy();
            } else await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
        }
    }

    async stopTask(): Promise<{ state: TaskStatus['state']; containerRunning: boolean }> {
        if (this.changing || this.publishing) throw Error('Espera a que termine la operación actual.');
        this.changing = true;
        try {
            const original = await this.readTask();
            const active = activeStates.includes(original.state);
            if (active) this.ctx.storage.kv.put('stopRequested', true);
            await this.ctx.storage.deleteAlarm();
            if (this.container.running) {
                if (active) {
                    const stopped = await this.run(['node', '/opt/stop-task.mjs', this.taskDirectory], '/', {});
                    if (stopped.exitCode !== 0) throw Error('No pudimos detener el proceso de forma segura.');
                }
                await this.finishTurn(active ? { state: 'cancelled', error: 'Task stopped by user' } : original);
                await this.container.destroy();
            }
            this.ctx.storage.kv.delete('stopRequested');
            return { state: (await this.readTask()).state, containerRunning: this.container.running };
        } catch (error) {
            this.ctx.storage.kv.delete('stopRequested');
            if (this.container.running) await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
            throw error;
        } finally { this.changing = false; }
    }

    private async finishTurn(status: TaskStatus) {
        if (['none', 'running', 'stopping'].includes(status.state)) return;
        if (this.finalizing) return this.finalizing;
        if (this.ctx.storage.kv.get<number>('finishedTurn') === this.turn && this.ctx.storage.kv.get('result')) return;
        this.finalizing = (async () => {
            this.ctx.storage.kv.put('result', status);
            const turn = this.getTurn(this.turn);
            if (turn) this.putTurn({ ...turn, state: status.state, finishedAt: Date.now(), response: 'result' in status ? status.result : 'error' in status ? status.error : 'El entorno se perdió.' });
            if (this.container.running) {
                try { this.ctx.storage.kv.put('logs', await this.readLogs()); } catch { console.warn('Could not archive logs'); }
                try { const diff = await this.readDiff(); if (!diff.exitCode) this.saveDiff(diff); } catch { console.warn('Could not archive diff'); }
                await this.archiveProposal();
                if (this.ctx.storage.kv.get('conversationVersion')) {
                    try {
                        const saved = await this.run(['node', '/opt/workspace-checkpoint.mjs', 'save'], '/', {});
                        if (saved.exitCode !== 0) throw Error(saved.stderr || 'No se pudo guardar el entorno.');
                        const old = this.ctx.storage.kv.get<Checkpoint>('checkpoint');
                        const generation = crypto.randomUUID(), count = Math.ceil(saved.stdout.length / 50000);
                        for (let i = 0; i < count; i++) this.ctx.storage.kv.put(`checkpoint:${generation}:${i}`, saved.stdout.slice(i * 50000, (i + 1) * 50000));
                        this.ctx.storage.kv.put('checkpoint', { generation, count, turn: this.turn, digest: createHash('sha256').update(saved.stdout).digest('hex') } satisfies Checkpoint);
                        if (old) for (let i = 0; i < old.count; i++) this.ctx.storage.kv.delete(`checkpoint:${old.generation}:${i}`);
                    } catch (error) { this.ctx.storage.kv.put('checkpointError', error instanceof Error ? error.message : 'No se pudo guardar el entorno.'); }
                }
                const safe = !this.ctx.storage.kv.get('conversationVersion') || this.ctx.storage.kv.get<Checkpoint>('checkpoint')?.turn === this.turn;
                await this.container.setInactivityTimeout(safe ? 60_000 : inactivityTimeout);
            }
            this.ctx.storage.kv.put('finishedTurn', this.turn);
        })();
        try { await this.finalizing; } finally { this.finalizing = undefined; }
    }

    private async restoreWorkspace(checkpoint: Checkpoint) {
        let encoded = '';
        for (let i = 0; i < checkpoint.count; i++) encoded += this.ctx.storage.kv.get<string>(`checkpoint:${checkpoint.generation}:${i}`) || '';
        if (createHash('sha256').update(encoded).digest('hex') !== checkpoint.digest) throw Error('El punto de recuperación está incompleto. No se reinició la conversación.');
        this.ctx.storage.kv.put('workspaceRestorePending', true);
        try {
            await this.startSandbox();
            await this.files.writeFile('/workspace/checkpoint.b64', encoded);
            const restored = await this.run(['node', '/opt/workspace-checkpoint.mjs', 'restore', '/workspace/checkpoint.b64'], '/', {});
            if (restored.exitCode) throw Error('Restore failed');
            await this.files.remove('/workspace/checkpoint.b64', { force: true });
            this.ctx.storage.kv.delete('workspaceRestorePending');
        } catch {
            if (this.container.running) await this.container.destroy();
            throw Error('No se pudo recuperar el entorno. El punto guardado se conserva; puedes reintentar.');
        }
    }

    private async archiveProposal(): Promise<void> {
        if (this.ctx.storage.kv.get('proposalChunks') !== undefined || !this.container.running) return;
        if (!this.ctx.storage.kv.get('githubGrant')) return;
        try {
            const baseCommit = this.ctx.storage.kv.get<string>('baseCommit');
            if (!baseCommit) throw Error('La tarea no conserva su commit inicial.');
            const result = await this.run(['node', '/opt/export-changes.mjs', repositoryDirectory, baseCommit], '/', {});
            const value = JSON.parse(result.stdout);
            if (result.exitCode || value.error) throw Error(value.error || 'No se pudieron conservar los archivos.');
            const encoded = JSON.stringify(validateChanges(value));
            const chunks = Math.ceil(encoded.length / 16000);
            for (let i = 0; i < chunks; i++) this.ctx.storage.kv.put(`proposal:${i}`, encoded.slice(i * 16000, (i + 1) * 16000));
            this.ctx.storage.kv.put('proposalChunks', chunks);
            this.ctx.storage.kv.delete('proposalError');
        } catch (error) {
            this.ctx.storage.kv.put('proposalError', error instanceof Error ? error.message : 'No se pudo conservar la propuesta.');
        }
    }

    async pullRequestStatus(): Promise<{ pr?: PullRequest; available: boolean; reason?: string }> {
        const pr = this.ctx.storage.kv.get<PullRequest>('pullRequest');
        if (pr) return { pr, available: true };
        const state = (await this.readTask()).state;
        if (['none', 'running', 'stopping'].includes(state)) return { available: false, reason: 'Espera a que termine la tarea.' };
        if (!this.ctx.storage.kv.get('githubGrant')) return { available: false, reason: 'Ejecuta la tarea con un repositorio del selector de GitHub.' };
        if (!this.ctx.storage.kv.get('baseBranch')) return { available: false, reason: 'No se conserva una rama de origen. Ejecuta una tarea nueva desde una rama para crear un PR.' };
        await this.archiveProposal();
        const available = this.ctx.storage.kv.get('proposalChunks') !== undefined;
        return { available, reason: available ? undefined : this.ctx.storage.kv.get<string>('proposalError') || 'Esta tarea antigua solo conserva un patch. Ejecuta una tarea nueva para crear un PR.' };
    }

    async createPullRequest(taskId: string, title: string, description: string): Promise<PullRequest> {
        if (this.changing) throw Error('Espera a que termine la operación actual.');
        if (this.publishing) return this.publishing;
        this.publishing = (async () => {
            const status = await this.pullRequestStatus();
            if (status.pr) return status.pr;
            if (!status.available) throw Error(status.reason);
            let encoded = '';
            const count = this.ctx.storage.kv.get<number>('proposalChunks')!;
            for (let i = 0; i < count; i++) encoded += this.ctx.storage.kv.get<string>(`proposal:${i}`) || '';
            const proposal: Proposal = { ...validateChanges(JSON.parse(encoded)),
                baseCommit: this.ctx.storage.kv.get<string>('baseCommit')!, baseBranch: this.ctx.storage.kv.get<string>('baseBranch')! };
            const grant = this.ctx.storage.kv.get<RepositoryGrant>('githubGrant')!;
            const body = `${description}\n\n---\nCreated from sandbox task \`${taskId}\` (${this.ctx.storage.kv.get<string>(taskKey)}).\nStatus: ${ (await this.readTask()).state }.\nTests: review the task activity; checks have not been independently verified.\nBase commit: \`${proposal.baseCommit}\`.\n\nThis draft requires review before merging.`;
            const pr = await this.env.GITHUB.getByName('owner').createPullRequest(grant, this.turn > 1 ? `${taskId}-turn-${this.turn}` : taskId, proposal, title, body);
            this.ctx.storage.kv.put('pullRequest', pr);
            return pr;
        })();
        try { return await this.publishing; } finally { this.publishing = undefined; }
    }

    async streamEvents(cursor: string, expectedTurn?: number): Promise<Response> {
        const observedTurn = this.turn;
        const observedDirectory = this.taskDirectory;
        const status = await this.readTask();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        let observer: ExecProcess | undefined;
        let exited = false;
        let disconnected = false;
        const stopObserver = () => {
            disconnected = true;
            // Disconnecting the browser must never signal the independent agent process.
            if (observer && !exited) { try { observer.kill(); } catch {} }
        };
        void writer.closed.catch(stopObserver);
        const heartbeat = setInterval(() => {
            void writer.write(new TextEncoder().encode(': keep-alive\n\n')).catch(stopObserver);
        }, 5000);
        const send = (type: string, data: unknown) => writer.write(eventFrame(type, data));
        const pump = async () => {
            try {
                if (this.turn !== observedTurn) { await send('turn', { turn: this.turn }); return; }
                await send('turn', { turn: observedTurn });
                if (expectedTurn !== undefined && expectedTurn !== observedTurn) return;
                await send('status', status);
                if (this.container.running && this.ctx.storage.kv.get(taskKey)) {
                    observer = await this.container.exec(['node', '/opt/follow-task.mjs', observedDirectory, cursor], { cwd: '/', stderr: 'ignore' });
                    void observer.exitCode.then(() => { exited = true; }, () => { exited = true; });
                    if (disconnected) { stopObserver(); return; }
                    if (!observer.stdout) throw Error('Missing observer output');
                    let buffered = '';
                    // Forward whole SSE frames so heartbeat comments cannot split a JSON payload.
                    for await (const text of observer.stdout.pipeThrough(new TextDecoderStream())) {
                        buffered += text;
                        let boundary: number;
                        while ((boundary = buffered.indexOf('\n\n')) >= 0) {
                            await writer.write(new TextEncoder().encode(buffered.slice(0, boundary + 2)));
                            buffered = buffered.slice(boundary + 2);
                        }
                    }
                    if (buffered) throw Error('Incomplete observer frame');
                    if (await observer.exitCode !== 0) throw Error('Log observer stopped');
                } else {
                    // Archived output is a bounded tail, so explicitly replace any partial replay.
                    await send('reset', { archived: true });
                    const logs = this.ctx.storage.kv.get<{ stdout: string; stderr: string }>('logs');
                    if (logs?.stdout) await send('stdout', logs.stdout);
                    if (logs?.stderr) await send('stderr', logs.stderr);
                }
                const final = await this.readTask();
                if (this.turn !== observedTurn) { await send('turn', { turn: this.turn }); return; }
                await send('status', final);
                if (!['running', 'stopping'].includes(final.state)) await send('done', {});
            } catch (error) {
                if (!disconnected) {
                    console.warn('Log observer interrupted', error instanceof Error ? error.message : 'unknown');
                    try {
                        if (this.turn !== observedTurn) { await send('turn', { turn: this.turn }); return; }
                        const final = await this.readTask();
                        await send('status', final);
                        if (!['running', 'stopping'].includes(final.state)) await send('done', {});
                        else await send('notice', { message: 'Reconectando la actividad…' });
                    } catch {}
                }
            } finally {
                clearInterval(heartbeat);
                stopObserver();
                await writer.close().catch(() => {});
            }
        };
        void pump();
        return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }

    async readTask(): Promise<TaskStatus> {
        if (this.ctx.storage.kv.get('stopRequested')) return { state: 'stopping' };
        const saved = this.ctx.storage.kv.get<TaskStatus>('result');
        const status: TaskStatus = saved || (!this.container.running
            ? this.ctx.storage.kv.get(taskKey) === undefined ? { state: 'none' } : { state: 'lost' }
            : await this.taskStatus());
        await this.finishTurn(status);
        return status;
    }

    async readLogs(): Promise<{ stdout: string; stderr: string }> {
        const saved = this.ctx.storage.kv.get<{ stdout: string; stderr: string }>("logs");
        if (saved) return saved;
        if (!this.container.running) return { stdout: "", stderr: "Workspace is no longer running" };
        const stdout = await this.run(["tail", "-c", "32000", this.eventsPath], "/", {});
        const stderr = await this.run(["tail", "-c", "32000", this.stderrPath], "/", {});
        return { stdout: stdout.stdout, stderr: stderr.stdout };
    }

	async readDiff(): Promise<CommandResult> {
        const count = this.ctx.storage.kv.get<number>("diffChunks");
        if (count !== undefined) {
            let stdout = "";
            for (let i = 0; i < count; i++) stdout += this.ctx.storage.kv.get<string>(`diff:${i}`) ?? "";
            return { exitCode: 0, stdout, stderr: "" };
        }
        if (!this.container.running) return { exitCode: 1, stdout: "", stderr: "Workspace is no longer running and no diff was saved" };
        await this.startSandbox();

		return this.run(
			["/bin/sh", "-c", 'git -c core.hooksPath=/dev/null add --intent-to-add . && git --no-pager diff --binary --no-ext-diff --no-textconv "$1" -- .', "diff", this.ctx.storage.kv.get<string>("baseCommit") ?? "HEAD"],
			repositoryDirectory,
			{},
		);
	}

    private saveDiff(diff: CommandResult): void {
        const chunks = Math.ceil(diff.stdout.length / 16000);
        for (let i = 0; i < chunks; i++) this.ctx.storage.kv.put(`diff:${i}`, diff.stdout.slice(i * 16000, (i + 1) * 16000));
        this.ctx.storage.kv.put("diffChunks", chunks);
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
            const outbound = this.ctx.exports.Outbound({ props: { ...(grant ? { grant } : {}) } });
            await this.container.interceptAllOutboundHttp(outbound);
			await this.container.interceptOutboundHttps(
				"*",
				outbound,
			);
			await this.container.setInactivityTimeout(inactivityTimeout);
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
        return parseOutcome(agent, exitCode, readLines(events.body), (await this.readOptionalText(this.stderrPath)) ?? "");
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

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
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
