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
  Settings2,
  X,
} from "lucide-react";
import type { Runner } from "@/hooks/use-runner";
import type { ChangedFile } from "@/lib/editor";
import { githubPullRequestURL } from "@/lib/editor";
import {
  matchesSession,
  relativeTime,
  repositoryLabel,
  sessionGroup,
  sessionTitle,
} from "@/lib/session-presentation";
import { agentNames, isActive, stateNames } from "@/lib/types";
import { AgentLogo } from "./agent-logo";
import { FileIcon, TaskStateIcon } from "./workspace-indicators";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type SessionView = "session" | "history" | "new" | "review" | "tools";
type SessionProps = { runner: Runner; titles: Record<string, string> };

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
      (filter !== "active" || isActive(run.state)),
  );
  return (
    <aside className="session-navigation" aria-label="Sessions">
      <div className="navigation-heading">
        <h2>Overview</h2>
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
          New session
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
            Active{" "}
            <Badge variant="secondary">
              {runner.runs.filter((run) => isActive(run.state)).length}
            </Badge>
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            All <Badge variant="secondary">{runner.runs.length}</Badge>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <nav className="navigation-list" aria-label="Known sessions">
        {["Working", "Awaiting reply", "Previous sessions"].map((group) => {
          const entries = matches.filter((run) => sessionGroup(run) === group);
          return entries.length ? (
            <section key={group}>
              <h3>
                {group}
                <span>{entries.length}</span>
              </h3>
              {entries.map((run) => (
                <Button
                  key={run.id}
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
                  <TaskStateIcon state={run.state} data-icon="inline-start" />
                  <span>
                    <strong className="truncate">
                      {sessionTitle(run, titles)}
                    </strong>
                    <small>
                      <AgentLogo agent={run.agent} />
                      {agentNames[run.agent]}
                      <span>·</span>
                      <span className="truncate">{stateNames[run.state]}</span>
                    </small>
                  </span>
                </Button>
              ))}
            </section>
          ) : null;
        })}
        {!matches.length ? (
          <p className="sidebar-empty">
            {search
              ? "No matching sessions."
              : filter === "active"
                ? "No active sessions."
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
            {runner.github?.connected
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
        (filter === "active" ? isActive(run.state) : !isActive(run.state))),
  );
  return (
    <div className="session-history">
      <div className="history-intro">
        <p>
          Recent sessions known to this browser. Open one to refresh its status
          and check recovery.
        </p>
        <Button variant="outline" size="sm" onClick={newSession}>
          <Plus data-icon="inline-start" />
          New session
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
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="saved">Previous</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="history-column-labels" aria-hidden="true">
        <span>Session / repository</span>
        <span>Agent</span>
        <span>Last known status</span>
        <span>Started</span>
      </div>
      <nav aria-label="Session history">
        {matches.map((run) => (
          <Button
            key={run.id}
            variant={runner.selected?.id === run.id ? "secondary" : "ghost"}
            className="history-row"
            aria-current={runner.selected?.id === run.id ? "page" : undefined}
            onClick={() => onSelect(run.id)}
            onDoubleClick={openSession}
          >
            <span className="history-title">
              <strong className="truncate">{sessionTitle(run, titles)}</strong>
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
              {stateNames[run.state]}
            </span>
            <time>{relativeTime(run.startedAt)}</time>
          </Button>
        ))}
      </nav>
      {matches.length ? (
        <div className="history-bottom">
          <span>
            Up to 12 recent sessions. Saved results and workspace recovery are
            checked individually.
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
      hidden={hidden}
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
              <dt>Status</dt>
              <dd>
                <TaskStateIcon state={run.state} />
                {stateNames[run.state]}
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
                    <span className="truncate">{file.path}</span>
                    <small className="diff-added">+{file.added}</small>
                    <small className="diff-removed">−{file.removed}</small>
                  </Button>
                ))}
              </nav>
            ) : (
              <p>No changes to review yet.</p>
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
                      disabled={!runner.proposal?.available}
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
