import { workspaceConfig } from "@/lib/config";
import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  FolderGit2,
  GitBranch,
  Globe,
  LockKeyhole,
  Search,
} from "lucide-react";
import { AgentLogo } from "./agent-logo";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { agents, agentNames, type Agent } from "@/lib/types";
import type { Runner } from "@/hooks/use-runner";

export function AgentPicker({
  value,
  onChange,
}: {
  value: Agent;
  onChange: (value: Agent) => void;
}) {
  return (
    <Select value={value} onValueChange={(value) => onChange(value as Agent)}>
      <SelectTrigger
        size="sm"
        className="composer-picker-trigger"
        aria-label={`Coding agent: ${agentNames[value]}`}
      >
        <SelectValue>
          <AgentLogo agent={value} />
          <span>{agentNames[value]}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        side="top"
        align="start"
        className="composer-agent-menu"
      >
        <SelectGroup>
          <SelectLabel>Coding agent</SelectLabel>
          {agents.map((agent) => (
            <SelectItem value={agent} key={agent} textValue={agentNames[agent]}>
              <AgentLogo agent={agent} />
              <span className="composer-agent-option">
                <strong>{agentNames[agent]}</strong>
                <small>{workspaceConfig.modelLabel}</small>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export type DemoRepositoryChoice = "project" | "custom";

export function DemoRepositoryPicker({
  value,
  onChange,
  disabled,
  customName,
}: {
  value: DemoRepositoryChoice;
  onChange: (value: DemoRepositoryChoice | "add") => void;
  disabled: boolean;
  customName?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => onChange(value as DemoRepositoryChoice | "add")}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="composer-picker-trigger composer-repository-trigger"
        aria-label="Demo repository"
      >
        <SelectValue>
          <FolderGit2 aria-hidden="true" />
          <span className="truncate">
            {value === "project"
              ? "cf-sandbox-coding"
              : customName?.split("/").at(-1) || "Other public repository"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="start">
        <SelectGroup>
          <SelectLabel>Public repository</SelectLabel>
          <SelectItem
            value="project"
            textValue={workspaceConfig.demoRepository.fullName}
          >
            <FolderGit2 aria-hidden="true" />
            <span className="composer-agent-option">
              <strong>cf-sandbox-coding</strong>
              <small>Default · {workspaceConfig.demoRepository.fullName}</small>
            </span>
          </SelectItem>
          {customName ? (
            <SelectItem value="custom" textValue={customName}>
              <Globe aria-hidden="true" />
              <span>{customName}</span>
            </SelectItem>
          ) : null}
          <SelectItem value="add">
            <Globe aria-hidden="true" />
            <span>Use another public repository</span>
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function RepositoryPicker({
  runner,
  example,
  onExampleChange,
  branch,
  onBranchChange,
  connectAction,
}: {
  runner: Runner;
  example: boolean;
  onExampleChange: (value: boolean) => void;
  branch: string;
  onBranchChange: (value: string) => void;
  connectAction: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const name = example
    ? workspaceConfig.exampleRepository.fullName
    : runner.repository?.fullName;
  const options = useMemo(() => {
    const repositories = [...runner.repositories];
    if (
      runner.repository &&
      !repositories.some((repo) => repo.url === runner.repository?.url)
    )
      repositories.unshift(runner.repository);
    return repositories.filter((repo) =>
      repo.fullName.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }, [runner.repositories, runner.repository, query]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="composer-picker-trigger composer-repository-trigger"
          aria-label={`Repository: ${name || "Choose repository"}`}
          title={name}
        >
          <FolderGit2 />
          <span className="truncate">
            {name?.split("/").at(-1) || "Choose repository"}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="composer-repository-menu"
        aria-label="Choose repository"
      >
        <div className="composer-picker-heading">Repository</div>
        {runner.github?.connected ? (
          <>
            <div className="composer-repository-search">
              <Search aria-hidden="true" />
              <Input
                aria-label="Search loaded repositories"
                placeholder="Search loaded repositories…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
              />
            </div>
            <div
              className="composer-repository-results"
              aria-label="Repositories"
            >
              {options.map((repo) => (
                <button
                  type="button"
                  className="composer-repository-option"
                  key={repo.url}
                  aria-pressed={!example && repo.url === runner.repository?.url}
                  onClick={() => {
                    runner.chooseRepository(repo);
                    onExampleChange(false);
                    setOpen(false);
                  }}
                >
                  {repo.private ? (
                    <LockKeyhole aria-label="Private" />
                  ) : (
                    <Globe aria-label="Public" />
                  )}
                  <span>
                    <strong>{repo.fullName.split("/").at(-1)}</strong>
                    <small>{repo.fullName}</small>
                  </span>
                  {!example && repo.url === runner.repository?.url ? (
                    <Check className="repository-check" aria-label="Selected" />
                  ) : null}
                </button>
              ))}
              {!options.length ? (
                <p className="composer-picker-empty" role="status">
                  {runner.catalogBusy
                    ? "Loading repositories…"
                    : "No matching repositories."}
                </p>
              ) : null}
            </div>
            <div className="composer-catalog-footer">
              <span>
                {runner.repositories.length} of{" "}
                {Math.max(runner.repositoryTotal, runner.repositories.length)}{" "}
                loaded
              </span>
              {runner.hasMore ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={runner.catalogBusy}
                  onClick={() => void runner.loadMore()}
                >
                  {runner.catalogBusy ? <Spinner /> : null}
                  {runner.catalogBusy ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="composer-connect-action">{connectAction}</div>
        )}
        <div className="composer-branch">
          <GitBranch aria-hidden="true" />
          <label className="sr-only" htmlFor="composer-branch">
            Branch or tag
          </label>
          <Input
            id="composer-branch"
            value={branch}
            onChange={(event) => onBranchChange(event.target.value)}
            maxLength={255}
            placeholder={runner.repository?.defaultBranch || "Default branch"}
          />
          <span>Branch / tag</span>
        </div>
        <button
          type="button"
          className="composer-example-option"
          aria-pressed={example}
          onClick={() => {
            onExampleChange(true);
            setOpen(false);
          }}
        >
          <Globe />
          <span>Use public example</span>
          {example ? <Check /> : null}
        </button>
      </PopoverContent>
    </Popover>
  );
}
