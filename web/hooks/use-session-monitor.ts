import { useCallback, useEffect, useRef, useState } from "react";
import { SessionMonitor, type SessionSnapshot } from "@/lib/session-monitor";
import { runnerConfig } from "@/lib/config";
import type { Run } from "@/lib/types";

type Request = (
  path: string,
  body?: unknown,
  method?: string,
  options?: { signal?: AbortSignal },
) => Promise<Response>;
export function useSessionMonitor(
  runs: Run[],
  connected: boolean,
  request: Request,
  observed: (id: string, snapshot: SessionSnapshot) => void,
) {
  const [snapshots, setSnapshots] = useState<
    Record<string, SessionSnapshot | null>
  >({});
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const monitor = useRef<SessionMonitor | null>(null);
  const refresh = useCallback(
    (ids?: string[]) =>
      monitor.current?.refresh(
        ids ||
          runsRef.current
            .filter((run) => run.state !== "cloning")
            .map((run) => run.id),
      ) || Promise.resolve([]),
    [],
  );
  const suspend = useCallback((id: string) => monitor.current?.suspend(id), []);
  const resume = useCallback(
    (id: string) => monitor.current?.resume(id) || Promise.resolve([]),
    [],
  );
  const remove = useCallback((id: string) => {
    monitor.current?.suspend(id);
    setSnapshots((items) => {
      const next = { ...items };
      delete next[id];
      return next;
    });
    setChecking((items) => {
      const next = new Set(items);
      next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    setSnapshots({});
    setChecking(new Set());
    if (!connected) return;
    // Own the coordinator inside the effect so Strict Mode can recreate it safely.
    const instance = new SessionMonitor(
      async (id, signal) =>
        (
          await request(`/sandboxes/${id}/task?runtime=1`, undefined, "GET", {
            signal,
          })
        ).json(),
      (id, value) => {
        setSnapshots((items) => ({ ...items, [id]: value }));
        if (value) observed(id, value);
      },
      (id, value) =>
        setChecking((items) => {
          const next = new Set(items);
          if (value) next.add(id);
          else next.delete(id);
          return next;
        }),
    );
    monitor.current = instance;
    void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(
      visibleRefresh,
      runnerConfig.monitorIntervalMs,
    );
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      instance.dispose();
      monitor.current = null;
      clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [connected, request, observed, refresh]);
  const ids = runs
    .filter((run) => run.state !== "cloning")
    .map((run) => run.id)
    .join(",");
  useEffect(() => {
    if (ids) void refresh(ids.split(","));
  }, [ids, refresh]);
  return { snapshots, checking, refresh, suspend, resume, remove };
}
