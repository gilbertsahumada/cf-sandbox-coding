import { runnerConfig, workspaceConfig } from "@/lib/config";
import type {
  GitHubConnection,
  RememberedRepository,
  RepositoryPage,
  TaskStatus,
} from "@/lib/api-types";
import { prepareSession, type Startup } from "@/lib/session-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { historyForStorage, recoveredRun } from "@/lib/run-history.js";
import { createActivity } from "@/lib/activity.js";
import { assistantStream } from "@/lib/editor";
import {
  isActive,
  type Agent,
  type Conversation,
  type GitHubStatus,
  type Proposal,
  type Repository,
  type Run,
  type RunState,
  type StreamState,
} from "@/lib/types";
function initialHistory(): Run[] {
  let runs: Run[] = [];
  try {
    runs = historyForStorage(
      JSON.parse(localStorage.getItem(runnerConfig.historyStorageKey) || "[]"),
    );
  } catch {}
  runs = runs.map((run) =>
    run.state === "cloning"
      ? { ...run, state: "failed", finishedAt: Date.now() }
      : run,
  );
  const recovered = recoveredRun(
    new URL(location.href).searchParams.get("task"),
  );
  return recovered
    ? [
        runs.find((run) => run.id === recovered.id) || recovered,
        ...runs.filter((run) => run.id !== recovered.id),
      ].slice(0, runnerConfig.historyLimit)
    : runs;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not be completed.";
function taskOutput(status: TaskStatus): string | undefined {
  if ("result" in status) return status.result;
  if ("error" in status) return status.error;
}

export function useRunner() {
  const [runs, setRuns] = useState<Run[]>(initialHistory);
  const [selectedId, setSelectedId] = useState(() => runs[0]?.id || null);
  const selected = runs.find((run) => run.id === selectedId) || null;
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [startup, setStartup] = useState<Startup | null>(null);
  const startLock = useRef(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [liveText, setLiveText] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("");
  const [loadingTask, setLoadingTask] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [revision, setRevision] = useState(0);
  const [activityCount, setActivityCount] = useState(0);
  const activityRef = useRef<HTMLDivElement>(null),
    followRef = useRef(true);
  // Epochs discard responses that belong to a signed-out session or replaced catalog.
  const authEpoch = useRef(0),
    selectedRef = useRef(selectedId),
    catalogEpoch = useRef(0);
  selectedRef.current = selectedId;
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [repositoryPage, setRepositoryPage] = useState(1);
  const [repositoryTotal, setRepositoryTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const rememberQueue = useRef(Promise.resolve()),
    pendingMessage = useRef<{
      task: string;
      id: string;
      prompt: string;
    } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const observedTask = useRef<string | null>(null);
  const clearSession = useCallback(() => {
    authEpoch.current++;
    catalogEpoch.current++;
    setConnected(false);
    setRuns((items) => items.filter((run) => !run.private));
    setSelectedId(null);
    setConversation(null);
    setStartup(null);
    setLiveText(null);
    setDiff("");
    setProposal(null);
    setGithub(null);
    setRepositories([]);
    setRepository(null);
    setStreamState("");
    activityRef.current?.replaceChildren();
    setActivityCount(0);
    pendingMessage.current = null;
  }, []);
  const request = useCallback(
    async (
      path: string,
      body?: unknown,
      method?: string,
      options: { signal?: AbortSignal; keepalive?: boolean } = {},
    ) => {
      const epoch = authEpoch.current;
      const response = await fetch(path, {
        method: method || (body ? "POST" : "GET"),
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal:
          options.signal || AbortSignal.timeout(runnerConfig.requestTimeoutMs),
        keepalive: options.keepalive,
      });
      if (epoch !== authEpoch.current)
        throw new DOMException("Session changed", "AbortError");
      if (response.status === 401) {
        clearSession();
        setAuthOpen(true);
        throw Error("Your session expired. Sign in to continue.");
      }
      if (!response.ok) {
        let detail = "";
        try {
          const data = await response.json();
          detail =
            data.message || data.stderr || data.error?.[0]?.message || "";
        } catch {}
        throw Error(
          detail || `The request could not be completed (${response.status}).`,
        );
      }
      return response;
    },
    [clearSession],
  );
  const report = useCallback((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      setNotice(message(error));
  }, []);
  const updateRun = useCallback(
    (id: string, update: Partial<Run>) =>
      setRuns((items) =>
        items.map((run) => (run.id === id ? { ...run, ...update } : run)),
      ),
    [],
  );
  const activate = useCallback((id: string) => {
    if (selectedRef.current !== id) {
      // Do not render the previous task's transcript or proposal under a new ID.
      setConversation(null);
      setLiveText(null);
      setDiff("");
      setProposal(null);
      setLoadingTask(true);
      setLoadingDiff(true);
    }
    setSelectedId(id);
    setRevision((value) => value + 1);
    setNotice("");
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        runnerConfig.historyStorageKey,
        JSON.stringify(historyForStorage(runs)),
      );
    } catch {}
  }, [runs]);
  useEffect(() => {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set("task", selectedId);
    else url.searchParams.delete("task");
    window.history.replaceState(null, "", url);
  }, [selectedId]);
  useEffect(() => {
    let current = true;
    const epoch = authEpoch.current;
    fetch("/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (current && epoch === authEpoch.current) setConnected(response.ok);
      })
      .catch(report)
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [report]);
  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return;
    const instance = new BroadcastChannel(runnerConfig.updateChannelName);
    channel.current = instance;
    instance.onmessage = (event) => {
      if (selectedRef.current === event.data?.task)
        setRevision((value) => value + 1);
    };
    return () => {
      instance.close();
      channel.current = null;
    };
  }, []);
  const loadRepositories = useCallback(
    async (append = false, page = 1, ticket = catalogEpoch.current) => {
      setCatalogBusy(true);
      try {
        const [batch, saved] = await Promise.allSettled([
          request(`/github/repositories?page=${page}`).then(
            (response) => response.json() as Promise<RepositoryPage>,
          ),
          append
            ? Promise.resolve(null)
            : request("/github/selected-repository").then(
                (response) => response.json() as Promise<RememberedRepository>,
              ),
        ]);
        if (batch.status === "rejected") throw batch.reason;
        if (ticket !== catalogEpoch.current) return;
        const data = batch.value,
          remembered = saved.status === "fulfilled" ? saved.value : null;
        setRepositories((items) => [
          ...new Map(
            [
              ...(append ? items : []),
              ...(remembered?.repository ? [remembered.repository] : []),
              ...data.repositories,
            ].map((repo: Repository) => [repo.url, repo]),
          ).values(),
        ]);
        setRepositoryPage(page);
        setRepositoryTotal(data.total);
        setHasMore(data.hasMore);
        if (remembered?.repository) setRepository(remembered.repository);
        if (remembered?.warning) setNotice(remembered.warning);
      } catch (error) {
        if (ticket === catalogEpoch.current) report(error);
      } finally {
        if (ticket === catalogEpoch.current) setCatalogBusy(false);
      }
    },
    [report, request],
  );
  useEffect(() => {
    if (!connected) return;
    const ticket = ++catalogEpoch.current;
    request("/github/status")
      .then((response) => response.json())
      .then((data) => {
        if (ticket !== catalogEpoch.current) return;
        setGithub(data);
        if (data.connected) void loadRepositories(false, 1, ticket);
      })
      .catch(report);
    return () => {
      catalogEpoch.current++;
    };
  }, [connected, loadRepositories, report, request]);
  const chooseRepository = useCallback(
    (repo: Repository) => {
      setRepository(repo);
      const ticket = catalogEpoch.current;
      // Serialize preference writes so an earlier slow selection cannot win the race.
      rememberQueue.current = rememberQueue.current
        .catch(() => {})
        .then(async () => {
          if (ticket !== catalogEpoch.current) return;
          try {
            await request(
              "/github/selected-repository",
              {
                installationId: repo.installationId,
                repositoryId: repo.repositoryId,
              },
              "PUT",
              { keepalive: true },
            );
          } catch (error) {
            if (ticket === catalogEpoch.current) report(error);
          }
        });
    },
    [report, request],
  );
  const connectGitHub = useCallback(async () => {
    if (!connected) {
      setAuthOpen(true);
      return;
    }
    const data: GitHubConnection = await (
      await request("/github/connect", {})
    ).json();
    if ("url" in data) {
      location.assign(data.url);
      return;
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = data.action;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "manifest";
    input.value = JSON.stringify(data.manifest);
    form.append(input);
    document.body.append(form);
    form.submit();
  }, [connected, request]);
  const disconnectGitHub = useCallback(async () => {
    const data = await (
      await request("/github/connection", undefined, "DELETE")
    ).json();
    catalogEpoch.current++;
    setGithub(null);
    setRepositories([]);
    setRepository(null);
    setHasMore(false);
    setRepositoryTotal(0);
    if (data.warning) setNotice(data.warning);
  }, [request]);
  // A stream observer belongs to a selected view, never to the agent's lifetime.
  useEffect(() => {
    if (observedTask.current !== selectedId || !connected) {
      setConversation(null);
      setDiff("");
    }
    observedTask.current = selectedId;
    setProposal(null);
    setLiveText(null);
    setStreamState("");
    setLoadingTask(false);
    setLoadingDiff(false);
    activityRef.current?.replaceChildren();
    setActivityCount(0);
    if (!connected || !selectedId) return;
    const run = runs.find((item) => item.id === selectedId);
    if (!run || run.state === "cloning") return;
    let current = true,
      source: EventSource | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      busyDiff = false,
      again = false,
      terminal = false,
      authCheckedAt = 0;
    const controller = new AbortController();
    setLoadingTask(true);
    setLoadingDiff(true);
    setStreamState("Connecting");
    const transcript = assistantStream(setLiveText);
    const activity = (archived = false) =>
      activityRef.current
        ? createActivity(
            activityRef.current,
            run,
            {
              set textContent(value: string) {
                if (current) setActivityCount(Number(value));
              },
            },
            {
              get checked() {
                return followRef.current;
              },
            },
            { archived },
          )
        : null;
    let view = activity();
    const freshConversation = async () => {
      const info: Conversation = await (
        await request(`/sandboxes/${run.id}/messages`, undefined, "GET", {
          signal: controller.signal,
        })
      ).json();
      if (current) {
        setConversation(info);
        setLiveText(null);
      }
      return info;
    };
    const refreshProposal = async () => {
      const info: Proposal = await (
        await request(`/sandboxes/${run.id}/pull-request`, undefined, "GET", {
          signal: controller.signal,
        })
      ).json();
      if (current) setProposal(info);
    };
    const queueDiff = (immediate = false) => {
      if (!current) return;
      if (busyDiff) {
        again = true;
        return;
      }
      if (timer && !immediate) return;
      clearTimeout(timer);
      timer = setTimeout(
        async () => {
          timer = undefined;
          busyDiff = true;
          try {
            const text = await (
              await request(`/sandboxes/${run.id}/diff`, undefined, "GET", {
                signal: controller.signal,
              })
            ).text();
            if (current) setDiff(text);
          } catch (error) {
            if (current && terminal) report(error);
          } finally {
            if (current) setLoadingDiff(false);
            busyDiff = false;
            if (again && current) {
              again = false;
              queueDiff(terminal);
            }
          }
        },
        immediate ? 0 : runnerConfig.diffDebounceMs,
      );
    };
    const begin = async () => {
      const info = await freshConversation();
      if (!current) return;
      setLoadingTask(false);
      queueDiff(true);
      source = new EventSource(`/sandboxes/${run.id}/events?turn=${info.turn}`);
      source.onopen = () => {
        if (current) setStreamState("Live");
      };
      source.addEventListener("turn", (event) => {
        if (current && JSON.parse(event.data).turn !== info.turn)
          setRevision((value) => value + 1);
      });
      source.addEventListener("reset", () => {
        if (current) {
          transcript.reset();
          view = activity(true);
        }
      });
      source.addEventListener("stdout", (event) => {
        if (current) {
          const text = JSON.parse(event.data);
          transcript.push(text);
          if (view?.stdout(text)) queueDiff();
        }
      });
      source.addEventListener("stderr", (event) => {
        if (current) view?.stderr(JSON.parse(event.data));
      });
      source.addEventListener("notice", () => {
        if (current) setStreamState("Reconnecting");
      });
      source.addEventListener("status", (event) => {
        if (!current) return;
        const status: TaskStatus = JSON.parse(event.data);
        const state: RunState = status.state === "none" ? "lost" : status.state;
        terminal = !isActive(state);
        updateRun(run.id, {
          state,
          ...(terminal ? { finishedAt: Date.now() } : {}),
        });
        const output = taskOutput(status);
        if (output)
          setConversation((previous) =>
            previous?.turns.length
              ? previous
              : {
                  ...info,
                  state,
                  canContinue: info.canContinue,
                  turns: [
                    {
                      number: 0,
                      id: "legacy",
                      prompt: "Task result",
                      response: output,
                      state,
                      startedAt: run.startedAt || 0,
                    },
                  ],
                },
          );
      });
      source.addEventListener("done", () => {
        if (!current) return;
        source?.close();
        view?.finish();
        terminal = true;
        setStreamState("Saved");
        queueDiff(true);
        void freshConversation()
          .then((data) => {
            if (current && !data.turns.length)
              return request(`/sandboxes/${run.id}/task`, undefined, "GET", {
                signal: controller.signal,
              })
                .then((response) => response.json())
                .then((status: TaskStatus) => {
                  const output = taskOutput(status);
                  if (current && output)
                    setConversation({
                      ...data,
                      turns: [
                        {
                          number: 0,
                          id: "legacy",
                          prompt: "Task result",
                          response: output,
                          state: status.state,
                          startedAt: run.startedAt || 0,
                        },
                      ],
                    });
                });
          })
          .catch((error) => {
            if (current) report(error);
          });
        void refreshProposal().catch((error) => {
          if (current) report(error);
        });
      });
      source.onerror = () => {
        if (!current || terminal) return;
        setStreamState("Reconnecting");
        if (Date.now() - authCheckedAt > runnerConfig.authRecheckMs) {
          authCheckedAt = Date.now();
          void request("/session").catch((error) => {
            if (current) report(error);
          });
        }
      };
    };
    void begin().catch((error) => {
      if (current) {
        setLoadingTask(false);
        setLoadingDiff(false);
        report(error);
      }
    });
    const hide = () => {
      source?.close();
      controller.abort();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) setRevision((value) => value + 1);
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      current = false;
      hide();
      clearTimeout(timer);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
    // Run metadata is updated by the stream. Only a deliberate view/turn change opens another observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, selectedId, revision, report, request, updateRun]);
  const login = async (token: string) => {
    const response = await fetch("/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(runnerConfig.loginTimeoutMs),
    });
    if (!response.ok)
      throw Error(
        "Could not sign in. Use RUNNER_API_TOKEN, not the Qwen API key.",
      );
    setAuthOpen(false);
    setConnected(true);
    setNotice("");
  };
  const logout = async () => {
    await request("/session", undefined, "DELETE");
    clearSession();
    setNotice("Signed out. Your cloud agent continues working.");
  };
  const start = async (
    agent: Agent,
    prompt: string,
    repo: Repository | null,
    ref: string,
    example = false,
    onPreparing?: () => void,
  ) => {
    if (!connected) {
      setAuthOpen(true);
      throw Error("Sign in to your workspace to get started.");
    }
    if (startLock.current || busy || runs.some((run) => isActive(run.state)))
      throw Error("A task is already running. Open it to continue working.");
    if (!repo && !example) throw Error("Choose a GitHub repository.");
    const run: Run = {
      id: `${agent}-${crypto.randomUUID()}`,
      agent,
      private: repo?.private || false,
      repository: repo?.url || workspaceConfig.exampleRepository.url,
      ref,
      state: "cloning",
      startedAt: Date.now(),
    };
    const epoch = authEpoch.current;
    const preparation: Startup = {
      task: run.id,
      agent,
      prompt,
      stage: "cloning",
      startedAt: Date.now(),
    };
    startLock.current = true;
    setBusy(true);
    setStartup(preparation);
    setConversation(null);
    setLiveText(null);
    setDiff("");
    setProposal(null);
    setRuns((items) => [run, ...items].slice(0, runnerConfig.historyLimit));
    setSelectedId(run.id);
    setNotice("");
    try {
      await prepareSession(
        run.id,
        {
          ...(repo
            ? {
                installationId: repo.installationId,
                repositoryId: repo.repositoryId,
              }
            : { url: run.repository }),
          ...(ref ? { ref } : {}),
        },
        { agent, prompt },
        request,
        () => onPreparing?.(),
        () => {
          if (epoch !== authEpoch.current)
            throw new DOMException("Session changed", "AbortError");
          setStartup({ ...preparation, stage: "starting" });
        },
      );
      if (epoch !== authEpoch.current)
        throw new DOMException("Session changed", "AbortError");
      setStartup(null);
      updateRun(run.id, { state: "running" });
      setRevision((value) => value + 1);
    } catch (error) {
      if (epoch === authEpoch.current) {
        updateRun(run.id, { state: "failed", finishedAt: Date.now() });
        setStartup({ ...preparation, stage: "failed", error: message(error) });
        report(error);
      }
      throw error;
    } finally {
      startLock.current = false;
      setBusy(false);
    }
  };
  const send = async (prompt: string) => {
    if (
      !selected ||
      !conversation?.canContinue ||
      isActive(selected.state) ||
      sending
    )
      throw Error(
        "Wait for the agent to finish before sending another message.",
      );
    const run = selected;
    // Keep the same message ID when retrying an ambiguous HTTP failure.
    if (
      !pendingMessage.current ||
      pendingMessage.current.task !== run.id ||
      pendingMessage.current.prompt !== prompt
    )
      pendingMessage.current = {
        task: run.id,
        id: crypto.randomUUID(),
        prompt,
      };
    setSending(true);
    try {
      await request(`/sandboxes/${run.id}/messages`, {
        id: pendingMessage.current.id,
        prompt,
      });
      pendingMessage.current = null;
      updateRun(run.id, { state: "running", finishedAt: undefined });
      channel.current?.postMessage({ task: run.id });
      if (selectedRef.current === run.id) setRevision((value) => value + 1);
    } finally {
      setSending(false);
    }
  };
  const stop = async () => {
    if (!selected || stopping) return;
    const id = selected.id;
    setStopping(true);
    updateRun(id, { state: "stopping" });
    try {
      const result: TaskStatus = await (
        await request(`/sandboxes/${id}/task`, undefined, "DELETE")
      ).json();
      updateRun(id, { state: result.state, finishedAt: Date.now() });
      channel.current?.postMessage({ task: id });
    } catch (error) {
      report(error);
    } finally {
      setStopping(false);
      if (selectedRef.current === id) setRevision((value) => value + 1);
    }
  };
  const publish = async (title: string, description: string) => {
    if (!selected) return;
    const id = selected.id;
    await request(`/sandboxes/${id}/pull-request`, { title, description });
    const info: Proposal = await (
      await request(`/sandboxes/${id}/pull-request`)
    ).json();
    if (selectedRef.current === id) setProposal(info);
  };
  return {
    request,
    refresh: () => setRevision((value) => value + 1),
    runs,
    selected,
    connected,
    checking,
    authOpen,
    setAuthOpen,
    notice,
    startup,
    setNotice,
    busy,
    sending,
    stopping,
    conversation,
    liveText,
    diff,
    proposal,
    streamState,
    loadingTask,
    loadingDiff,
    activityRef,
    activityCount,
    followRef,
    github,
    repositories,
    repository,
    catalogBusy,
    repositoryTotal,
    hasMore,
    chooseRepository,
    connectGitHub,
    disconnectGitHub,
    loadMore: () => loadRepositories(true, repositoryPage + 1),
    activate,
    login,
    logout,
    start,
    send,
    stop,
    publish,
    report,
    hasActiveRun: runs.some((run) => isActive(run.state)),
  };
}
export type Runner = ReturnType<typeof useRunner>;
