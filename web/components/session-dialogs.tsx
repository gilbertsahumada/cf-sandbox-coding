import { AgentLogo } from "./agent-logo";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  Check,
  Cloud,
  GitFork as Github,
  LockKeyhole,
  Play,
  Unplug,
  Search,
  GitBranch,
  FolderGit2,
  CircleAlert,
  ChevronsDown,
  GitPullRequest,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { Runner } from "@/hooks/use-runner";
import { agentNames, type Agent } from "@/lib/types";
import { Skeleton } from "./ui/skeleton";
const RepositorySelect = lazy(() => import("./repository-select"));
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not be completed.";
function FormError({ error }: { error: string }) {
  return error ? (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}
function GitHubConnectButton({ runner }: { runner: Runner }) {
  const [pending, setPending] = useState(false);
  async function connect() {
    setPending(true);
    try {
      await runner.connectGitHub();
    } catch (error) {
      runner.report(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-busy={pending}
      onClick={() => void connect()}
    >
      {pending ? (
        <Spinner data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Github data-icon="inline-start" />
      )}
      {pending
        ? "Opening GitHub…"
        : runner.github?.connected
          ? "Choose repositories"
          : "Connect GitHub"}
    </Button>
  );
}
export function AuthDialog({ runner }: { runner: Runner }) {
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await runner.login(token);
      setToken("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={runner.authOpen}
      onOpenChange={(open) => {
        runner.setAuthOpen(open);
        if (!open) {
          setToken("");
          setError("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to your workspace</DialogTitle>
          <DialogDescription>
            Access your sessions and the agent working in the cloud.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="runner-token">Access token</FieldLabel>
              <Input
                id="runner-token"
                autoComplete="current-password"
                type="password"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              <FieldDescription>
                Use RUNNER_API_TOKEN from your local .dev.vars file. The model
                API key stays on the server.
              </FieldDescription>
            </Field>
            <FormError error={error} />
            <Button disabled={pending} aria-busy={pending} type="submit">
              {pending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <LockKeyhole data-icon="inline-start" />
              )}
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function NewSessionDialog({
  runner,
  open,
  onOpenChange,
  onStarting,
  embedded = false,
}: {
  embedded?: boolean;
  runner: Runner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarting: () => void;
}) {
  const [agent, setAgent] = useState<Agent>("pi"),
    [query, setQuery] = useState(""),
    [ref, setRef] = useState(""),
    [prompt, setPrompt] = useState(""),
    [error, setError] = useState(""),
    [example, setExample] = useState(false);
  const options = useMemo(
    () =>
      runner.repositories.filter((repo) =>
        repo.fullName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [runner.repositories, query],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await runner.start(
        agent,
        prompt.trim(),
        example ? null : runner.repository,
        ref.trim(),
        example,
        () => {
          onOpenChange(false);
          onStarting();
        },
      );
      setPrompt("");
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const content = (
    <>
      {embedded ? (
        <p className="new-session-intro">
          Choose a repository, an agent, and a task.
        </p>
      ) : (
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud aria-hidden="true" />
            New cloud session
          </DialogTitle>
          <DialogDescription>
            Choose a repository and a task. Chat with the agent and review its
            changes here.
          </DialogDescription>
        </DialogHeader>
      )}
      <form onSubmit={submit} className="new-session-form">
        <FieldGroup>
          {!runner.github?.connected && !example ? (
            <Alert>
              <Github />
              <AlertDescription>
                Connect GitHub to choose your public and private repositories.
                <GitHubConnectButton runner={runner} />
              </AlertDescription>
            </Alert>
          ) : null}
          {runner.github?.connected ? (
            <>
              <Field>
                <FieldLabel htmlFor="repo-search">
                  Search repositories
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="repo-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search loaded repositories"
                  />
                  <InputGroupAddon>
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Field data-disabled={runner.catalogBusy && !options.length}>
                <FieldLabel htmlFor="repo-select">
                  <FolderGit2 aria-hidden="true" />
                  Repository
                </FieldLabel>
                <Suspense
                  fallback={
                    <Skeleton
                      className="h-8 w-full"
                      aria-label="Loading repository selector"
                      role="status"
                    />
                  }
                >
                  <RepositorySelect
                    selected={runner.repository}
                    options={options}
                    example={example}
                    disabled={runner.catalogBusy && !options.length}
                    onSelect={(repo) => {
                      setExample(false);
                      runner.chooseRepository(repo);
                    }}
                  />
                </Suspense>
                <FieldDescription>
                  {runner.catalogBusy ? (
                    <span
                      className="inline-flex items-center gap-2"
                      role="status"
                    >
                      <Spinner aria-hidden="true" />
                      Loading repositories…{" "}
                    </span>
                  ) : null}
                  Showing {runner.repositories.length} of{" "}
                  {Math.max(runner.repositoryTotal, runner.repositories.length)}{" "}
                  repositories.
                  {query
                    ? ` ${options.length} matches among loaded repositories.`
                    : ""}
                </FieldDescription>
                {runner.hasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={runner.catalogBusy}
                    onClick={() => void runner.loadMore()}
                  >
                    {runner.catalogBusy ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <ChevronsDown data-icon="inline-start" />
                    )}
                    {runner.catalogBusy ? "Loading…" : "Load more repositories"}
                  </Button>
                ) : null}
              </Field>
            </>
          ) : null}
          {example ? (
            <Alert>
              <Cloud />
              <AlertDescription>
                Example repository: octocat/Hello-World.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="session-form-options">
            <Field>
              <FieldLabel htmlFor="repo-ref">
                <GitBranch aria-hidden="true" />
                Branch or tag{" "}
                <span className="text-muted-foreground">optional</span>
              </FieldLabel>
              <Input
                id="repo-ref"
                maxLength={255}
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                placeholder={
                  runner.repository?.defaultBranch || "Default branch"
                }
              />
            </Field>
            <Field>
              <FieldLabel id="agent-choice">Agent</FieldLabel>
              <ToggleGroup
                type="single"
                value={agent}
                onValueChange={(value) => {
                  if (value) setAgent(value as Agent);
                }}
                aria-labelledby="agent-choice"
                variant="outline"
                spacing={2}
              >
                <ToggleGroupItem value="pi" aria-label="Pi">
                  <AgentLogo agent="pi" data-icon="inline-start" />
                  Pi
                  {agent === "pi" ? (
                    <Check data-icon="inline-end" aria-hidden="true" />
                  ) : null}
                </ToggleGroupItem>
                <ToggleGroupItem value="opencode" aria-label="OpenCode">
                  <AgentLogo agent="opencode" data-icon="inline-start" />
                  OpenCode
                  {agent === "opencode" ? (
                    <Check data-icon="inline-end" aria-hidden="true" />
                  ) : null}
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription role="status">
                {agentNames[agent]} · Qwen 3.7 Flash
              </FieldDescription>
            </Field>
          </div>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="task-prompt">
              What would you like to do?
            </FieldLabel>
            <Textarea
              id="task-prompt"
              rows={5}
              maxLength={32000}
              required
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the change, the expected result, and the checks to run…"
            />
            <FieldDescription>
              Your session runs in an isolated cloud workspace. Continue with
              the same agent and files in its chat.
            </FieldDescription>
          </Field>
          <FormError error={error} />
          {runner.hasActiveRun && !runner.busy ? (
            <Alert>
              <AlertDescription>
                A task is running. Open it in Sessions to continue or stop it.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="session-form-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setExample(true);
                setPrompt(
                  "Create NOTES.md with a repository summary. Verify that it exists. Do not commit.",
                );
              }}
            >
              Use public example
            </Button>
            <Button
              type="submit"
              disabled={
                runner.busy ||
                runner.hasActiveRun ||
                (!runner.repository && !example)
              }
            >
              {runner.busy ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {runner.busy ? "Preparing session…" : "Start session"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </FieldGroup>
      </form>
    </>
  );
  return embedded ? (
    <div className="new-session-inline" hidden={!open}>
      {content}
    </div>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {content}
      </DialogContent>
    </Dialog>
  );
}
export function SettingsDialog({
  runner,
  open,
  onOpenChange,
}: {
  runner: Runner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  async function disconnect() {
    setPending(true);
    try {
      await runner.disconnectGitHub();
    } catch (error) {
      runner.report(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your workspace</DialogTitle>
          <DialogDescription>
            Runner connections and repository access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Cloud className="size-5 text-primary" />
            <div>
              <strong>Cloudflare Sandbox</strong>
              <p className="text-sm text-muted-foreground">
                Pi and OpenCode with Qwen in the cloud.
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Github className="size-5" />
              <div>
                <strong>GitHub</strong>
                <p className="text-sm text-muted-foreground">
                  {runner.github?.connected
                    ? runner.github.accounts.join(", ")
                    : "Not connected"}
                </p>
              </div>
            </div>
            <GitHubConnectButton runner={runner} />
          </div>
          {runner.github?.connected ? (
            <Button variant="ghost" disabled={pending} onClick={disconnect}>
              {pending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Unplug data-icon="inline-start" />
              )}
              Disconnect GitHub
            </Button>
          ) : null}
          <Separator />
          <p className="text-xs text-muted-foreground">
            Model and GitHub credentials stay on the server. The agent can
            access the repository you choose.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function PublishDialog({
  runner,
  open,
  onOpenChange,
}: {
  runner: Runner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(
        `Apply ${agentNames[runner.selected?.agent || "pi"]} task changes`,
      );
      setDescription("");
      setError("");
    }
  }, [open, runner.selected?.id, runner.selected?.agent]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await runner.publish(title.trim(), description.trim());
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setTitle(
            `Apply ${agentNames[runner.selected?.agent || "pi"]} task changes`,
          );
          setDescription("");
          setError("");
        }
        onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest aria-hidden="true" />
            Create pull request
          </DialogTitle>
          <DialogDescription>
            Publish reviewed changes to a dedicated branch and a draft pull
            request.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pr-title">Title</FieldLabel>
              <Input
                id="pr-title"
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={`Apply ${agentNames[runner.selected?.agent || "pi"]} task changes`}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pr-description">
                Description and checks
              </FieldLabel>
              <Textarea
                id="pr-description"
                rows={5}
                maxLength={20000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Summarize the changes and checks performed"
              />
            </Field>
            <FormError error={error} />
            <FieldDescription>
              The GitHub App needs Contents and Pull requests set to Read and
              write, approved for its installation.
            </FieldDescription>
            <div className="flex flex-wrap gap-3">
              {runner.github?.permissionsUrl ? (
                <Button type="button" variant="link" size="sm" asChild>
                  <a
                    href={runner.github.permissionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Configure permissions
                    <ArrowUpRight data-icon="inline-end" />
                  </a>
                </Button>
              ) : null}
              <Button type="button" variant="link" size="sm" asChild>
                <a
                  href="https://github.com/settings/installations"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Review installation
                  <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Github data-icon="inline-start" />
              )}
              {pending ? "Creating PR…" : "Create draft PR"}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
