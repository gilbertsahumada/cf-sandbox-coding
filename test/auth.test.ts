import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  authenticate,
  authenticated,
  hasBearer,
  loginRole,
  sameOrigin,
  sessionCookie,
} from "../src/auth";
const secrets = {
  RUNNER_API_TOKEN: crypto.randomUUID(),
  MODEL_API_KEY: crypto.randomUUID(),
  WEB_ACCESS_CODE: crypto.randomUUID(),
  DEMO_ACCESS_CODE: crypto.randomUUID(),
};
const withCookie = (cookie: string) =>
  new Request("https://runner.test/health", {
    headers: { cookie: cookie.split(";")[0] },
  });
const withBearer = (value: string) =>
  new Request("https://runner.test/session", {
    headers: { authorization: `Bearer ${value}` },
  });
test("infrastructure credentials authenticate only the programmatic API, never browser login", () => {
  assert.equal(
    hasBearer(withBearer(secrets.RUNNER_API_TOKEN), secrets.RUNNER_API_TOKEN),
    true,
  );
  assert.equal(
    authenticated(
      withBearer(secrets.RUNNER_API_TOKEN),
      secrets.RUNNER_API_TOKEN,
    ),
    true,
  );
  assert.equal(loginRole(withBearer(secrets.RUNNER_API_TOKEN), secrets), null);
  assert.equal(
    authenticated(
      withCookie(`__Host-runner=${secrets.RUNNER_API_TOKEN}`),
      secrets.RUNNER_API_TOKEN,
    ),
    false,
  );
  assert.equal(loginRole(withBearer(secrets.MODEL_API_KEY), secrets), null);
  assert.equal(
    loginRole(withBearer(secrets.WEB_ACCESS_CODE), secrets),
    "owner",
  );
  assert.equal(
    loginRole(withBearer(secrets.DEMO_ACCESS_CODE), secrets),
    "demo",
  );
  assert.equal(authenticated(new Request("https://runner.test"), ""), false);
});
test("signed cookies contain no secret and isolate demo visitors", () => {
  const first = sessionCookie(secrets, "demo");
  const second = sessionCookie(secrets, "demo");
  const a = authenticate(withCookie(first), secrets)!;
  const b = authenticate(withCookie(second), secrets)!;
  assert.equal(a.role, "demo");
  assert.notEqual(a.subject, b.subject);
  assert.deepEqual(authenticate(withCookie(sessionCookie(secrets)), secrets), {
    role: "owner",
    subject: "owner",
  });
  for (const code of Object.values(secrets)) {
    assert.equal(first.includes(code), false);
    const payload = first.split("=")[1].split(".")[0];
    assert.equal(
      Buffer.from(payload, "base64url").toString().includes(code),
      false,
    );
  }
});
test("tampering, expired sessions, raw cookies and access-code rotation fail closed", () => {
  const cookie = sessionCookie(secrets, "demo");
  assert.equal(
    authenticate(withCookie(cookie), {
      ...secrets,
      DEMO_ACCESS_CODE: crypto.randomUUID(),
    }),
    null,
  );
  assert.equal(
    authenticate(withCookie(cookie), { ...secrets, DEMO_ACCESS_CODE: "" }),
    null,
  );
  assert.equal(
    authenticate(withCookie(cookie), {
      ...secrets,
      RUNNER_API_TOKEN: crypto.randomUUID(),
    }),
    null,
  );
  const [payload] = cookie.slice(cookie.indexOf("=") + 1).split(".");
  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      role: "owner",
    }),
  ).toString("base64url");
  assert.equal(
    authenticate(withCookie(cookie.replace(payload, forged)), secrets),
    null,
  );
  // Even a correctly signed expired payload must be rejected.
  const expired = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "demo",
      subject: "a".repeat(32),
      expires: Date.now() - 1,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secrets.RUNNER_API_TOKEN)
    .update(
      JSON.stringify([
        "browser-session-v1",
        "demo",
        secrets.DEMO_ACCESS_CODE,
        expired,
      ]),
    )
    .digest("hex");
  assert.equal(
    authenticate(withCookie(`__Host-runner=${expired}.${signature}`), secrets),
    null,
  );
  for (const value of [
    "wrong",
    "%zz",
    secrets.RUNNER_API_TOKEN,
    "x".repeat(1100),
  ])
    assert.equal(
      authenticate(withCookie(`__Host-runner=${value}`), secrets),
      null,
    );
});
test("browser codes cannot be short, reused across roles, or reuse a provider/runner key", () => {
  for (const code of [
    "123456",
    secrets.RUNNER_API_TOKEN,
    secrets.MODEL_API_KEY,
    secrets.WEB_ACCESS_CODE,
  ]) {
    const config = { ...secrets, DEMO_ACCESS_CODE: code };
    assert.notEqual(loginRole(withBearer(code), config), "demo");
    assert.throws(() => sessionCookie(config, "demo"));
  }
});
test("cookie mutations require the exact page origin", () => {
  for (const origin of [
    "https://evil.test",
    "https://runner.test.evil",
    "http://runner.test",
    "null",
  ])
    assert.equal(
      sameOrigin(
        new Request("https://runner.test/task", { headers: { origin } }),
      ),
      false,
    );
  assert.ok(
    sameOrigin(
      new Request("https://runner.test/task", {
        headers: { origin: "https://runner.test" },
      }),
    ),
  );
  assert.equal(sameOrigin(new Request("https://runner.test/task")), false);
});
test("session cookies are HttpOnly, secure, host-only, role bounded and clear on logout", () => {
  const cookie = sessionCookie(secrets);
  for (const attribute of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=28800",
  ])
    assert.ok(cookie.includes(attribute));
  assert.equal(cookie.includes("Domain="), false);
  assert.ok(sessionCookie(secrets, "demo").includes("Max-Age=3600"));
  assert.ok(sessionCookie(secrets, "owner", true).includes("Max-Age=0"));
});

test("identical owner and demo codes disable both browser roles rather than granting owner access", () => {
  const config = { ...secrets, DEMO_ACCESS_CODE: secrets.WEB_ACCESS_CODE };
  assert.equal(loginRole(withBearer(config.DEMO_ACCESS_CODE), config), null);
  assert.throws(() => sessionCookie(config, "owner"));
  assert.throws(() => sessionCookie(config, "demo"));
});
