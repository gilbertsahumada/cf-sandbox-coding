import { test } from "node:test";
import assert from "node:assert/strict";
import { repositorySelection } from "../src/repository-selection";
import { githubRoute } from "../src/github-routes";
const selection = { installationId: 12, repositoryId: 88 };
test("repository preferences retain only valid installation and repository identifiers", () => {
  assert.deepEqual(
    repositorySelection({
      ...selection,
      token: "must-not-persist",
      url: "https://github.com/private/repo",
    }),
    selection,
  );
  for (const invalid of [
    null,
    [],
    {},
    { installationId: "12", repositoryId: 88 },
    { ...selection, repositoryId: 0 },
    { ...selection, installationId: -1 },
    { ...selection, repositoryId: 1.5 },
    { ...selection, repositoryId: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.equal(repositorySelection(invalid), null);
});
test("restoring a selected repository does not depend on repository list pagination", async () => {
  const repo = { ...selection, fullName: "owner/project", private: true };
  const connection = {
    selectedRepository: async () => ({ repository: repo }),
    repositories: () => {
      throw Error("Must not load catalog pages");
    },
  };
  const env = { GITHUB: { getByName: () => connection } } as unknown as Env;
  const response = await githubRoute(
    new Request("https://runner.test/github/selected-repository"),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { repository: repo });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("selection writes validate and strip unneeded fields before reaching durable storage", async () => {
  const writes: unknown[] = [];
  const connection = {
    rememberRepository: async (value: unknown) => {
      writes.push(value);
      return { repository: value };
    },
  };
  const env = { GITHUB: { getByName: () => connection } } as unknown as Env;
  const send = (body: string) =>
    githubRoute(
      new Request("https://runner.test/github/selected-repository", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body,
      }),
      env,
    );
  assert.equal(
    (
      await send(
        JSON.stringify({
          ...selection,
          token: "ignored",
          privateName: "ignored",
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(writes, [selection]);
  for (const invalid of [
    "{broken",
    "{}",
    JSON.stringify({ ...selection, repositoryId: "88" }),
  ])
    assert.equal((await send(invalid)).status, 400);
  assert.equal(writes.length, 1);
});
