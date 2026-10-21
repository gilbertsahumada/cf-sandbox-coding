import { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  RefreshCw,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FileIcon } from "./workspace-indicators";
import type { Workspace } from "@/hooks/use-workspace";
function DirectoryRows({
  workspace,
  path,
  onOpen,
}: {
  workspace: Workspace;
  path: string;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const data = workspace.directoryAt(path);
  useEffect(() => {
    if (path && !data) void workspace.directory(path);
  }, [workspace.task, path, data, workspace.directory]);
  return (
    <div className={path ? "tree-branch" : "tree-root"} role="group">
      {data?.entries.map((entry) =>
        entry.kind === "directory" ? (
          <div key={entry.path}>
            <Button
              variant="ghost"
              className="tree-entry"
              aria-expanded={expanded.has(entry.path)}
              onClick={() => {
                const next = new Set(expanded);
                if (next.has(entry.path)) next.delete(entry.path);
                else next.add(entry.path);
                setExpanded(next);
              }}
            >
              {expanded.has(entry.path) ? (
                <ChevronDown data-icon="inline-start" />
              ) : (
                <ChevronRight data-icon="inline-start" />
              )}
              {expanded.has(entry.path) ? <FolderOpen /> : <Folder />}
              <span className="truncate">{entry.name}</span>
            </Button>
            {expanded.has(entry.path) ? (
              <DirectoryRows
                workspace={workspace}
                path={entry.path}
                onOpen={onOpen}
              />
            ) : null}
          </div>
        ) : (
          <Button
            key={entry.path}
            variant={
              workspace.mode === "code" &&
              workspace.selected?.path === entry.path
                ? "secondary"
                : "ghost"
            }
            className="tree-entry tree-file"
            disabled={entry.kind !== "file"}
            title={
              entry.kind === "file"
                ? entry.path
                : "Symbolic links and special files cannot be opened."
            }
            onClick={() => onOpen(entry.path)}
          >
            {entry.kind === "symlink" ? (
              <Link2 data-icon="inline-start" />
            ) : (
              <FileIcon path={entry.path} data-icon="inline-start" />
            )}
            <span className="truncate">{entry.name}</span>
            {workspace.documents.some(
              (doc) => doc.path === entry.path && doc.content !== doc.original,
            ) ? (
              <span aria-label="Unsaved changes">•</span>
            ) : null}
          </Button>
        ),
      )}
      {data?.loading ? (
        <div className="tree-note" role="status">
          <Spinner aria-hidden="true" />
          Loading files…
        </div>
      ) : data?.error ? (
        <div className="tree-note">
          <span>{data.error}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void workspace.directory(path)}
          >
            Retry
          </Button>
        </div>
      ) : data && !data.entries.length ? (
        <div className="tree-note">Empty folder</div>
      ) : null}
      {data?.nextCursor !== null && data?.nextCursor !== undefined ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={data.loading}
          onClick={() => void workspace.directory(path, true)}
        >
          Load more files
        </Button>
      ) : null}
    </div>
  );
}
export function FileExplorer({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="repository-explorer" aria-label="Repository files">
      <div className="section-heading">
        <ChevronDown className="size-3.5" />
        <h3>Files</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh files"
          disabled={
            workspace.preparing ||
            Boolean(workspace.preparationError) ||
            workspace.directoryAt("")?.loading
          }
          onClick={workspace.refreshTree}
        >
          <RefreshCw />
        </Button>
      </div>
      <div className="repository-tree">
        {workspace.preparing ? (
          <p className="tree-note" role="status">
            <Spinner aria-hidden="true" /> Preparing repository files…
          </p>
        ) : workspace.preparationError ? (
          <p className="tree-note">{workspace.preparationError}</p>
        ) : workspace.task ? (
          <DirectoryRows
            key={workspace.task}
            workspace={workspace}
            path=""
            onOpen={onOpen}
          />
        ) : (
          <p className="sidebar-empty">Open a session to browse its files.</p>
        )}
      </div>
    </section>
  );
}
