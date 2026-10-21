import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionStatus } from "@/lib/api-types";

type Request = (
  path: string,
  body?: unknown,
  method?: string,
  options?: { signal?: AbortSignal },
) => Promise<Response>;
const statusIntervalMs = 30_000;
const statusTimeoutMs = 15_000;
export function useSessionRuntime(
  task: string | null,
  revision: number,
  request: Request,
) {
  const [snapshot, setSnapshot] = useState<{
    task: string;
    running: boolean;
    checkedAt: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!task) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const ticket = ++generation.current;
    setChecking(true);
    try {
      const response = await request(
        `/sandboxes/${task}/task`,
        undefined,
        "GET",
        {
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(statusTimeoutMs),
          ]),
        },
      );
      const status: ExecutionStatus = await response.json();
      if (ticket === generation.current) {
        // An absent field is unknown, never evidence that a cloud session stopped.
        setSnapshot(
          typeof status.containerRunning === "boolean"
            ? { task, running: status.containerRunning, checkedAt: Date.now() }
            : null,
        );
      }
    } catch {
      if (ticket === generation.current) setSnapshot(null);
    } finally {
      if (ticket === generation.current) setChecking(false);
    }
  }, [task, request]);
  useEffect(() => {
    setSnapshot(null);
    setChecking(false);
    if (!task) return;
    void refresh();
    // This checks runtime state only. Tool logs continue using their single SSE observer.
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(visibleRefresh, statusIntervalMs);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      ++generation.current;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, revision, task]);
  return {
    running: snapshot?.task === task ? snapshot.running : null,
    checkedAt: snapshot?.task === task ? snapshot.checkedAt : null,
    checking,
    refresh,
  };
}
