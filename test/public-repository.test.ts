import { test } from "node:test";
import assert from "node:assert/strict";
import { publicRepositoryUrl } from "../web/lib/public-repository";

test("public repository confirmation normalizes GitHub clone URLs", () => {
  assert.deepEqual(
    publicRepositoryUrl(" https://github.com/owner/repo.git/ "),
    {
      fullName: "owner/repo",
      url: "https://github.com/owner/repo",
    },
  );
});

test("public repository confirmation rejects credentials, other hosts, and file links", () => {
  for (const value of [
    "",
    "git@github.com:owner/repo.git",
    "http://github.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://user:password@github.com/owner/repo",
    "https://github.com:8443/owner/repo",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo?token=example",
    "https://github.com/owner/repo#file",
  ])
    assert.equal(publicRepositoryUrl(value), null);
});
