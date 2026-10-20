import { eventFrame } from './event-stream';
import { Files, SandboxFileError } from "@cloudflare/sandbox";
import type { RepositoryGrant } from "./github-api";
import { DurableObject } from "cloudflare:workers";
import { agentCommand, agentEnv, providerConfigs, parseOutcome, type AgentName } from "./agents";

const repositoryDirectory = "/workspace/repo";
const taskDirectory = "/workspace/task";
const eventsPath = `${taskDirectory}/stdout.log`;
const stderrPath = `${taskDirectory}/stderr.log`;
const exitCodePath = `${taskDirectory}/exit-code`;
const pidPath = `${taskDirectory}/pid`;
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
            this.ctx.storage.kv.put("repositoryReady", true);
        }
        return result;
	}

	startTask(prompt: string, agent: AgentName): Promise<"started" | "busy"> {
		return this.ctx.blockConcurrencyWhile(async () => {
            if (this.ctx.storage.kv.get(taskKey) !== undefined) return "busy";
            if (!this.ctx.storage.kv.get("repositoryReady")) throw new Error("Clone a repository first");
            if (!this.container.running) throw new Error("Workspace expired; use a new sandbox");
            await this.startSandbox();

			if ((await this.taskStatus()).state === "running") {
				return "busy";
			}

            await this.files.remove(taskDirectory, { recursive: true, force: true });
			await this.files.mkdir(taskDirectory);
            await this.files.mkdir("/workspace/agent-config/pi", { recursive: true });
            await this.files.writeFile("/workspace/agent-config/pi/models.json", JSON.stringify(providerConfigs(this.env).pi));

			await this.container.exec(
				[
					"/bin/sh",
					"-c",
					taskScript,
					"agent",
					taskDirectory,
					...agentCommand(agent, prompt, this.env),
				],
				{
					cwd: repositoryDirectory,
					env: { ...trustEnv, ...agentEnv(agent, this.env), PWD: repositoryDirectory },
					stdout: "ignore",
					stderr: "ignore",
				},
			);

			this.ctx.storage.kv.put(taskKey, agent);
            this.ctx.storage.kv.put("startedAt", Date.now());
			await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
			return "started";
		});
	}

	async alarm(): Promise<void> {
		if (!this.container.running) {
			return;
		}

        const status = await this.taskStatus();
        if (status.state === "running") {
            if (Date.now() - (this.ctx.storage.kv.get<number>("startedAt") ?? Date.now()) > 30 * 60_000) {
                const diff = await this.readDiff();
                if (diff.exitCode === 0) this.saveDiff(diff);
                this.ctx.storage.kv.put("logs", await this.readLogs());
                this.ctx.storage.kv.put("result", { state: "failed", error: "Task exceeded 30 minutes" });
                await this.container.destroy();
            } else {
                await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
            }
            return;
        }

        this.ctx.storage.kv.put("result", status);
        this.ctx.storage.kv.put("logs", await this.readLogs());
        const diff = await this.readDiff();
        if (diff.exitCode === 0) this.saveDiff(diff);
        await this.container.setInactivityTimeout(60_000);
	}

    async stopTask(): Promise<{ state: TaskStatus['state']; containerRunning: boolean }> {
        return this.ctx.blockConcurrencyWhile(async () => {
            const original = await this.readTask();
            const active = ['running', 'stopping'].includes(original.state);
            if (active) this.ctx.storage.kv.put('stopRequested', true);
            await this.ctx.storage.deleteAlarm();
            try {
                if (this.container.running) {
                    if (active) {
                        // Only signal the agent's own process group from this container boot.
                        await this.run(['node', '/opt/stop-task.mjs', taskDirectory], '/', {}).catch(() => {});
                    }
                    try { this.ctx.storage.kv.put('logs', await this.readLogs()); } catch { console.warn('Could not archive logs before shutdown'); }
                    try { const diff = await this.readDiff(); if (diff.exitCode === 0) this.saveDiff(diff); } catch { console.warn('Could not archive changes before shutdown'); }
                    await this.container.destroy();
                }
                if (active) this.ctx.storage.kv.put('result', { state: 'cancelled', error: 'Task stopped by user' } satisfies TaskStatus);
                else if (original.state !== 'none') this.ctx.storage.kv.put('result', original);
                this.ctx.storage.kv.delete('stopRequested');
            } catch (error) {
                this.ctx.storage.kv.delete('stopRequested');
                if (active) await this.ctx.storage.setAlarm(Date.now() + taskCheckInterval);
                throw error;
            }
            const status = await this.readTask();
            return { state: status.state, containerRunning: this.container.running };
        });
    }

    async streamEvents(cursor: string): Promise<Response> {
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
                await send('status', status);
                if (this.container.running && this.ctx.storage.kv.get(taskKey)) {
                    observer = await this.container.exec(['node', '/opt/follow-task.mjs', taskDirectory, cursor], { cwd: '/', stderr: 'ignore' });
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
                await send('status', final);
                if (!['running', 'stopping'].includes(final.state)) await send('done', {});
            } catch (error) {
                if (!disconnected) {
                    console.warn('Log observer interrupted', error instanceof Error ? error.message : 'unknown');
                    try {
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
        const result = this.ctx.storage.kv.get<TaskStatus>("result");
        if (result) return result;
		if (!this.container.running) {
			return this.ctx.storage.kv.get(taskKey) === undefined
				? { state: "none" }
				: { state: "lost" };
		}

		return this.taskStatus();
	}

    async readLogs(): Promise<{ stdout: string; stderr: string }> {
        const saved = this.ctx.storage.kv.get<{ stdout: string; stderr: string }>("logs");
        if (saved) return saved;
        if (!this.container.running) return { stdout: "", stderr: "Workspace is no longer running" };
        const stdout = await this.run(["tail", "-c", "32000", eventsPath], "/", {});
        const stderr = await this.run(["tail", "-c", "32000", stderrPath], "/", {});
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
		const exitCode = await this.readOptionalText(exitCodePath);

		if (exitCode !== undefined) {
			return this.outcome(Number.parseInt(exitCode, 10));
		}

		const pid = await this.readOptionalText(pidPath);

		if (pid === undefined) {
			// The task writes its process ID right after it starts.
			return this.ctx.storage.kv.get(taskKey) === undefined
				? { state: "none" }
				: { state: "running" };
		}

		const probe = await this.run(
			["/bin/sh", "-c", taskRunningScript, "probe", pidPath],
			"/",
			{},
		);

		if (probe.exitCode === 0) {
			return { state: "running" };
		}

		// The task can finish after the first read, so read the exit code
		// again.
		const lateExitCode = await this.readOptionalText(exitCodePath);

		if (lateExitCode !== undefined) {
			return this.outcome(Number.parseInt(lateExitCode, 10));
		}

		return { state: "lost" };
	}

	private async outcome(exitCode: number): Promise<TaskStatus> {
        const agent = this.ctx.storage.kv.get<AgentName>(taskKey);
        if (!agent) return { state: "lost" };
        const events = await this.files.readFile(eventsPath);
        return parseOutcome(agent, exitCode, readLines(events.body), (await this.readOptionalText(stderrPath)) ?? "");
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
