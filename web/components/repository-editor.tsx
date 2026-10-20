import { startupText } from "@/lib/session-start";
import { lazy, Suspense, useState } from "react";
import {
  Save,
  X,
  RefreshCw,
  FileCode2,
  CircleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { FileIcon } from "./workspace-indicators";
import { isActive } from "@/lib/types";
import type { Runner } from "@/hooks/use-runner";
import type { Workspace } from "@/hooks/use-workspace";
const CodeEditor = lazy(() => import("./code-editor"));
export function RepositoryEditor({
  workspace,
  runner,
}: {
  workspace: Workspace;
  runner: Runner;
}) {
  const doc = workspace.selected,
    [discard, setDiscard] = useState<{ path: string; reload: boolean } | null>(
      null,
    ),
    [cursor, setCursor] = useState("Ln 1, Col 1");
  function close(path: string) {
    const file = workspace.documents.find((item) => item.path === path);
    if (file && file.content !== file.original)
      setDiscard({ path, reload: false });
    else workspace.close(path);
  }
  function reload() {
    if (!doc) return;
    if (doc.content !== doc.original)
      setDiscard({ path: doc.path, reload: true });
    else void workspace.open(doc.path, true);
  }
  const startup = runner.startup?.task === runner.selected?.id ? runner.startup : null;
  const blocked = Boolean(runner.selected && isActive(runner.selected.state));
  return (
    <Tabs value={doc?.path || ""} onValueChange={path=>void workspace.open(path)} className="repository-editor">
      <div className="source-tabs">
        <TabsList variant="line" aria-label="Open files">
          {workspace.documents.map((file) => (
            <div className="source-tab" key={file.path}>
              <TabsTrigger value={file.path} title={file.path}>
                <FileIcon path={file.path} data-icon="inline-start" />
                {file.path.split("/").at(-1)}
                {file.content !== file.original ? (
                  <span aria-label="Unsaved changes">•</span>
                ) : null}
              </TabsTrigger>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${file.path}`}
                disabled={file.saving}
                onClick={() => close(file.path)}
              >
                <X />
              </Button>
            </div>
          ))}
        </TabsList>
      </div>
      {doc ? (
        <TabsContent value={doc.path} className="source-document">
          <div className="source-toolbar">
            <span className="truncate">{doc.path}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={reload}
                disabled={doc.loading || doc.saving}
              >
                <RefreshCw data-icon="inline-start" />
                Reload
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={
                  blocked ||
                  doc.loading ||
                  doc.saving ||
                  !doc.version ||
                  (doc.content === doc.original && !doc.warning)
                }
                onClick={() => void workspace.save(doc.path)}
                aria-busy={doc.saving}
              >
                {doc.saving ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {doc.saving ? "Saving…" : doc.warning ? "Retry save" : "Save"}
              </Button>
            </div>
          </div>
          {doc.error ? (
            <Alert variant="destructive" className="file-notice">
              <CircleAlert />
              <AlertDescription>{doc.error}</AlertDescription>
            </Alert>
          ) : null}
          {doc.warning ? (
            <Alert className="file-notice">
              <CircleAlert />
              <AlertDescription>{doc.warning}</AlertDescription>
            </Alert>
          ) : null}
          {blocked ? (
            <p className="editor-hint">
              The agent is working. You can draft edits; save after it finishes
              or stops.
            </p>
          ) : doc.stale ? (
            <p className="editor-hint">
              The workspace may have changed. Reload to see the latest version;
              saving checks for conflicts.
            </p>
          ) : null}
          {doc.loading ? (
            <div className="editor-loading" role="status">
              <Spinner aria-hidden="true" />
              Opening {doc.path}…
            </div>
          ) : doc.version ? (
            <Suspense
              fallback={
                <div className="editor-loading">
                  <Spinner aria-hidden="true" />
                  Loading editor…
                </div>
              }
            >
              <CodeEditor
                key={`${doc.task}:${doc.path}`}
                path={doc.path}
                content={doc.content}
                onChange={(text) => workspace.change(doc.path, text)}
                onSave={() => {
                  if (!blocked) void workspace.save(doc.path);
                }}
                onCursor={setCursor}
              />
            </Suspense>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>File unavailable</EmptyTitle>
                <EmptyDescription>
                  Choose another file, or reload to retry.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="source-status">
            <span>
              {doc.saving
                ? "Saving to cloud…"
                : doc.content !== doc.original
                  ? "Unsaved changes"
                  : "Saved"}
              {blocked ? " · Agent running" : ""}
            </span>
            <span>{cursor} · UTF-8</span>
          </div>
        </TabsContent>
      ) : (
        <Empty className="editor-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {startup && startup.stage !== "failed" ? <Spinner /> : <FileCode2 />}
            </EmptyMedia>
            <EmptyTitle>{startup ? startup.stage === "failed" ? "Workspace unavailable" : "Preparing workspace" : "Open a file"}</EmptyTitle>
            <EmptyDescription>
              {startup ? startupText(startup) : "Browse the repository on the left. Your edits are saved to this cloud session."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <Dialog
        open={Boolean(discard)}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your draft for {discard?.path} has not been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscard(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (discard) {
                  if (discard.reload) void workspace.open(discard.path, true);
                  else workspace.close(discard.path);
                }
                setDiscard(null);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
