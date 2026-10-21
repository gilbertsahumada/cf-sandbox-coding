import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  CloudCheck,
  Code2,
  FileDiff,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Plus,
  Search,
  RefreshCw,
  Square,
  Trash2,
  CircleAlert,
  Settings2,
  X,
} from "lucide-react";
import type { Runner } from "@/hooks/use-runner";
import type { ChangedFile } from "@/lib/editor";
import { fileStatusNames, githubPullRequestURL } from "@/lib/editor";
import {
  matchesSession,
  relativeTime,
  repositoryLabel,
  sessionTitle,
} from "@/lib/session-presentation";
import { sessionIsRunning } from "@/lib/session-monitor";
import type { Run } from "@/lib/types";
import { Spinner } from "./ui/spinner";
import { agentNames, isActive, stateNames } from "@/lib/types";
import { AgentLogo } from "./agent-logo";
import { FileIcon, TaskStateIcon } from "./workspace-indicators";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";

export type SessionView = "session" | "history" | "new" | "review";
type SessionProps = { runner: Runner; titles: Record<string, string> };

function runtimeLabel(runner: Runner, run: Run) {
  if (runner.startingIds.has(run.id)) return "Starting session…";
  if (runner.stoppingIds.has(run.id)) return "Stopping session…";
  if (run.state === "cloning") return "Preparing session…";
  const snapshot = runner.sessions.snapshots[run.id];
  if (snapshot?.containerRunning === true)
    return isActive(run.state) ? "Session running" : "Idle · session running";
  if (snapshot?.containerRunning === false) return "Session stopped";
  return runner.sessions.checking.has(run.id)
    ? "Checking session…"
    : "Session status unavailable";
}
function StopSessionButton({ runner, run }: { runner: Runner; run: Run }) {
  const stopping = runner.stoppingIds.has(run.id);
  if (
    run.state === "cloning" ||
    (!stopping && !sessionIsRunning(run, runner.sessions.snapshots[run.id]))
  )
    return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="destructive-ghost"
          size="icon-xs"
          className="overview-stop"
          aria-label={`Stop session ${run.id}`}
          disabled={
            !runner.connected ||
            runner.checking ||
            stopping ||
            runner.deletingIds.has(run.id) ||
            runner.sendingIds.has(run.id)
          }
          onClick={() => void runner.stopSession(run.id)}
        >
          {stopping ? <Spinner aria-hidden="true" /> : <Square />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {stopping ? "Stopping session…" : "Stop session"}
      </TooltipContent>
    </Tooltip>
  );
}
function SessionRowActions({
  runner,
  run,
  title,
}: {
  runner: Runner;
  run: Run;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const deleting = runner.deletingIds.has(run.id);
  const busy =
    deleting ||
    run.state === "cloning" ||
    runner.stoppingIds.has(run.id) ||
    runner.startingIds.has(run.id) ||
    runner.sendingIds.has(run.id);
  async function remove() {
    setError("");
    try {
      await runner.deleteSession(run.id);
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not delete the session.",
      );
    }
  }
  return (
    <div className="session-row-actions">
      <StopSessionButton runner={runner} run={run} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete session ${run.id}`}
            disabled={!runner.connected || runner.checking || busy}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            {deleting ? <Spinner aria-hidden="true" /> : <Trash2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete session</TooltipContent>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!deleting) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete permanently stops the workspace and removes its conversation,
            files, logs, and saved changes from the cloud. This cannot be
            undone. Published GitHub PRs are kept.
          </p>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sessionSection(runner: Runner, run: Run) {
  if (sessionIsRunning(run, runner.sessions.snapshots[run.id]))
    return "Running sessions";
  return run.state === "succeeded" ? "Awaiting reply" : "Previous sessions";
}

export function SessionNavigation({
  runner,
  titles,
  view,
  onSelect,
  newSession,
  history,
  settings,
  close,
}: SessionProps & {
  view: SessionView;
  onSelect: (id: string) => void;
  newSession: () => void;
  history: () => void;
  settings: () => void;
  close: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const matches = runner.runs.filter(
    (run) =>
      matchesSession(run, titles, search) &&
      (filter !== "active" ||
        sessionIsRunning(run, runner.sessions.snapshots[run.id])),
  );
  return (
    <aside className="session-navigation" aria-label="Sessions">
      <div className="navigation-heading">
        <h2>Overview</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh session statuses"
          onClick={() => void runner.sessions.refresh()}
          disabled={!runner.connected || runner.sessions.checking.size > 0}
        >
          {runner.sessions.checking.size > 0 ? (
            <Spinner aria-hidden="true" />
          ) : (
            <RefreshCw />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide sessions"
          onClick={close}
        >
          <X />
        </Button>
      </div>
      <div className="navigation-actions">
        <Button
          variant="outline"
          onClick={newSession}
          aria-current={view === "new" ? "page" : undefined}
        >
          <Plus data-icon="inline-start" />
          New chat
        </Button>
        <InputGroup>
          <InputGroupInput
            aria-label="Search sessions"
            placeholder="Find a session…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => value && setFilter(value)}
          variant="outline"
          spacing={0}
          aria-label="Session filter"
        >
          <ToggleGroupItem value="active">
            Running{" "}
            <Badge variant="secondary">
              {
                runner.runs.filter((run) =>
                  sessionIsRunning(run, runner.sessions.snapshots[run.id]),
                ).length
              }
            </Badge>
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            All <Badge variant="secondary">{runner.runs.length}</Badge>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <nav className="navigation-list" aria-label="Known sessions">
        {["Running sessions", "Awaiting reply", "Previous sessions"].map(
          (group) => {
            const entries = matches.filter(
              (run) => sessionSection(runner, run) === group,
            );
            return entries.length ? (
              <section key={group}>
                <h3>
                  {group}
                  <span>{entries.length}</span>
                </h3>
                {entries.map((run) => (
                  <div key={run.id} className="navigation-session-row">
                    <Button
                      variant={
                        runner.selected?.id === run.id && view !== "new"
                          ? "secondary"
                          : "ghost"
                      }
                      className="navigation-entry"
                      onClick={() => onSelect(run.id)}
                      aria-current={
                        runner.selected?.id === run.id && view !== "new"
                          ? "page"
                          : undefined
                      }
                      title={sessionTitle(run, titles)}
                    >
                      <TaskStateIcon
                        state={run.state}
                        data-icon="inline-start"
                      />
                      <span>
                        <strong className="truncate">
                          {sessionTitle(run, titles)}
                        </strong>
                        <small>
                          <AgentLogo agent={run.agent} />
                          {agentNames[run.agent]}
                          <span>·</span>
                          <span className="truncate">
                            {stateNames[run.state]}
                          </span>
                        </small>
                        <small
                          className="truncate"
                          title={runtimeLabel(runner, run)}
                        >
                          {runtimeLabel(runner, run)}
                        </small>
                      </span>
                    </Button>
                    <SessionRowActions
                      runner={runner}
                      run={run}
                      title={sessionTitle(run, titles)}
                    />
                  </div>
                ))}
              </section>
            ) : null;
          },
        )}
        {!matches.length ? (
          <p className="sidebar-empty">
            {search
              ? "No matching sessions."
              : filter === "active"
                ? "No running sessions."
                : "Your sessions will appear here."}
          </p>
        ) : null}
      </nav>
      <div className="navigation-footer">
        <Button variant="ghost" onClick={history}>
          View session history
          <ChevronRight data-icon="inline-end" />
        </Button>
        <Button variant="ghost" onClick={settings}>
          <Settings2 data-icon="inline-start" />
          <span className="truncate">
            {runner.demo
              ? "Demo access"
              : runner.github?.connected
                ? runner.github.accounts.join(", ")
                : "Connect GitHub"}
          </span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="cloud-provider" type="button">
              <img
                src="/assets/providers/cloudflare.png"
                width={22}
                height={12}
                alt=""
              />
              Cloudflare Sandbox
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Each session runs in an isolated Cloudflare Sandbox.
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}

export function SessionHistory({
  runner,
  titles,
  onSelect,
  openSession,
  newSession,
}: SessionProps & {
  onSelect: (id: string) => void;
  openSession: () => void;
  newSession: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const matches = runner.runs.filter(
    (run) =>
      matchesSession(run, titles, query) &&
      (filter === "all" ||
        (filter === "active"
          ? sessionIsRunning(run, runner.sessions.snapshots[run.id])
          : !sessionIsRunning(run, runner.sessions.snapshots[run.id]))),
  );
  return (
    <div className="session-history">
      <div className="history-intro">
        <p>
          Sessions known to this browser. Runtime status refreshes automatically
          while this page is visible.
        </p>
        <Button variant="outline" size="sm" onClick={newSession}>
          <Plus data-icon="inline-start" />
          New chat
        </Button>
      </div>
      <div className="history-filters">
        <InputGroup>
          <InputGroupInput
            aria-label="Search session history"
            placeholder="Search previous sessions…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => value && setFilter(value)}
          variant="outline"
          spacing={0}
          aria-label="History filter"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="active">Running</ToggleGroupItem>
          <ToggleGroupItem value="saved">Previous</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="history-column-labels" aria-hidden="true">
        <span>Session / repository</span>
        <span>Agent</span>
        <span>Agent / cloud session</span>
        <span>Started</span>
      </div>
      <nav aria-label="Session history">
        {matches.map((run) => (
          <div key={run.id} className="history-session-row">
            <Button
              variant={runner.selected?.id === run.id ? "secondary" : "ghost"}
              className="history-row"
              aria-current={runner.selected?.id === run.id ? "page" : undefined}
              onClick={() => onSelect(run.id)}
              onDoubleClick={openSession}
            >
              <span className="history-title">
                <strong className="truncate">
                  {sessionTitle(run, titles)}
                </strong>
                <small className="truncate">
                  {repositoryLabel(run.repository)}
                </small>
              </span>
              <span className="history-agent">
                <AgentLogo agent={run.agent} />
                {agentNames[run.agent]}
              </span>
              <span className="history-state">
                <TaskStateIcon state={run.state} />
                <span>
                  {stateNames[run.state]}
                  <small>{runtimeLabel(runner, run)}</small>
                </span>
              </span>
              <time>{relativeTime(run.startedAt)}</time>
            </Button>
            <SessionRowActions
              runner={runner}
              run={run}
              title={sessionTitle(run, titles)}
            />
          </div>
        ))}
      </nav>
      {matches.length ? (
        <div className="history-bottom">
          <span>
            Recent sessions plus running or unverified sessions are kept in this
            browser. Open a session to check workspace recovery.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={openSession}
            disabled={!runner.selected}
          >
            <MessageSquare data-icon="inline-start" />
            Open selected session
          </Button>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No sessions found</EmptyTitle>
            <EmptyDescription>
              Start a session or change your search.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

export function SessionDetails({
  runner,
  files,
  title,
  hidden,
  openFile,
  review,
  browse,
  publish,
  conversation,
  close,
}: {
  runner: Runner;
  files: ChangedFile[];
  title: string;
  hidden: boolean;
  openFile: (path: string) => void;
  review: () => void;
  browse: () => void;
  publish: () => void;
  conversation: () => void;
  close: () => void;
}) {
  const run = runner.selected;
  const prURL = runner.proposal?.pr
    ? githubPullRequestURL(runner.proposal.pr.url)
    : null;
  const chat = runner.conversation;
  return (
    <aside
      className="session-details"
      data-hidden={hidden}
      inert={hidden}
      aria-hidden={hidden}
      aria-label="Session details"
    >
      <div className="navigation-heading">
        <h2>Session details</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide details"
          onClick={close}
        >
          <X />
        </Button>
      </div>
      {run ? (
        <div className="details-scroll">
          <p className="details-title">{title}</p>
          <dl className="details-metadata">
            <div>
              <dt>Agent status</dt>
              <dd>
                <TaskStateIcon state={run.state} />
                {stateNames[run.state]}
              </dd>
            </div>
            <div>
              <dt>Cloud session</dt>
              <dd>
                {runner.startingSession
                  ? "Starting…"
                  : runner.runtime.checking
                    ? "Checking…"
                    : runner.runtime.running === true
                      ? "Running"
                      : runner.runtime.running === false
                        ? "Stopped"
                        : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>
                <AgentLogo agent={run.agent} />
                {agentNames[run.agent]}
              </dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd title={repositoryLabel(run.repository)}>
                {repositoryLabel(run.repository)}
              </dd>
            </div>
            <div>
              <dt>Source ref</dt>
              <dd>
                <GitBranch />
                {run.ref || "Default branch"}
              </dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{relativeTime(run.startedAt)}</dd>
            </div>
          </dl>
          <section className="details-changes">
            <h3>
              <FileDiff />
              Changed files<Badge variant="secondary">{files.length}</Badge>
            </h3>
            {runner.loadingDiff ? (
              <p>Loading changes…</p>
            ) : files.length ? (
              <nav aria-label="Session changes">
                {files.map((file) => (
                  <Button
                    key={file.path}
                    variant="ghost"
                    className="detail-file"
                    onClick={() => openFile(file.path)}
                    title={file.path}
                  >
                    <FileIcon path={file.path} data-icon="inline-start" />
                    <span
                      className={`file-status status-${file.status}`}
                      aria-label={fileStatusNames[file.status]}
                      title={fileStatusNames[file.status]}
                    >
                      {file.status}
                    </span>
                    <span className="truncate">{file.path}</span>
                    <small className="diff-added">+{file.added}</small>
                    <small className="diff-removed">−{file.removed}</small>
                  </Button>
                ))}
              </nav>
            ) : (
              <p>
                {runner.diffError
                  ? "Changes could not be loaded. Use Retry changes in the conversation."
                  : "No changes to review yet."}
              </p>
            )}
            <Button variant="outline" disabled={!runner.diff} onClick={review}>
              <FileDiff data-icon="inline-start" />
              Review changes
            </Button>
            <Button variant="ghost" onClick={browse}>
              <Code2 data-icon="inline-start" />
              Browse files
            </Button>
            {prURL ? (
              <Button variant="outline" asChild>
                <a href={prURL} target="_blank" rel="noopener noreferrer">
                  <GitPullRequest data-icon="inline-start" />
                  PR #{runner.proposal?.pr?.number}
                  <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="outline"
                      disabled={
                        !runner.proposal?.available ||
                        runner.loadingDiff ||
                        runner.proposalLoading ||
                        Boolean(runner.changesError)
                      }
                      onClick={publish}
                    >
                      <GitPullRequest data-icon="inline-start" />
                      Create PR
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {runner.proposal?.reason ||
                    "Publish reviewed changes as a draft PR"}
                </TooltipContent>
              </Tooltip>
            )}
          </section>
          <section className="details-recovery">
            <h3>
              <CloudCheck />
              Session context
            </h3>
            <p>
              {runner.loadingTask
                ? "Checking recovery…"
                : chat?.checkpointSaved
                  ? "Workspace and agent context saved."
                  : isActive(run.state)
                    ? "Working in the cloud. Changes from this turn may not be checkpointed yet."
                    : chat?.reason ||
                      "Workspace recovery has not been confirmed."}
            </p>
            {chat?.warning ? <p>{chat.warning}</p> : null}
            {chat?.canContinue ? (
              <Button variant="ghost" onClick={conversation}>
                <MessageSquare data-icon="inline-start" />
                Continue conversation
              </Button>
            ) : null}
            <code className="session-id">{run.id}</code>
          </section>
        </div>
      ) : (
        <p className="sidebar-empty">Choose a session to see its details.</p>
      )}
    </aside>
  );
}
