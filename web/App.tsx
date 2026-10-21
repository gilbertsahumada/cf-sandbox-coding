import { SessionRuntimeControl } from "@/components/session-runtime-control";
import { ChatCompletion } from "@/components/chat-completion";
import { workspaceConfig } from "@/lib/config";
import {
  SessionNavigation,
  SessionHistory,
  SessionDetails,
  type SessionView,
} from "@/components/session-navigation";
import { fileStatusNames } from "@/lib/editor";
import { sessionTitle, repositoryLabel } from "@/lib/session-presentation";
import { startupText } from "@/lib/session-start";
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
  Eye,
  LogIn,
  LogOut,
  Cpu,
  Radio,
  ChevronsDown,
  Pause,
  Check,
  Code2,
  CircleAlert,
  Download,
  FileDiff,
  Files,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  PanelBottom,
  Plus,
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
import { FileIcon, TaskStateIcon } from "@/components/workspace-indicators";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AuthDialog,
  NewConversation,
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
  import("@/components/markdown-response").then((module) => ({
    default: module.MarkdownResponse,
  })),
);
function AgentResponse({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="editor-hint">Loading response…</p>}>
      <MarkdownResponse text={text} />
    </Suspense>
  );
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
  const startup =
    runner.startup?.task === runner.selected?.id ? runner.startup : null;
  const response = startup
    ? startupText(startup)
    : (runner.liveText ?? runner.conversation?.turns.at(-1)?.response ?? "");
  useEffect(() => {
    if (
      follow &&
      runner.selected &&
      isActive(runner.selected.state) &&
      responseRef.current
    )
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
  }, [response, follow, activityTab, runner.selected?.state]);
  return (
    <Tabs
      value={activityTab}
      onValueChange={setActivityTab}
      className="activity-root"
    >
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
                {startup
                  ? startup.stage === "failed"
                    ? "Preparation failed"
                    : "Preparing"
                  : runner.streamState || "No activity"}
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
            <TabsContent
              value="tools"
              forceMount
              hidden={activityTab !== "tools"}
              className="activity-content"
            >
              {startup ? (
                <div className="startup-progress" role="status">
                  {startup.stage !== "failed" ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <CircleAlert aria-hidden="true" />
                  )}
                  <span>{startupText(startup)}</span>
                </div>
              ) : null}

              <div
                className="activity-output"
                ref={runner.activityRef}
                tabIndex={0}
                aria-label="Execution logs"
              />
            </TabsContent>
            {activityTab === "response" ? (
              <TabsContent
                value="response"
                className="activity-response"
                ref={responseRef}
              >
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
  workspace,
}: {
  workspace: RepositoryWorkspace;
  runner: Runner;
  files: ChangedFile[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  newSession: () => void;
  publish: () => void;
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
              disabled={runner.stopping || runner.busy}
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
                  <span
                    className={cn("file-status", `status-${item.status}`)}
                    aria-label={fileStatusNames[item.status]}
                    title={fileStatusNames[item.status]}
                  >
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
    </main>
  );
}
function AgentChat({
  runner,
  workspace,
  newSession,
  drafts,
  showTools,
  files,
  review,
  publish,
}: {
  runner: Runner;
  workspace: RepositoryWorkspace;
  newSession: () => void;
  drafts: RefObject<Record<string, string>>;
  showTools: () => void;
  files: ChangedFile[];
  review: () => void;
  publish: () => void;
}) {
  const draftKey = runner.selected?.id || "new";
  const [draft, setDraft] = useState(() => drafts.current[draftKey] || ""),
    [error, setError] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null),
    formRef = useRef<HTMLFormElement>(null),
    lastTurn = useRef(-1);
  const active = runner.selected ? isActive(runner.selected.state) : false;
  const startup =
    runner.startup?.task === runner.selected?.id ? runner.startup : null;
  const chat = runner.conversation,
    turns = chat?.turns.length
      ? chat.turns
      : startup
        ? [
            {
              id: startup.task,
              number: 1,
              prompt: startup.prompt,
              response: startupText(startup),
            },
          ]
        : [];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = chat?.turn || 0;
    if (next !== lastTurn.current) followResponse.current = true;
    if (
      next !== lastTurn.current ||
      node.scrollHeight - node.scrollTop - node.clientHeight < 180
    )
      node.scrollTop = node.scrollHeight;
    lastTurn.current = next;
  }, [chat, runner.liveText, runner.proposal, runner.loadingDiff]);
  useEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;
    // Markdown loads lazily; follow its final height without pulling readers away from history.
    const observer = new ResizeObserver(() => {
      if (followResponse.current) scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
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
      <div
        className="conversation-scroll"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Conversation messages"
        onScroll={(event) => {
          const node = event.currentTarget;
          followResponse.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 180;
        }}
      >
        <div className="conversation-content" ref={contentRef}>
          {!startup &&
          (runner.loadingTask || (runner.checking && runner.selected)) ? (
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
                      You<span className="sr-only">Message {turn.number}</span>
                    </div>
                    <p>{turn.prompt}</p>
                  </article>
                ) : null}
                <article className="chat-assistant">
                  <div className="assistant-label">
                    <span className="agent-mark">
                      <AgentLogo agent={runner.selected?.agent || "pi"} />
                    </span>
                    <strong>
                      {agentNames[runner.selected?.agent || "pi"]}
                    </strong>
                    {index === turns.length - 1 && active ? (
                      <span className="assistant-working">
                        <Spinner aria-hidden="true" />
                        {startup ? "Preparing" : "Working"}
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
                    New chat
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          )}
          {runner.selected && turns.length > 0 && !runner.loadingTask ? (
            <ChatCompletion
              state={runner.selected.state}
              changeCount={files.length}
              proposal={runner.proposal}
              loading={runner.loadingDiff}
              hasUnsavedEdits={workspace.hasDirty || workspace.hasSaving}
              onReview={review}
              onPublish={publish}
            />
          ) : null}
        </div>
      </div>
      {runner.selected ? (
        <Button
          variant="ghost"
          className="conversation-activity"
          onClick={showTools}
        >
          <SquareTerminal data-icon="inline-start" />
          Tool activity{" "}
          <Badge variant="secondary">{runner.activityCount}</Badge>
          <span>{runner.streamState || "View output"}</span>
          <ChevronRight data-icon="inline-end" />
        </Button>
      ) : null}
      <div className="chat-composer">
        <div className="composer-context">
          {runner.selected ? (
            <TaskStateIcon state={runner.selected.state} className="size-3" />
          ) : (
            <MessageSquare className="size-3" aria-hidden="true" />
          )}
          <span>
            {startup?.stage === "failed"
              ? "Preparation failed"
              : active
                ? startup
                  ? startupText(startup)
                  : "The agent is working"
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
                  rows={2}
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
                    {workspaceConfig.modelLabel}
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
          {startup?.stage === "failed"
            ? "Open New session to review your instruction and try again."
            : startup
              ? "Preparation is in progress. Your instruction is shown above."
              : active
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
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [view, setView] = useState<SessionView>(() =>
    new URL(location.href).searchParams.get("new") === "1" ? "new" : "session",
  );
  const [sidebarVisible, setSidebarVisible] = useState(
    () =>
      !matchMedia("(max-width: 900px)").matches ||
      !new URL(location.href).searchParams.has("task"),
  );
  const [detailsVisible, setDetailsVisible] = useState(
    () => matchMedia("(min-width: 1151px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const compact = () => {
      if (query.matches) {
        setSidebarVisible(false);
        setDetailsVisible(false);
      }
    };
    query.addEventListener("change", compact);
    return () => query.removeEventListener("change", compact);
  }, []);
  useEffect(() => {
    if (matchMedia("(max-width: 900px)").matches) setDetailsVisible(false);
  }, [view]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const files = useMemo(() => parseDiff(runner.diff), [runner.diff]);
  const startup =
    runner.startup?.task === runner.selected?.id ? runner.startup : null;
  const firstPrompt =
    startup?.prompt ||
    runner.conversation?.turns.find((turn) => turn.prompt)?.prompt;
  useEffect(() => {
    if (runner.connected && runner.selected && firstPrompt)
      setTitles((previous) =>
        previous[runner.selected!.id] === firstPrompt
          ? previous
          : { ...previous, [runner.selected!.id]: firstPrompt },
      );
  }, [runner.connected, runner.selected?.id, firstPrompt]);
  useEffect(() => {
    if (!runner.connected) {
      drafts.current = {};
      setTitles({});
      if (!runner.checking) setView("session");
    }
  }, [runner.connected, runner.checking]);
  const newSession = () => {
    if (!runner.connected) runner.setAuthOpen(true);
    else {
      setView("new");
      if (matchMedia("(max-width: 900px)").matches) setSidebarVisible(false);
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newSession();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [runner.connected]);
  useEffect(() => {
    setActivePath(null);
  }, [runner.selected?.id]);
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
  function selectSession(id: string, stayInHistory = false) {
    runner.activate(id);
    if (!stayInHistory) {
      setView("session");
      if (matchMedia("(max-width: 900px)").matches) setSidebarVisible(false);
    }
  }
  function openFile(path: string) {
    setDetailsVisible(false);
    setActivePath(path);
    workspace.setMode("changes");
    setView("review");
  }
  function openSource(path: string) {
    setDetailsVisible(false);
    void workspace.open(path);
    setView("review");
  }
  const showingNewConversation =
    runner.connected &&
    (view === "new" || (view === "session" && !runner.selected));
  useEffect(() => {
    if (runner.checking) return;
    const url = new URL(location.href);
    if (showingNewConversation) {
      url.searchParams.set("new", "1");
      url.searchParams.delete("task");
    } else {
      url.searchParams.delete("new");
      if (runner.selected) url.searchParams.set("task", runner.selected.id);
    }
    window.history.replaceState(null, "", url);
  }, [showingNewConversation, runner.checking, runner.selected?.id]);
  const title = runner.selected
    ? sessionTitle(runner.selected, titles)
    : "Your cloud workspace";
  return (
    <TooltipProvider>
      <div className="editor-shell agent-workspace">
        <header className="titlebar">
          <div className="brand">
            <span className="brand-mark">
              <Code2 />
            </span>
            <strong>Sandbox</strong>
            <span className="brand-divider" />
            <span className="brand-subtitle">Workspace</span>
          </div>
          <div className="titlebar-actions">
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
                <Spinner data-icon="inline-start" />
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
                    ? "Sign out"
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
        <div
          className="session-layout"
          data-sidebar={sidebarVisible}
          data-details={detailsVisible}
          data-view={showingNewConversation ? "new" : view}
        >
          <nav className="activity-rail" aria-label="Workspace navigation">
            <IconButton
              icon={Files}
              label="Overview"
              pressed={sidebarVisible}
              onClick={() => {
                setDetailsVisible(false);
                setSidebarVisible((value) => !value);
              }}
            />
            <IconButton
              icon={MessageSquare}
              label="Conversation"
              pressed={view === "session"}
              onClick={() => {
                setDetailsVisible(false);
                setView("session");
                if (matchMedia("(max-width: 900px)").matches)
                  setSidebarVisible(false);
              }}
            />
            <IconButton
              icon={SquareTerminal}
              label="Tool activity"
              pressed={view === "tools"}
              onClick={() => {
                setDetailsVisible(false);
                setView("tools");
                if (matchMedia("(max-width: 900px)").matches)
                  setSidebarVisible(false);
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
          <div className="navigation-surface">
            <SessionNavigation
              key={runner.connected ? "authenticated" : "anonymous"}
              runner={runner}
              titles={titles}
              view={view}
              onSelect={selectSession}
              newSession={newSession}
              history={() => {
                setView("history");
                if (matchMedia("(max-width: 900px)").matches)
                  setSidebarVisible(false);
              }}
              settings={() =>
                runner.connected
                  ? setSettingsOpen(true)
                  : runner.setAuthOpen(true)
              }
              close={() => setSidebarVisible(false)}
            />
          </div>
          <main className="session-surface" aria-label="Session workspace">
            <header className="session-toolbar" hidden={showingNewConversation}>
              <div className="session-heading-copy">
                <span className="view-breadcrumb">
                  Overview <ChevronRight />{" "}
                  {view === "new"
                    ? "New session"
                    : view === "history"
                      ? "Sessions"
                      : view === "review"
                        ? "Review"
                        : view === "tools"
                          ? "Activity"
                          : "Session"}
                </span>
                <h1>
                  {view === "new"
                    ? "New cloud session"
                    : view === "history"
                      ? "Sessions"
                      : title}
                </h1>
                {view !== "new" && view !== "history" && runner.selected ? (
                  <div className="session-metadata">
                    <AgentLogo agent={runner.selected.agent} />
                    {agentNames[runner.selected.agent]}
                    <span>·</span>
                    <span className="truncate">
                      {repositoryLabel(runner.selected.repository)}
                    </span>
                    <span>·</span>
                    <TaskStateIcon state={runner.selected.state} />
                    {stateNames[runner.selected.state]}
                  </div>
                ) : null}
              </div>
              <div className="session-header-actions">
                {runner.selected && !["new", "history"].includes(view) ? (
                  <SessionRuntimeControl
                    running={runner.runtime.running}
                    active={isActive(runner.selected.state)}
                    checking={runner.runtime.checking || runner.checking}
                    stopping={runner.stopping}
                    disabled={
                      !runner.connected ||
                      runner.checking ||
                      runner.busy ||
                      workspace.hasSaving
                    }
                    onRefresh={() => void runner.runtime.refresh()}
                    onStop={() => void runner.stop()}
                  />
                ) : null}
                {runner.selected && !["new", "history"].includes(view) ? (
                  <IconButton
                    icon={CircleHelp}
                    label="Session details"
                    pressed={detailsVisible}
                    onClick={() => setDetailsVisible((value) => !value)}
                  />
                ) : null}
              </div>
            </header>
            {runner.selected && !["new", "history"].includes(view) ? (
              <div className="session-view-switch">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  value={view}
                  onValueChange={(value) =>
                    value && setView(value as SessionView)
                  }
                  aria-label="Session view"
                >
                  <ToggleGroupItem value="session">
                    <MessageSquare data-icon="inline-start" />
                    Conversation
                  </ToggleGroupItem>
                  <ToggleGroupItem value="review">
                    <FileDiff data-icon="inline-start" />
                    Changes<Badge variant="secondary">{files.length}</Badge>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="tools">
                    <SquareTerminal data-icon="inline-start" />
                    Tools
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            ) : null}
            <section
              className="surface-page new-conversation-page"
              hidden={!showingNewConversation}
            >
              {runner.connected ? (
                <NewConversation
                  runner={runner}
                  active={showingNewConversation}
                  onStarting={() => {
                    setDetailsVisible(false);
                    setView("session");
                    if (matchMedia("(max-width: 900px)").matches)
                      setSidebarVisible(false);
                  }}
                />
              ) : null}
            </section>
            <section className="surface-page" hidden={view !== "history"}>
              <SessionHistory
                key={runner.connected ? "authenticated" : "anonymous"}
                runner={runner}
                titles={titles}
                onSelect={(id) => selectSession(id, true)}
                openSession={() => setView("session")}
                newSession={newSession}
              />
            </section>
            <div
              className="surface-chat"
              hidden={view !== "session" || showingNewConversation}
            >
              <AgentChat
                key={runner.selected?.id || "new"}
                runner={runner}
                newSession={newSession}
                drafts={drafts}
                workspace={workspace}
                showTools={() => setView("tools")}
                files={files}
                review={() => {
                  workspace.setMode("changes");
                  setDetailsVisible(false);
                  setView("review");
                }}
                publish={() => setPublishOpen(true)}
              />
            </div>
            <div className="surface-review" hidden={view !== "review"}>
              <div className="review-files">
                <FileExplorer workspace={workspace} onOpen={openSource} />
              </div>
              <Workspace
                runner={runner}
                files={files}
                activePath={activePath}
                setActivePath={setActivePath}
                newSession={newSession}
                publish={() => setPublishOpen(true)}
                workspace={workspace}
              />
            </div>
            <div className="surface-tools" hidden={view !== "tools"}>
              <ActivityPanel
                runner={runner}
                expanded={true}
                toggle={() => setView("session")}
              />
            </div>
          </main>
          <SessionDetails
            runner={runner}
            files={files}
            title={title}
            hidden={showingNewConversation}
            openFile={openFile}
            review={() => {
              workspace.setMode("changes");
              setDetailsVisible(false);
              setView("review");
            }}
            browse={() => {
              workspace.setMode("code");
              setDetailsVisible(false);
              setView("review");
            }}
            publish={() => setPublishOpen(true)}
            conversation={() => {
              setDetailsVisible(false);
              setView("session");
            }}
            close={() => setDetailsVisible(false)}
          />
        </div>
        <AuthDialog runner={runner} />
        {runner.connected ? (
          <>
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
