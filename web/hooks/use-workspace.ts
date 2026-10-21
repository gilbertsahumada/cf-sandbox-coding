import { workspaceConfig } from "@/lib/config";
import type {
  DirectoryListing,
  RepositoryEntry,
  RepositoryFile,
  SavedRepositoryFile,
} from "@/lib/api-types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Runner } from "./use-runner";
export type Entry = RepositoryEntry;
export type Directory = {
  entries: Entry[];
  nextCursor: number | null;
  loading: boolean;
  error?: string;
};
export type OpenDocument = {
  task: string;
  path: string;
  content: string;
  original: string;
  version: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  warning?: string;
  stale?: boolean;
};
const keyOf = (task: string, path: string) => `${task}:${path}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Could not access the workspace.";
export function useWorkspace(runner: Runner) {
  const task = runner.selected?.id || "";
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [active, setActive] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"code" | "changes">("code");
  const documentsRef = useRef(documents),
    connectedRef = useRef(runner.connected),
    generation = useRef(0),
    refreshing = useRef(runner.refresh);
  documentsRef.current = documents;
  connectedRef.current = runner.connected;
  refreshing.current = runner.refresh;
  const directoryEpoch = useRef(0);
  const client = runner.request,
    queue = useRef<Promise<unknown>>(Promise.resolve());
  // Serialize file operations; generation checks prevent queued work crossing sessions.
  const api = useCallback(
    (...args: Parameters<typeof client>) => {
      const ticket = generation.current;
      const pending = queue.current
        .catch(() => {})
        .then(() => {
          if (ticket !== generation.current || !connectedRef.current)
            throw new DOMException("View changed", "AbortError");
          return client(...args);
        });
      queue.current = pending;
      return pending;
    },
    [client],
  );
  const directoryRef = useRef(directories);
  directoryRef.current = directories;
  useEffect(() => {
    generation.current++;
    setDirectories({});
    setDocuments((previous) =>
      previous.map((doc) => ({
        ...doc,
        loading: false,
        saving: false,
        ...(doc.loading
          ? { error: "Loading was interrupted. Reopen this file to retry." }
          : {}),
        stale: true,
      })),
    );
    // Drafts survive task navigation in memory, but signing out removes source contents.
    if (!runner.connected) {
      setDocuments([]);
      setActive({});
    }
  }, [task, runner.connected]);
  const directory = useCallback(
    async (path = "", more = false) => {
      if (!task || !runner.connected) return;
      const ticket = generation.current,
        epoch = directoryEpoch.current,
        key = keyOf(task, path);
      let cursor = 0;
      if (directoryRef.current[key]?.loading) return;
      if (more) cursor = directoryRef.current[key]?.nextCursor || 0;
      setDirectories((previous) => ({
        ...previous,
        [key]: {
          entries: previous[key]?.entries || [],
          nextCursor: previous[key]?.nextCursor || null,
          loading: true,
        },
      }));
      try {
        const data: DirectoryListing = await (
          await api(
            `/sandboxes/${task}/files?${new URLSearchParams({ path, cursor: String(cursor) })}`,
          )
        ).json();
        if (ticket !== generation.current || epoch !== directoryEpoch.current)
          return;
        if (!Array.isArray(data.entries))
          throw new Error("Repository files are not available yet.");
        setDirectories((previous) => ({
          ...previous,
          [key]: {
            entries: more
              ? [...(previous[key]?.entries || []), ...data.entries]
              : data.entries,
            nextCursor: data.nextCursor,
            loading: false,
          },
        }));
      } catch (error) {
        if (ticket === generation.current && epoch === directoryEpoch.current)
          setDirectories((previous) => ({
            ...previous,
            [key]: {
              entries: previous[key]?.entries || [],
              nextCursor: null,
              loading: false,
              error: errorText(error),
            },
          }));
      }
    },
    [api, task, runner.connected],
  );
  const refreshTree = useCallback(() => {
    directoryEpoch.current++;
    directoryRef.current = {};
    setDirectories({});
    if (
      task &&
      runner.connected &&
      runner.selected?.state !== "cloning" &&
      !(runner.startup?.task === task && runner.startup.stage === "failed")
    )
      void directory("");
  }, [
    directory,
    task,
    runner.connected,
    runner.selected?.state,
    runner.startup?.task,
    runner.startup?.stage,
  ]);
  useEffect(() => {
    refreshTree();
  }, [refreshTree, runner.selected?.state]);
  const update = useCallback(
    (id: string, path: string, change: Partial<OpenDocument>) =>
      setDocuments((previous) =>
        previous.map((doc) =>
          doc.task === id && doc.path === path ? { ...doc, ...change } : doc,
        ),
      ),
    [],
  );
  const open = useCallback(
    async (path: string, reload = false) => {
      if (!task || !runner.connected) return;
      setMode("code");
      setActive((previous) => ({ ...previous, [task]: path }));
      const cached = documentsRef.current.find(
        (doc) => doc.task === task && doc.path === path,
      );
      if (
        cached &&
        !reload &&
        (!cached.error || cached.content !== cached.original)
      )
        return;
      if (
        !cached &&
        documentsRef.current.length >= workspaceConfig.maxOpenDocuments
      ) {
        runner.report(
          new Error(
            `Close an open file before opening another one (${workspaceConfig.maxOpenDocuments}-file limit).`,
          ),
        );
        return;
      }
      const ticket = generation.current;
      if (cached) update(task, path, { loading: true, error: undefined });
      else
        setDocuments((previous) => [
          ...previous,
          {
            task,
            path,
            content: "",
            original: "",
            version: "",
            loading: true,
            saving: false,
          },
        ]);
      try {
        const data: RepositoryFile = await (
          await api(`/sandboxes/${task}/file?${new URLSearchParams({ path })}`)
        ).json();
        if (ticket !== generation.current) return;
        update(task, path, {
          ...data,
          original: data.content,
          loading: false,
          error: undefined,
          warning: undefined,
          stale: false,
        });
      } catch (error) {
        if (ticket === generation.current)
          update(task, path, { loading: false, error: errorText(error) });
      }
    },
    [api, task, runner.connected, update],
  );
  const save = useCallback(
    async (path: string) => {
      const doc = documentsRef.current.find(
        (item) => item.task === task && item.path === path,
      );
      if (!doc || doc.loading || doc.saving || !doc.version) return;
      const ticket = generation.current,
        submitted = doc.content;
      update(task, path, { saving: true, error: undefined });
      try {
        const data: SavedRepositoryFile = await (
          await api(
            `/sandboxes/${task}/file`,
            { path, content: submitted, version: doc.version },
            "PUT",
          )
        ).json();
        if (ticket !== generation.current) return;
        update(task, path, {
          version: data.version,
          original: submitted,
          saving: false,
          error: undefined,
          warning: data.warning,
          stale: false,
        });
        refreshing.current();
      } catch (error) {
        if (ticket === generation.current)
          update(task, path, {
            saving: false,
            error: errorText(error),
            stale: true,
          });
      }
    },
    [api, task, update],
  );
  const previousState = useRef<string | null>(null);
  useEffect(() => {
    const marker = `${task}:${runner.selected?.state}`;
    if (previousState.current === marker) return;
    previousState.current = marker;
    setDocuments((previous) =>
      previous.map((doc) =>
        doc.task === task ? { ...doc, stale: true } : doc,
      ),
    );
  }, [task, runner.selected?.state]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (documentsRef.current.some((doc) => doc.content !== doc.original)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const close = (path: string) => {
    setDocuments((previous) =>
      previous.filter((doc) => doc.task !== task || doc.path !== path),
    );
    if (active[task] === path)
      setActive((previous) => ({
        ...previous,
        [task]:
          documentsRef.current.find(
            (doc) => doc.task === task && doc.path !== path,
          )?.path || "",
      }));
  };
  const visible = documents.filter((doc) => doc.task === task),
    selected = visible.find((doc) => doc.path === active[task]) || visible[0];
  return {
    task,
    preparing: runner.selected?.state === "cloning",
    preparationError:
      runner.startup?.task === task && runner.startup.stage === "failed"
        ? runner.startup.error || "Session preparation failed."
        : null,
    directories,
    directory,
    refreshTree,
    documents: visible,
    selected,
    mode,
    setMode,
    open,
    save,
    close,
    change: (path: string, content: string) => update(task, path, { content }),
    hasDirty: visible.some((doc) => doc.content !== doc.original),
    hasSaving: visible.some((doc) => doc.saving),
    directoryAt: (path: string) => directories[keyOf(task, path)],
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
