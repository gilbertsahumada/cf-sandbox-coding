export type RepositoryFileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
};
export type RepositoryFilesResult = {
  error?: string;
  status?: number;
  path?: string;
  entries?: RepositoryFileEntry[];
  nextCursor?: number | null;
  content?: string;
  version?: string;
  bytes?: number;
  changed?: boolean;
  checkpointSaved?: boolean;
  warning?: string;
};
