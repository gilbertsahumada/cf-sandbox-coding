import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Cloud,
  GitFork as Github,
  LockKeyhole,
  Play,
  Unplug,
  Search,
  GitBranch,
  Bot,
  Code2,
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
  DialogFooter,
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { Runner } from "@/hooks/use-runner";
import { agentNames, type Agent } from "@/lib/types";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudo completar la operación.";
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
        ? "Abriendo GitHub…"
        : runner.github?.connected
          ? "Elegir repositorios"
          : "Conectar GitHub"}
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
          <DialogTitle>Conecta tu espacio</DialogTitle>
          <DialogDescription>
            Accede a tus sesiones y al agente que trabaja en la nube.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="runner-token">Token de acceso</FieldLabel>
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
                Usa RUNNER_API_TOKEN de tu archivo local .dev.vars. La clave del
                modelo permanece en el servidor.
              </FieldDescription>
            </Field>
            <FormError error={error} />
            <Button disabled={pending} aria-busy={pending} type="submit">
              {pending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <LockKeyhole data-icon="inline-start" />
              )}
              {pending ? "Conectando…" : "Conectar"}
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
}: {
  runner: Runner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      );
      setPrompt("");
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud aria-hidden="true" />
            Nueva sesión en la nube
          </DialogTitle>
          <DialogDescription>
            Elige un repositorio y una tarea. Podrás conversar con el agente y
            revisar sus cambios aquí.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel id="agent-choice">Agente</FieldLabel>
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
                  <Bot data-icon="inline-start" />
                  Pi
                </ToggleGroupItem>
                <ToggleGroupItem value="opencode" aria-label="OpenCode">
                  <Code2 data-icon="inline-start" />
                  OpenCode
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {!runner.github?.connected && !example ? (
              <Alert>
                <Github />
                <AlertDescription>
                  Conecta GitHub para elegir tus repositorios públicos y
                  privados.
                  <GitHubConnectButton runner={runner} />
                </AlertDescription>
              </Alert>
            ) : null}
            {runner.github?.connected ? (
              <>
                <Field>
                  <FieldLabel htmlFor="repo-search">
                    Buscar repositorios
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="repo-search"
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar entre los repositorios cargados"
                    />
                    <InputGroupAddon>
                      <Search aria-hidden="true" />
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Field data-disabled={runner.catalogBusy && !options.length}>
                  <FieldLabel htmlFor="repo-select">
                    <FolderGit2 aria-hidden="true" />
                    Repositorio
                  </FieldLabel>
                  <NativeSelect
                    id="repo-select"
                    className="w-full"
                    value={example ? "example" : runner.repository?.url || ""}
                    disabled={runner.catalogBusy && !options.length}
                    onChange={(event) => {
                      const repo = runner.repositories.find(
                        (item) => item.url === event.target.value,
                      );
                      if (repo) {
                        setExample(false);
                        runner.chooseRepository(repo);
                      }
                    }}
                    required
                  >
                    <NativeSelectOption value="">
                      Selecciona un repositorio
                    </NativeSelectOption>
                    {runner.repository &&
                    !options.some(
                      (repo) => repo.url === runner.repository?.url,
                    ) ? (
                      <NativeSelectOption value={runner.repository.url}>
                        {runner.repository.fullName}
                      </NativeSelectOption>
                    ) : null}
                    {options.map((repo) => (
                      <NativeSelectOption key={repo.url} value={repo.url}>
                        {repo.private ? "Privado" : "Público"} · {repo.fullName}
                      </NativeSelectOption>
                    ))}
                    {example ? (
                      <NativeSelectOption value="example">
                        octocat/Hello-World
                      </NativeSelectOption>
                    ) : null}
                  </NativeSelect>
                  <FieldDescription>
                    {runner.catalogBusy ? (
                      <span
                        className="inline-flex items-center gap-2"
                        role="status"
                      >
                        <Spinner aria-hidden="true" />
                        Cargando repositorios…{" "}
                      </span>
                    ) : null}
                    Mostrando {runner.repositories.length} de{" "}
                    {Math.max(
                      runner.repositoryTotal,
                      runner.repositories.length,
                    )}{" "}
                    repositorios.
                    {query
                      ? ` ${options.length} coincidencias entre los cargados.`
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
                      {runner.catalogBusy
                        ? "Cargando…"
                        : "Cargar más repositorios"}
                    </Button>
                  ) : null}
                </Field>
              </>
            ) : null}
            {example ? (
              <Alert>
                <Cloud />
                <AlertDescription>
                  Repositorio de ejemplo: octocat/Hello-World.
                </AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="repo-ref">
                <GitBranch aria-hidden="true" />
                Rama o etiqueta{" "}
                <span className="text-muted-foreground">opcional</span>
              </FieldLabel>
              <Input
                id="repo-ref"
                maxLength={255}
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                placeholder={
                  runner.repository?.defaultBranch || "Rama predeterminada"
                }
              />
            </Field>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="task-prompt">¿Qué quieres hacer?</FieldLabel>
              <Textarea
                id="task-prompt"
                rows={5}
                maxLength={32000}
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe el cambio, el resultado esperado y las pruebas que debe ejecutar…"
              />
              <FieldDescription>
                La sesión se ejecuta con Qwen. Podrás seguir enviando
                instrucciones en su chat.
              </FieldDescription>
            </Field>
            <FormError error={error} />
            {runner.hasActiveRun && !runner.busy ? (
              <Alert>
                <AlertDescription>
                  Hay una tarea en curso. Ábrela en Sesiones para continuar o
                  detenerla.
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setExample(true);
                  setPrompt(
                    "Crea NOTES.md con un resumen del repositorio. Comprueba que existe. No hagas commit.",
                  );
                }}
              >
                Usar ejemplo público
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
                {runner.busy
                  ? "Preparando sesión…"
                  : "Iniciar sesión de trabajo"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
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
          <DialogTitle>Tu espacio</DialogTitle>
          <DialogDescription>
            Conexiones de este runner y acceso a tus repositorios.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Cloud className="size-5 text-primary" />
            <div>
              <strong>Cloudflare Sandbox</strong>
              <p className="text-sm text-muted-foreground">
                Pi y OpenCode con Qwen en la nube.
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
                    : "Sin conectar"}
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
              Desconectar GitHub
            </Button>
          ) : null}
          <Separator />
          <p className="text-xs text-muted-foreground">
            Las claves del modelo y de GitHub permanecen en el servidor. El
            agente tiene acceso al repositorio que eliges.
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
            Crear pull request
          </DialogTitle>
          <DialogDescription>
            Publica los cambios revisados en una rama propia y un PR en
            borrador.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pr-title">Título</FieldLabel>
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
                Descripción y pruebas
              </FieldLabel>
              <Textarea
                id="pr-description"
                rows={5}
                maxLength={20000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Resume los cambios y las pruebas realizadas"
              />
            </Field>
            <FormError error={error} />
            <FieldDescription>
              La GitHub App necesita Contents y Pull requests en Read and write,
              aprobados en su instalación.
            </FieldDescription>
            <div className="flex flex-wrap gap-3">
              {runner.github?.permissionsUrl ? (
                <Button type="button" variant="link" size="sm" asChild>
                  <a
                    href={runner.github.permissionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Configurar permisos
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
                  Revisar instalación
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
              {pending ? "Creando PR…" : "Crear PR en borrador"}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
