import { PublicRepositoryDialog } from "./public-repository-dialog";
import type { PublicRepository } from "@/lib/public-repository";
import { workspaceConfig } from "@/lib/config";
import {
  AgentPicker,
  RepositoryPicker,
  DemoRepositoryPicker,
  type DemoRepositoryChoice,
} from "./composer-pickers";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Cloud,
  GitFork as Github,
  LockKeyhole,
  ArrowUp,
  Unplug,
  CircleAlert,
  GitPullRequest,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
  InputGroupButton,
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

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { Runner } from "@/hooks/use-runner";
import { agentNames, type Agent } from "@/lib/types";
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
  if (runner.demo)
    return (
      <p className="text-xs text-muted-foreground">
        Demo access uses public repositories. GitHub account access is disabled.
      </p>
    );
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
              <FieldLabel htmlFor="runner-token">Access code</FieldLabel>
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
                Enter the workspace or demo access code you received.
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
export function NewConversation({
  runner,
  active,
  onStarting,
}: {
  runner: Runner;
  active: boolean;
  onStarting: () => void;
}) {
  const [agent, setAgent] = useState<Agent>("pi");
  const [ref, setRef] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [example, setExample] = useState(false);
  const [demoRepository, setDemoRepository] =
    useState<DemoRepositoryChoice>("project");
  const [publicRepository, setPublicRepository] =
    useState<PublicRepository | null>(null);
  const [repositoryDialogOpen, setRepositoryDialogOpen] = useState(false);
  const demoRepositoryUrl =
    demoRepository === "project"
      ? workspaceConfig.demoRepository.url
      : publicRepository?.url || "";
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const canSend =
    Boolean(prompt.trim()) &&
    !runner.starting &&
    Boolean(runner.demo ? demoRepositoryUrl : runner.repository || example);
  useEffect(() => {
    if (active) messageRef.current?.focus({ preventScroll: true });
  }, [active]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    setError("");
    try {
      await runner.start(
        agent,
        prompt.trim(),
        example ? null : runner.repository,
        ref.trim(),
        example,
        onStarting,
        runner.demo ? demoRepositoryUrl : undefined,
      );
      setPrompt("");
    } catch (error) {
      setError(errorText(error));
    }
  }
  return (
    <div className="new-conversation">
      <div className="new-conversation-intro">
        <h1>What would you like to work on?</h1>
        <p>Your first message starts a new cloud session.</p>
      </div>
      <form ref={formRef} onSubmit={submit} className="first-message-form">
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="first-message" className="sr-only">
              First message
            </FieldLabel>
            <InputGroup className="first-message-composer">
              <InputGroupTextarea
                ref={messageRef}
                id="first-message"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                maxLength={workspaceConfig.maxPromptLength}
                disabled={runner.starting}
                placeholder="Describe a change, ask a question, or plan your next task…"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (canSend) formRef.current?.requestSubmit();
                  }
                }}
              />
              <InputGroupAddon
                align="block-end"
                className="first-message-actions"
              >
                <AgentPicker value={agent} onChange={setAgent} />
                {runner.demo ? (
                  <DemoRepositoryPicker
                    value={demoRepository}
                    onChange={(choice) => {
                      if (choice === "add") setRepositoryDialogOpen(true);
                      else setDemoRepository(choice);
                    }}
                    customName={publicRepository?.fullName}
                    disabled={runner.starting}
                  />
                ) : (
                  <RepositoryPicker
                    runner={runner}
                    example={example}
                    onExampleChange={setExample}
                    branch={ref}
                    onBranchChange={setRef}
                    connectAction={<GitHubConnectButton runner={runner} />}
                  />
                )}
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={!canSend}
                  aria-label="Send first message"
                  aria-busy={runner.starting}
                >
                  {runner.starting ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <ArrowUp />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          {runner.demo ? (
            <FieldDescription>
              Work on{" "}
              {demoRepository === "project"
                ? workspaceConfig.demoRepository.fullName
                : publicRepository?.fullName}
              , or choose another public repository. Draft PRs require access
              through the owner’s GitHub App.
            </FieldDescription>
          ) : null}
          <FormError error={error} />
        </FieldGroup>
      </form>
      {repositoryDialogOpen ? (
        <PublicRepositoryDialog
          initialUrl={publicRepository?.url || ""}
          onCancel={() => setRepositoryDialogOpen(false)}
          onConfirm={(repository) => {
            setPublicRepository(repository);
            setDemoRepository("custom");
            setRepositoryDialogOpen(false);
          }}
        />
      ) : null}
      <p className="new-conversation-hint">
        {!runner.demo && !runner.repository && !example
          ? "Choose a repository before sending your first message."
          : `${agentNames[agent]} · ${workspaceConfig.modelLabel}${ref.trim() ? ` · ${ref.trim()}` : ""} · Enter to send, Shift+Enter for a new line.`}
      </p>
    </div>
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
