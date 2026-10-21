import type { TaskState } from "../../src/task-status";
import { isActive, stateNames, type Run } from "./types";
import { runnerConfig } from "./config";

export type SessionSnapshot = {
  state: TaskState;
  containerRunning: boolean | null;
  checkedAt: number;
};
export type StatusRequest = (
  id: string,
  signal: AbortSignal,
) => Promise<unknown>;
type Job = {
  id: string;
  controller: AbortController;
  promise: Promise<void>;
  resolve: () => void;
};

export function parseSessionSnapshot(value: unknown): SessionSnapshot {
  if (!value || typeof value !== "object")
    throw Error("Session status unavailable");
  const data = value as Record<string, unknown>;
  if (
    typeof data.state !== "string" ||
    data.state === "cloning" ||
    !Object.hasOwn(stateNames, data.state)
  )
    throw Error("Invalid session state");
  return {
    state: data.state as TaskState,
    containerRunning:
      typeof data.containerRunning === "boolean" ? data.containerRunning : null,
    checkedAt: Date.now(),
  };
}

export function sessionIsRunning(run: Run, snapshot?: SessionSnapshot | null) {
  return isActive(run.state) || snapshot?.containerRunning === true;
}

export function retainSessionReferences<
  T extends { id: string; state?: unknown },
>(runs: T[], retainedIds: ReadonlySet<string> = new Set()): T[] {
  return runs.filter(
    (run, index) =>
      index < runnerConfig.historyLimit ||
      (typeof run.state === "string" &&
        ["cloning", "running", "stopping"].includes(run.state)) ||
      retainedIds.has(run.id),
  );
}

/** Bounded status reads with per-session cancellation; no agent output is collected here. */
export class SessionMonitor {
  private jobs = new Map<string, Job>();
  private suspended = new Set<string>();
  private queue: Job[] = [];
  private active = 0;
  private disposed = false;
  constructor(
    private request: StatusRequest,
    private snapshot: (id: string, value: SessionSnapshot | null) => void,
    private checking: (id: string, value: boolean) => void,
    private concurrency: number = runnerConfig.monitorConcurrency,
  ) {}
  refresh(ids: string[]): Promise<void[]> {
    return Promise.all(
      [...new Set(ids)]
        .filter((id) => !this.suspended.has(id))
        .map((id) => this.enqueue(id)),
    );
  }
  invalidate(id: string) {
    this.jobs.get(id)?.controller.abort();
    this.jobs.delete(id);
    if (!this.disposed) {
      this.snapshot(id, null);
      this.checking(id, false);
    }
  }
  suspend(id: string) {
    this.suspended.add(id);
    this.invalidate(id);
  }
  resume(id: string) {
    this.suspended.delete(id);
    return this.refresh([id]);
  }
  dispose() {
    this.disposed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    for (const job of this.queue) job.resolve();
    this.jobs.clear();
    this.queue = [];
  }
  private enqueue(id: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.jobs.get(id);
    if (existing) return existing.promise;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const job = { id, controller: new AbortController(), promise, resolve };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.checking(id, true);
    this.pump();
    return promise;
  }
  private current(job: Job) {
    return (
      !this.disposed &&
      this.jobs.get(job.id) === job &&
      !job.controller.signal.aborted
    );
  }
  private pump() {
    while (
      !this.disposed &&
      this.active < this.concurrency &&
      this.queue.length
    ) {
      const job = this.queue.shift()!;
      if (!this.current(job)) {
        job.resolve();
        continue;
      }
      this.active++;
      void this.read(job);
    }
  }
  private async read(job: Job) {
    try {
      const value = await this.request(
        job.id,
        AbortSignal.any([
          job.controller.signal,
          AbortSignal.timeout(runnerConfig.monitorTimeoutMs),
        ]),
      );
      if (this.current(job)) this.snapshot(job.id, parseSessionSnapshot(value));
    } catch {
      if (this.current(job)) this.snapshot(job.id, null);
    } finally {
      if (this.current(job)) {
        this.jobs.delete(job.id);
        this.checking(job.id, false);
      }
      this.active--;
      job.resolve();
      this.pump();
    }
  }
}
