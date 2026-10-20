import {
  memo,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudCheck,
  Eye,
  FolderGit2,
  LogIn,
  LogOut,
  UserRound,
  Cpu,
  Radio,
  ChevronsDown,
  Pause,
  Check,
  Code2,
  Download,
  FileDiff,
  Files,
  GitBranch,
  GitPullRequest,
  GitFork as Github,
  MessageSquare,
  PanelBottom,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupButton,
  InputGroupText,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  FileIcon,
  TaskStateIcon,
  TaskBadge,
} from "@/components/workspace-indicators";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AuthDialog,
  NewSessionDialog,
  PublishDialog,
  SettingsDialog,
} from "@/components/session-dialogs";
import {
  useWorkspace,
  type Workspace as RepositoryWorkspace,
} from "@/hooks/use-workspace";
import { AgentLogo } from "@/components/agent-logo";
import { FileExplorer } from "@/components/file-explorer";
import { RepositoryEditor } from "@/components/repository-editor";
import { useRunner, type Runner } from "@/hooks/use-runner";
import { cn } from "@/lib/utils";
import {
  githubPullRequestURL,
  parseDiff,
  type ChangedFile,
} from "@/lib/editor";
import { agentNames, isActive, stateNames } from "@/lib/types";
const MarkdownResponse = lazy(() =>
  import("@/components/markdown-response").then(module => ({ default: module.MarkdownResponse })),
);
function AgentResponse({ text }: { text: string }) {
  return <Suspense fallback={<p className="editor-hint">Loading response…</p>}>
    <MarkdownResponse text={text} />
  </Suspense>;
}
function IconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={pressed ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function SessionSidebar({
  runner,
  files,
  activePath,
  openFile,
  newSession,
  settings,
  close,
  workspace,
  openSource,
}: {
  workspace: RepositoryWorkspace;
  openSource: (path: string) => void;
  runner: Runner;
  files: ChangedFile[];
  activePath: string | null;
  openFile: (path: string) => void;
  newSession: () => void;
  settings: () => void;
  close: () => void;
}) {
  const [search, setSearch] = useState("");
  const matches = runner.runs.filter((run) =>
    `${run.repository} ${agentNames[run.agent]} ${run.id}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <aside className="session-sidebar" aria-label="Sessions and files">
      <div className="panel-heading">
        <h2>
          <FolderGit2 className="size-3.5" aria-hidden="true" />
          Explorer
        </h2>
        <IconButton
          icon={PanelLeftClose}
          label="Hide sessions"
          onClick={close}
        />
      </div>
      <div className="sidebar-actions">
        <Button variant="outline" className="w-full" onClick={newSession}>
          <Plus data-icon="inline-start" />
          New session
        </Button>
      </div>
      <FileExplorer workspace={workspace} onOpen={openSource} />
      <Collapsible className="recent-sessions">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="section-toggle">
            <ChevronRight data-icon="inline-start" />
            Sessions<Badge variant="secondary">{runner.runs.length}</Badge>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {" "}
          <InputGroup>
            <InputGroupInput
              aria-label="Search sessions"
              placeholder="Search sessions…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>{" "}
          <div className="session-list">
            <nav aria-label="Recent sessions">
              {matches.map((run) => (
                <Button
                  key={run.id}
                  variant={
                    runner.selected?.id === run.id ? "secondary" : "ghost"
                  }
                  className="session-entry"
                  onClick={() => runner.activate(run.id)}
                  aria-current={
                    runner.selected?.id === run.id ? "page" : undefined
                  }
                >
                  <TaskStateIcon state={run.state} data-icon="inline-start" />
                  <span className="session-entry-copy">
                    <strong className="truncate">
                      {run.repository
                        .replace("https://github.com/", "")
                        .replace(/\.git$/, "")}
                    </strong>
                    <span>
                      <AgentLogo agent={run.agent} className="session-agent-logo" />
                      {agentNames[run.agent]}
                      <span className="entry-separator" />
                      {stateNames[run.state]}
                    </span>
                  </span>
                </Button>
              ))}
              {!matches.length ? (
                <p className="sidebar-empty">
                  {search
                    ? "No matching sessions."
                    : "Your sessions will appear here."}
                </p>
              ) : null}
            </nav>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Separator />
      <div className="section-heading">
        <ChevronDown className="size-3.5" />
        <h3>Repository changes</h3>
        <Badge variant="secondary">{files.length}</Badge>
      </div>
      <nav className="changed-files" aria-label="Changed files">
        {files.map((file) => (
          <Button
            key={file.path}
            variant={activePath === file.path ? "secondary" : "ghost"}
            className="file-entry"
            onClick={() => openFile(file.path)}
            title={file.path}
          >
            <FileIcon path={file.path} data-icon="inline-start" />
            <span className="truncate">{file.path}</span>
            <span className={cn("file-status", `status-${file.status}`)}>
              {file.status}
            </span>
          </Button>
        ))}
        {!files.length &&
        (runner.loadingDiff ||
          runner.loadingTask ||
          (runner.checking && Boolean(runner.selected))) ? (
          <div
            className="flex flex-col gap-2 px-3"
            aria-label="Loading files"
            aria-busy="true"
          >
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-7 w-3/5" />
          </div>
        ) : !files.length ? (
          <p className="sidebar-empty">
            Files will appear when the agent makes changes.
          </p>
        ) : null}
      </nav>
      <div className="sidebar-bottom">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={settings}
        >
          <Github data-icon="inline-start" />
          {runner.github?.connected
            ? runner.github.accounts.join(", ")
            : "Connect GitHub"}
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </aside>
  );
}
const DiffPane = memo(function DiffPane({ file }: { file: ChangedFile }) {
  return (
    <div
      className="code-scroll"
      tabIndex={0}
      aria-label={`Diff for ${file.path}`}
    >
      <div className="code-lines">
        {file.lines.slice(0, 5000).map((line, index) => (
          <div key={index} className={cn("code-line", `line-${line.kind}`)}>
            <span className="line-number" aria-hidden="true">
              {line.before || ""}
            </span>
            <span className="line-number" aria-hidden="true">
              {line.after || ""}
            </span>
            <code>{line.text || " "}</code>
          </div>
        ))}
      </div>
      {file.lines.length > 5000 ? (
        <p className="code-limit">
          Showing the first 5,000 lines. Download the patch to review the full
          file.
        </p>
      ) : null}
    </div>
  );
});
function ActivityPanel({
  runner,
  expanded,
  toggle,
}: {
  runner: Runner;
  expanded: boolean;
  toggle: () => void;
}) {
  const [follow, setFollow] = useState(true);
  const [activityTab, setActivityTab] = useState("tools");
  const responseRef = useRef<HTMLDivElement>(null);
  const response =
    runner.liveText ?? runner.conversation?.turns.at(-1)?.response ?? "";
  useEffect(() => {
    if (follow && runner.selected && isActive(runner.selected.state) && responseRef.current)
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
  }, [response, follow, activityTab, runner.selected?.state]);
  return (
    <Tabs value={activityTab} onValueChange={setActivityTab} className="activity-root">
    <Collapsible open={expanded} onOpenChange={toggle} asChild>
      <section
        className={cn("activity-panel", !expanded && "collapsed")}
        aria-label="Tool activity"
      >
        <div className="panel-heading">
          <span className="activity-heading">
            <SquareTerminal className="size-3.5" />

              <TabsList variant="line" aria-label="Activity view">
                <TabsTrigger value="tools">
                  Tools<Badge variant="secondary">{runner.activityCount}</Badge>
                </TabsTrigger>
                <TabsTrigger value="response">Response</TabsTrigger>
              </TabsList>

          </span>
          <div className="flex items-center gap-1">
            <span className="stream-label" role="status">
              {["Connecting", "Reconnecting"].includes(runner.streamState) ? (
                <Spinner aria-hidden="true" />
              ) : runner.streamState === "Saved" ? (
                <Check aria-hidden="true" />
              ) : runner.streamState === "Live" ? (
                <Radio aria-hidden="true" />
              ) : null}
              {runner.streamState || "No activity"}
            </span>
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={follow}
              onClick={() => {
                setFollow((value) => !value);
                runner.followRef.current = !follow;
              }}
            >
              {follow ? (
                <ChevronsDown data-icon="inline-start" />
              ) : (
                <Pause data-icon="inline-start" />
              )}
              {follow ? "Following" : "Paused"}
            </Button>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={expanded ? "Hide activity" : "Show activity"}
              >
                {expanded ? <ChevronDown /> : <PanelBottom />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent
          forceMount
          className="activity-scroll"
          hidden={!expanded}
        >
          <TabsContent value="tools" forceMount hidden={activityTab !== "tools"} className="activity-content"><div
            className="activity-output"
            ref={runner.activityRef}
            tabIndex={0}
            aria-label="Execution logs"
          />
          </TabsContent>{activityTab === "response" ? (
            <TabsContent value="response" className="activity-response" ref={responseRef}>
              {response ? (
                <AgentResponse text={response} />
              ) : (
                <p className="editor-hint">
                  The agent response will appear here.
                </p>
              )}
            </TabsContent>
          ) : null}
        </CollapsibleContent>
      </section>
    </Collapsible>
    </Tabs>
  );
}
function Workspace({
  runner,
  files,
  activePath,
  setActivePath,
  newSession,
  publish,
  logsExpanded,
  setLogsExpanded,
  workspace,
}: {
  workspace: RepositoryWorkspace;
  runner: Runner;
  files: ChangedFile[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  newSession: () => void;
  publish: () => void;
  logsExpanded: boolean;
  setLogsExpanded: (value: boolean) => void;
}) {
  const file = files.find((item) => item.path === activePath) || files[0];
  const additions = files.reduce((sum, item) => sum + item.added, 0),
    deletions = files.reduce((sum, item) => sum + item.removed, 0);
  const prURL = runner.proposal?.pr
    ? githubPullRequestURL(runner.proposal.pr.url)
    : null;
  function download() {
    const url = URL.createObjectURL(
      new Blob([runner.diff], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${runner.selected?.id || "changes"}.patch`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="code-workspace" aria-label="Code review">
      <div className="editor-toolbar">
        <div className="editor-breadcrumb">
          <ToggleGroup
            type="single"
            value={workspace.mode}
            onValueChange={(value) => {
              if (value) workspace.setMode(value as "code" | "changes");
            }}
            aria-label="Editor mode"
            variant="outline"
            spacing={0}
          >
            <ToggleGroupItem value="code">Code</ToggleGroupItem>
            <ToggleGroupItem value="changes">Changes</ToggleGroupItem>
          </ToggleGroup>
          <GitBranch className="size-3.5" />
          <span className="truncate">
            {runner.selected?.ref ||
              (runner.selected ? "Default branch" : "No repository open")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={!runner.diff}
            aria-label="Download patch"
            onClick={download}
          >
            <Download data-icon="inline-start" />
            <span className="action-label">Patch</span>
          </Button>
          {prURL ? (
            <Button variant="outline" size="xs" asChild>
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
                    size="xs"
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
          {runner.selected && isActive(runner.selected.state) ? (
            <Button
              variant="destructive"
              size="xs"
              onClick={() => void runner.stop()}
              disabled={runner.stopping}
              aria-busy={runner.stopping}
            >
              {runner.stopping ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Square data-icon="inline-start" />
              )}
              {runner.stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
        </div>
      </div>
      {workspace.mode === "code" ? (
        <RepositoryEditor workspace={workspace} runner={runner} />
      ) : file ? (
        <Tabs
          value={file.path}
          onValueChange={setActivePath}
          className="file-view"
        >
          <div className="file-tabs">
            <TabsList variant="line" aria-label="Changed files">
              {files.map((item) => (
                <TabsTrigger
                  key={item.path}
                  value={item.path}
                  title={item.path}
                >
                  <FileIcon path={item.path} data-icon="inline-start" />
                  {item.path.split("/").at(-1)}
                  <span className={cn("file-status", `status-${item.status}`)}>
                    {item.status}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {files.map((item) => (
            <TabsContent
              key={item.path}
              value={item.path}
              className="file-content"
            >
              <div className="diff-heading">
                <span className="truncate">{item.path}</span>
                <div className="diff-stat">
                  <span className="diff-added">+{item.added}</span>
                  <span className="diff-removed">−{item.removed}</span>
                  <Badge variant="outline">
                    <Eye data-icon="inline-start" />
                    Read-only
                  </Badge>
                </div>
              </div>
              <DiffPane file={item} />
            </TabsContent>
          ))}
        </Tabs>
      ) : runner.loadingDiff ||
        runner.loadingTask ||
        (runner.checking && Boolean(runner.selected)) ? (
        <div className="diff-loading" aria-busy="true" role="status">
          <div className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            Restoring changes…
          </div>
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : (
        <>
          <div className="file-tabs">
            <span className="editor-tab-empty">
              <Files className="size-3.5" />
              Workspace
            </span>
          </div>
          <Empty className="editor-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Code2 />
              </EmptyMedia>
              <EmptyTitle>
                {runner.selected
                  ? isActive(runner.selected.state)
                    ? `Waiting for changes from ${agentNames[runner.selected.agent]}`
                    : "This turn has no changes"
                  : "Open a work session"}
              </EmptyTitle>
              <EmptyDescription>
                {runner.selected
                  ? "Follow the agent conversation and review its activity. Changes from this session will appear here."
                  : "Choose a session to browse files, edit code, and review changes."}
              </EmptyDescription>
            </EmptyHeader>
            {!runner.selected ? (
              <EmptyContent>
                <Button variant="outline" onClick={newSession}>
                  <Plus data-icon="inline-start" />
                  New session
                </Button>
                <p className="workspace-shortcuts">
                  <KbdGroup>
                    <Kbd>⌘ / Ctrl</Kbd>
                    <Kbd>N</Kbd>
                  </KbdGroup>
                  <span>New session</span>
                </p>
              </EmptyContent>
            ) : null}
          </Empty>
        </>
      )}
      <div className="changes-summary">
        <span>
          <FileDiff className="size-3.5" />
          {files.length} {files.length === 1 ? "changed file" : "changed files"}
        </span>
        <span className="diff-stat">
          <span className="diff-added">+{additions}</span>
          <span className="diff-removed">−{deletions}</span>
          <span>against the initial commit</span>
        </span>
      </div>
      <ActivityPanel
        runner={runner}
        expanded={logsExpanded}
        toggle={() => setLogsExpanded(!logsExpanded)}
      />
    </main>
  );
}
function AgentChat({
  runner,
  workspace,
  newSession,
  drafts,
}: {
  runner: Runner;
  workspace: RepositoryWorkspace;
  newSession: () => void;
  drafts: RefObject<Record<string, string>>;
}) {
  const draftKey = runner.selected?.id || "new";
  const [draft, setDraft] = useState(() => drafts.current[draftKey] || ""),
    [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null),
    formRef = useRef<HTMLFormElement>(null),
    lastTurn = useRef(-1);
  const active = runner.selected ? isActive(runner.selected.state) : false;
  const chat = runner.conversation,
    turns = chat?.turns || [];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = chat?.turn || 0;
    if (
      next !== lastTurn.current ||
      node.scrollHeight - node.scrollTop - node.clientHeight < 180
    )
      node.scrollTop = node.scrollHeight;
    lastTurn.current = next;
  }, [chat, runner.liveText]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (workspace.hasDirty || workspace.hasSaving) {
      setError(
        "Save or discard your file changes before sending another instruction.",
      );
      return;
    }
    setError("");
    try {
      await runner.send(draft.trim());
      setDraft("");
      delete drafts.current[draftKey];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the message.");
    }
  }
  return (
    <aside className="agent-panel" aria-label="Agent chat">
      <div className="panel-heading">
        <h2>
          <MessageSquare className="size-3.5" />
          Agent
        </h2>
        <div className="flex items-center gap-2">
          {runner.selected ? (
            <Badge variant="secondary">
              <AgentLogo agent={runner.selected.agent} data-icon="inline-start" />
              {agentNames[runner.selected.agent]}
            </Badge>
          ) : null}
          <IconButton
            icon={Plus}
            label="New agent session"
            onClick={newSession}
          />
        </div>
      </div>
      <div className="chat-session-heading">
        <Cloud className="size-4" />
        <div>
          <strong>
            {runner.selected ? "Session conversation" : "Your cloud agent"}
          </strong>
          <span>
            {runner.selected
              ? runner.selected.id.slice(0, 18)
              : "Pi or OpenCode, from your browser"}
          </span>
        </div>
        {chat?.checkpointSaved ? (
          <Tooltip>
            <TooltipTrigger>
              <CloudCheck
                className="size-4 text-muted-foreground"
                aria-label="Context and changes saved"
              />
            </TooltipTrigger>
            <TooltipContent>Context and changes saved</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div
        className="conversation-scroll"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Conversation messages"
      >
        {runner.loadingTask || (runner.checking && runner.selected) ? (
          <div className="flex flex-col gap-4 p-4">
            <Skeleton className="h-12 w-4/5 self-end" />
            <Skeleton className="h-24 w-full" />
            <span className="text-xs text-muted-foreground">
              Restoring conversation…
            </span>
          </div>
        ) : turns.length ? (
          turns.map((turn, index) => (
            <div className="chat-turn" key={turn.id}>
              {turn.number > 0 ? (
                <article className="chat-user">
                  <div className="message-label">
                    <UserRound className="size-3" aria-hidden="true" />
                    You<span>Message {turn.number}</span>
                  </div>
                  <p>{turn.prompt}</p>
                </article>
              ) : null}
              <article className="chat-assistant">
                <div className="assistant-label">
                  <span className="agent-mark">
                    <AgentLogo agent={runner.selected?.agent || "pi"} />
                  </span>
                  <strong>{agentNames[runner.selected?.agent || "pi"]}</strong>
                  {index === turns.length - 1 && active ? (
                    <span className="assistant-working">
                      <Spinner aria-hidden="true" />
                      Working
                    </span>
                  ) : null}
                </div>
                <AgentResponse
                  text={
                    index === turns.length - 1 && runner.liveText !== null
                      ? runner.liveText || "Thinking…"
                      : turn.response ||
                        (active
                          ? "Reviewing your instructions and the repository…"
                          : "No saved response.")
                  }
                />
              </article>
            </div>
          ))
        ) : (
          <Empty className="chat-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquare />
              </EmptyMedia>
              <EmptyTitle>
                {runner.selected
                  ? "Restore your conversation"
                  : "Start working"}
              </EmptyTitle>
              <EmptyDescription>
                {runner.selected
                  ? chat?.reason ||
                    "Your task messages and responses will appear here."
                  : "Describe a task, reply to the agent, and keep working on the same files."}
              </EmptyDescription>
            </EmptyHeader>
            {!runner.selected ? (
              <EmptyContent>
                <Button variant="ghost" onClick={newSession}>
                  Start a session
                  <ChevronRight data-icon="inline-end" />
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>
      <div className="chat-composer">
        <div className="composer-context">
          {runner.selected ? (
            <TaskStateIcon state={runner.selected.state} className="size-3" />
          ) : (
            <MessageSquare className="size-3" aria-hidden="true" />
          )}
          <span>
            {active
              ? "The agent is working"
              : chat?.canContinue
                ? "Waiting for your reply"
                : runner.selected
                  ? "Saved conversation"
                  : "No session open"}
          </span>
        </div>
        <form ref={formRef} onSubmit={submit}>
          <FieldGroup>
            <Field
              data-disabled={
                !runner.connected ||
                !runner.selected ||
                runner.sending ||
                (!chat?.canContinue && !active)
              }
            >
              <FieldLabel htmlFor="chat-message" className="sr-only">
                Reply to the agent
              </FieldLabel>
              <InputGroup className="chat-input-group">
                <InputGroupTextarea
                  id="chat-message"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    drafts.current[draftKey] = event.target.value;
                  }}
                  maxLength={32000}
                  rows={3}
                  disabled={
                    !runner.connected ||
                    !runner.selected ||
                    runner.sending ||
                    (!chat?.canContinue && !active)
                  }
                  placeholder={
                    runner.selected
                      ? "Reply or describe the next change…"
                      : "Open a session to chat…"
                  }
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      if (!active && chat?.canContinue && !runner.sending)
                        formRef.current?.requestSubmit();
                    }
                  }}
                />
                <InputGroupAddon align="block-end" className="composer-actions">
                  <InputGroupText>
                    <Cpu aria-hidden="true" />
                    Qwen 3.7 Flash
                  </InputGroupText>
                  <div className="flex items-center gap-2">
                    <KbdGroup>
                      <Kbd>⌘ / Ctrl</Kbd>
                      <Kbd>↵</Kbd>
                    </KbdGroup>
                    <InputGroupButton
                      variant="default"
                      size="icon-sm"
                      type="submit"
                      disabled={
                        !draft.trim() ||
                        !chat?.canContinue ||
                        active ||
                        runner.sending
                      }
                      aria-label={
                        runner.sending ? "Sending message" : "Send message"
                      }
                      aria-busy={runner.sending}
                    >
                      {runner.sending ? (
                        <Spinner aria-hidden="true" />
                      ) : (
                        <ArrowUp />
                      )}
                    </InputGroupButton>
                  </div>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p className="composer-hint">
          {active
            ? "Stop the task to change direction."
            : chat?.warning ||
              chat?.reason ||
              (chat?.checkpointSaved
                ? "Context and changes saved in the cloud."
                : "The agent works in an isolated workspace.")}
        </p>
      </div>
    </aside>
  );
}
export default function App() {
  const runner = useRunner();
  const workspace = useWorkspace(runner);
  const drafts = useRef<Record<string, string>>({});
  const [exiting, setExiting] = useState(false);
  async function logout() {
    setExiting(true);
    try {
      await runner.logout();
    } catch (error) {
      runner.report(error);
    } finally {
      setExiting(false);
    }
  }
  useEffect(() => {
    if (!runner.connected) drafts.current = {};
  }, [runner.connected]);
  const [newOpen, setNewOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [publishOpen, setPublishOpen] = useState(false),
    [sidebarVisible, setSidebarVisible] = useState(true),
    [logsExpanded, setLogsExpanded] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null),
    [mobilePane, setMobilePane] = useState("chat");
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 900px)").matches,
  );
  const files = useMemo(() => parseDiff(runner.diff), [runner.diff]);
  const newSession = () => {
    if (!runner.connected) runner.setAuthOpen(true);
    else setNewOpen(true);
  };
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    setActivePath(null);
  }, [runner.selected?.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (runner.connected) setNewOpen(true);
        else runner.setAuthOpen(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [runner.connected, runner.setAuthOpen]);
  const openFile = (path: string) => {
    setActivePath(path);
    workspace.setMode("changes");
    if (mobile) setMobilePane("changes");
  };
  const sidebar = (
    <SessionSidebar
      runner={runner}
      files={files}
      activePath={activePath || files[0]?.path || null}
      openFile={openFile}
      newSession={newSession}
      settings={() =>
        runner.connected ? setSettingsOpen(true) : runner.setAuthOpen(true)
      }
      workspace={workspace}
      openSource={(path) => {
        void workspace.open(path);
        if (mobile) setMobilePane("changes");
      }}
      close={() => setSidebarVisible(false)}
    />
  );
  const workspacePanel = (
    <Workspace
      runner={runner}
      files={files}
      activePath={activePath}
      setActivePath={setActivePath}
      newSession={newSession}
      publish={() => setPublishOpen(true)}
      logsExpanded={logsExpanded}
      setLogsExpanded={setLogsExpanded}
      workspace={workspace}
    />
  );
  const agent = (
    <AgentChat
      key={runner.selected?.id || "new"}
      runner={runner}
      newSession={newSession}
      drafts={drafts}
      workspace={workspace}
    />
  );
  return (
    <TooltipProvider>
      <div className="editor-shell">
        <header className="titlebar">
          <div className="brand">
            <span className="brand-mark">
              <Code2 className="size-4" />
            </span>
            <strong>Sandbox</strong>
            <span className="brand-divider" />
            <span className="brand-subtitle">Workspace</span>
          </div>
          <div className="titlebar-project">
            <Cloud className="size-3.5" />
            <span className="truncate">
              {runner.selected?.repository
                .replace("https://github.com/", "")
                .replace(/\.git$/, "") || "Cloud code editor"}
            </span>
          </div>
          <div className="titlebar-actions">
            <Badge variant="outline">
              <Cloud className="size-3" />
              Cloudflare
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              disabled={runner.checking || exiting}
              aria-busy={runner.checking || exiting}
              onClick={() =>
                runner.connected ? void logout() : runner.setAuthOpen(true)
              }
            >
              {runner.checking || exiting ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : runner.connected ? (
                <LogOut data-icon="inline-start" />
              ) : (
                <LogIn data-icon="inline-start" />
              )}
              {exiting
                ? "Signing out…"
                : runner.checking
                  ? "Connecting…"
                  : runner.connected
                    ? "Connected · sign out"
                    : "Connect"}
            </Button>
          </div>
        </header>
        {runner.notice ? (
          <Alert className="workspace-notice">
            <CircleHelp />
            <AlertDescription>{runner.notice}</AlertDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss notice"
              onClick={() => runner.setNotice("")}
            >
              <X />
            </Button>
          </Alert>
        ) : null}
        <div className="editor-body">
          <nav className="activity-rail" aria-label="Workspace panels">
            <IconButton
              icon={Files}
              label="Sessions and changes"
              pressed={sidebarVisible}
              onClick={() => {
                setSidebarVisible((value) => !value);
                setMobilePane("sessions");
              }}
            />
            <IconButton
              icon={MessageSquare}
              label="Agent conversation"
              onClick={() => {
                if (mobile) setMobilePane("chat");
                else document.getElementById("chat-message")?.focus();
              }}
            />
            <IconButton
              icon={SquareTerminal}
              label="Tool activity"
              pressed={logsExpanded}
              onClick={() => {
                setLogsExpanded((value) => !value);
                if (mobile) {
                  setMobilePane("changes");
                  if (runner.selected) runner.activate(runner.selected.id);
                }
              }}
            />
            <div className="rail-spacer" />
            <IconButton
              icon={Settings2}
              label="Workspace settings"
              onClick={() =>
                runner.connected
                  ? setSettingsOpen(true)
                  : runner.setAuthOpen(true)
              }
            />
          </nav>
          {mobile ? (
            <div className="mobile-workspace">
              <ToggleGroup
                type="single"
                value={mobilePane}
                onValueChange={(value) => {
                  if (value) {
                    setMobilePane(value);
                    if (value === "changes" && runner.selected)
                      runner.activate(runner.selected.id);
                  }
                }}
                aria-label="Workspace view"
                variant="outline"
                spacing={0}
              >
                <ToggleGroupItem value="sessions">
                  <Files data-icon="inline-start" />
                  Sessions
                </ToggleGroupItem>
                <ToggleGroupItem value="changes">
                  <Code2 data-icon="inline-start" />
                  Editor
                </ToggleGroupItem>
                <ToggleGroupItem value="chat">
                  <MessageSquare data-icon="inline-start" />
                  Chat
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="mobile-pane">
                {mobilePane === "sessions"
                  ? sidebar
                  : mobilePane === "changes"
                    ? workspacePanel
                    : agent}
              </div>
            </div>
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              className="editor-panels"
            >
              {sidebarVisible ? (
                <>
                  <ResizablePanel
                    id="sessions"
                    defaultSize="20%"
                    minSize="190px"
                    maxSize="360px"
                  >
                    {sidebar}
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              ) : null}
              <ResizablePanel
                id="workspace"
                defaultSize={sidebarVisible ? "47%" : "64%"}
                minSize="320px"
              >
                {workspacePanel}
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="agent"
                defaultSize={sidebarVisible ? "33%" : "36%"}
                minSize="310px"
              >
                {agent}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
        <footer className="statusbar">
          <div>
            <Cloud className="size-3.5" />
            <span>
              {runner.connected
                ? "Cloudflare Sandbox"
                : "Sign in to your workspace"}
            </span>
            {runner.selected ? (
              <>
                <span className="statusbar-divider" />
                <GitBranch className="size-3" />
                <span>{runner.selected.ref || "Default branch"}</span>
              </>
            ) : null}
          </div>
          <div>
            {runner.selected ? (
              <TaskBadge state={runner.selected.state} />
            ) : (
              <span>One workspace per session</span>
            )}
            <span className="statusbar-divider" />
            <span>
              {runner.conversation?.checkpointSaved
                ? "Context saved"
                : "Up to 30 min per reply"}
            </span>
          </div>
        </footer>
        <AuthDialog runner={runner} />
        {runner.connected ? (
          <>
            <NewSessionDialog
              runner={runner}
              open={newOpen}
              onOpenChange={setNewOpen}
            />
            <SettingsDialog
              runner={runner}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
            <PublishDialog
              runner={runner}
              open={publishOpen}
              onOpenChange={setPublishOpen}
            />
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
