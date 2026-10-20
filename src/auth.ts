import { timingSafeEqual } from "node:crypto";
const cookieName = "__Host-runner";
export function hasBearer(request: Request, token: string): boolean {
  return equal(request.headers.get("authorization") ?? "", `Bearer ${token}`, token);
}
function equal(actual: string, expected: string, token: string): boolean {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  return Boolean(token) && a.length === b.length && timingSafeEqual(a, b);
}
export function authenticated(request: Request, token: string): boolean {
  if (hasBearer(request, token)) return true;
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  if (!cookie) return false;
  try { return equal(decodeURIComponent(cookie.slice(cookieName.length + 1)), token, token); } catch { return false; }
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
export function sessionCookie(token: string, clear = false): string {
  return `${cookieName}=${clear ? "" : encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : 28800}`;
}
