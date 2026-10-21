import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const cookieName = "__Host-runner";
export type AccessRole = "owner" | "demo";
export type Principal = { role: AccessRole; subject: string };
export type AccessSecrets = {
  RUNNER_API_TOKEN: string;
  WEB_ACCESS_CODE?: string;
  DEMO_ACCESS_CODE?: string;
  MODEL_API_KEY?: string;
};
const sessionSeconds = { owner: 28_800, demo: 3_600 } as const;
function equal(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return Boolean(expected) && a.length === b.length && timingSafeEqual(a, b);
}
export function hasBearer(request: Request, token: string): boolean {
  return (
    Boolean(token) &&
    equal(request.headers.get("authorization") ?? "", `Bearer ${token}`)
  );
}
function accessCode(role: AccessRole, secrets: AccessSecrets): string {
  const code =
    role === "owner" ? secrets.WEB_ACCESS_CODE : secrets.DEMO_ACCESS_CODE;
  // A shareable code must never double as an infrastructure or provider credential.
  if (
    !code ||
    code.length < 24 ||
    equal(code, secrets.RUNNER_API_TOKEN) ||
    equal(code, secrets.MODEL_API_KEY || "")
  )
    return "";
  if (
    equal(
      code,
      (role === "demo" ? secrets.WEB_ACCESS_CODE : secrets.DEMO_ACCESS_CODE) ||
        "",
    )
  )
    return "";
  return code;
}
export function loginRole(
  request: Request,
  secrets: AccessSecrets,
): AccessRole | null {
  for (const role of ["owner", "demo"] as const) {
    const code = accessCode(role, secrets);
    if (code && hasBearer(request, code)) return role;
  }
  return null;
}
function signature(
  payload: string,
  role: AccessRole,
  secrets: AccessSecrets,
): string {
  return createHmac("sha256", secrets.RUNNER_API_TOKEN)
    .update(
      JSON.stringify([
        "browser-session-v1",
        role,
        accessCode(role, secrets),
        payload,
      ]),
    )
    .digest("hex");
}
export function sessionCookie(
  secrets: AccessSecrets,
  role: AccessRole = "owner",
  clear = false,
): string {
  let value = "";
  if (!clear) {
    if (!secrets.RUNNER_API_TOKEN || !accessCode(role, secrets))
      throw Error(
        "Configure a separate browser access code of at least 24 characters.",
      );
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        role,
        subject: randomBytes(16).toString("hex"),
        expires: Date.now() + sessionSeconds[role] * 1000,
      }),
    ).toString("base64url");
    value = `${payload}.${signature(payload, role, secrets)}`;
  }
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : sessionSeconds[role]}`;
}
export function authenticate(
  request: Request,
  secrets: AccessSecrets,
): Principal | null {
  if (!secrets.RUNNER_API_TOKEN) return null;
  if (hasBearer(request, secrets.RUNNER_API_TOKEN))
    return { role: "owner", subject: "owner" };
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!cookie || cookie.length > 1024) return null;
  const parts = cookie.split(".");
  if (
    parts.length !== 2 ||
    !/^[a-zA-Z0-9_-]+$/.test(parts[0]) ||
    !/^[a-f0-9]{64}$/.test(parts[1])
  )
    return null;
  try {
    const data = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (
      data.v !== 1 ||
      !["owner", "demo"].includes(data.role) ||
      !/^[a-f0-9]{32}$/.test(data.subject)
    )
      return null;
    const role: AccessRole = data.role;
    if (
      !accessCode(role, secrets) ||
      !Number.isSafeInteger(data.expires) ||
      data.expires <= Date.now() ||
      data.expires > Date.now() + sessionSeconds[role] * 1000 + 60_000
    )
      return null;
    if (!equal(parts[1], signature(parts[0], role, secrets))) return null;
    return { role, subject: role === "owner" ? "owner" : data.subject };
  } catch {
    return null;
  }
}
export function authenticated(request: Request, token: string): boolean {
  // The programmatic API accepts the internal token only as a bearer credential.
  return hasBearer(request, token);
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}
