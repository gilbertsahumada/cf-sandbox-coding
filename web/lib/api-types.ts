import type { Agent, Repository } from "./types";
import type { TaskStatus as ServerTaskStatus } from "../../src/task-status";
import type {
  RepositoryFileEntry,
  RepositoryFilesResult,
} from "../../src/workspace-files";

// These are successful same-origin API payloads, not runtime validation of untrusted data.
export type RepositoryPage = {
  repositories: Repository[];
  total: number;
  hasMore: boolean;
};

export type RememberedRepository = {
  repository: Repository | null;
  warning?: string;
};

export type GitHubConnection =
  | { url: string }
  | { action: string; manifest: Record<string, unknown> };

export type TaskStatus = ServerTaskStatus;

export type TaskInstruction = { agent: Agent; prompt: string };
export type RepositorySelection = (
  | { installationId: number; repositoryId: number }
  | { url: string }
) & { ref?: string };

export type RepositoryEntry = RepositoryFileEntry;

export type DirectoryListing = {
  entries: RepositoryEntry[];
  nextCursor: number | null;
};

export type RepositoryFile = Required<
  Pick<RepositoryFilesResult, "content" | "version">
>;

export type SavedRepositoryFile = Required<
  Pick<RepositoryFilesResult, "version">
> &
  Pick<RepositoryFilesResult, "warning">;
