export type RepositorySelection = { installationId: number; repositoryId: number };
export function repositorySelection(value: unknown): RepositorySelection | null {
  if (!value || typeof value !== 'object') return null;
  const { installationId, repositoryId } = value as Partial<RepositorySelection>;
  if (typeof installationId !== 'number' || typeof repositoryId !== 'number' || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || installationId <= 0 || repositoryId <= 0) return null;
  return { installationId, repositoryId };
}
