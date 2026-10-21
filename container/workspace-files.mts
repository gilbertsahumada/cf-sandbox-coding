import {
  constants,
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
  fstatSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  fchmodSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const limit = 256 * 1024;
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function permittedPath(
  value: unknown,
  directory = false,
): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\x00-\x1f\x7f\\]/.test(value) ||
    value.startsWith("/") ||
    (!value && !directory)
  )
    return false;
  return (
    (!value && directory) ||
    value
      .split("/")
      .every(
        (part) =>
          part &&
          ![".", "..", ".git", ".ssh", ".aws", ".gnupg"].includes(
            part.toLowerCase(),
          ) &&
          ([".env.example", ".dev.vars.example"].includes(part) ||
            !/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.(?:json|ya?ml)|\.npmrc|\.netrc)$|\.(?:pem|key|p12|pfx)$/i.test(
              part,
            )),
      )
  );
}
function checked(root: string, path: string, directory = false) {
  if (!permittedPath(path, directory))
    fail("This path is unavailable in the web editor.", 403);
  let current = root;
  for (const part of ["", ...path.split("/").filter(Boolean)]) {
    if (part) current = join(current, part);
    const stat = lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && current !== join(root, path))
    )
      fail(
        "Symbolic links and paths outside the repository cannot be opened.",
        403,
      );
  }
  return current;
}
// Linux directory descriptors anchor every lookup, even if an agent renames a parent.
function withAnchoredPath<T>(
  root: string,
  relative: string,
  directory: boolean,
  action: (path: string) => T,
): T {
  if (!permittedPath(relative, directory))
    fail("This path is unavailable in the web editor.", 403);
  if (process.platform !== "linux")
    return action(checked(root, relative, directory));
  const descriptors = [],
    parts = relative.split("/").filter(Boolean);
  const directories = directory ? parts : parts.slice(0, -1);
  try {
    let fd = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    descriptors.push(fd);
    if (realpathSync(`/proc/self/fd/${fd}`) !== root)
      fail("The repository root must not be a symbolic link.", 403);
    for (const part of directories) {
      fd = openSync(
        `/proc/self/fd/${fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      descriptors.push(fd);
    }
    return action(
      directory ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${parts.at(-1)}`,
    );
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { status?: number };
    if (["ELOOP", "ENOTDIR"].includes(error.code as string))
      fail(
        "Symbolic links and paths outside the repository cannot be opened.",
        403,
      );
    throw error;
  } finally {
    for (const fd of descriptors.reverse()) closeSync(fd);
  }
}
function bytesAt(path: string) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (stat.nlink !== 1)
      fail("Hard-linked files cannot be opened in the web editor.", 403);
    if (!stat.isFile()) fail("Only regular text files can be opened.", 415);
    if (stat.size > limit)
      fail("This file exceeds the 256 KB editor limit.", 413);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0,
      count;
    while (
      length <= limit &&
      (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0
    )
      length += count;
    if (length > limit) fail("This file exceeds the 256 KB editor limit.", 413);
    const data = bytes.subarray(0, length);
    if (data.includes(0)) fail("Binary files cannot be edited as text.", 415);
    let content;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(data);
    } catch {
      fail("Only UTF-8 text files can be edited.", 415);
    }
    return {
      content,
      version: createHash("sha256").update(data).digest("hex"),
      bytes: length,
      mode: stat.mode,
    };
  } finally {
    closeSync(fd);
  }
}
type FileRequest = {
  operation: string;
  path: string;
  cursor?: number;
  content?: unknown;
  version?: string;
};
export function workspaceFiles(root: string, request: FileRequest) {
  return withAnchoredPath(
    root,
    request.path,
    request.operation === "list",
    (path) => {
      if (request.operation === "list") {
        if (
          !(
            process.platform === "linux"
              ? fstatSync(Number(path.split("/").at(-1)))
              : lstatSync(path)
          ).isDirectory()
        )
          fail("Choose a directory.", 400);
        const cursor = request.cursor || 0;
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 1_000_000)
          fail("Invalid directory cursor.");
        const all = readdirSync(path, { withFileTypes: true })
          .filter((entry) =>
            permittedPath(
              request.path ? `${request.path}/${entry.name}` : entry.name,
            ),
          )
          .sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) ||
              a.name.localeCompare(b.name, "en"),
          );
        return {
          path: request.path,
          entries: all.slice(cursor, cursor + 200).map((entry) => ({
            name: entry.name,
            path: request.path ? `${request.path}/${entry.name}` : entry.name,
            kind: entry.isSymbolicLink()
              ? "symlink"
              : entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "other",
          })),
          nextCursor: cursor + 200 < all.length ? cursor + 200 : null,
        };
      }
      const current = bytesAt(path);
      if (request.operation === "read")
        return {
          path: request.path,
          content: current.content,
          version: current.version,
          bytes: current.bytes,
        };
      if (request.operation !== "write") fail("Unknown file operation.");
      if (
        typeof request.content !== "string" ||
        Buffer.byteLength(request.content) > limit ||
        request.content.includes("\0")
      )
        fail("Enter UTF-8 text up to 256 KB.", 413);
      const bytes = Buffer.from(request.content);
      if (bytes.toString("utf8") !== request.content)
        fail("Invalid Unicode text.");
      const version = createHash("sha256").update(bytes).digest("hex");
      if (current.version === version)
        return {
          path: request.path,
          version,
          changed: false,
          bytes: bytes.length,
        };
      if (request.version !== current.version)
        fail(
          "This file changed in the cloud. Reload it before saving; your draft has been kept.",
          409,
        );
      const temporary = join(path, "..", `.editor-${randomUUID()}.tmp`);
      let fd;
      try {
        fd = openSync(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        let offset = 0;
        while (offset < bytes.length)
          offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fchmodSync(fd, current.mode & 0o777);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        // The parent descriptor remains open through the compare and atomic rename.
        if (bytesAt(path).version !== current.version)
          fail(
            "This file changed in the cloud. Reload it before saving; your draft has been kept.",
            409,
          );
        renameSync(temporary, path);
      } finally {
        if (fd !== undefined) closeSync(fd);
        try {
          unlinkSync(temporary);
        } catch {}
      }
      return {
        path: request.path,
        version,
        changed: true,
        bytes: bytes.length,
      };
    },
  );
}
if (
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  const input = readFileSync(process.argv[2], "utf8");
  try {
    console.log(
      JSON.stringify(workspaceFiles("/workspace/repo", JSON.parse(input))),
    );
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { status?: number };
    console.log(
      JSON.stringify({
        error: error.status
          ? error.message
          : error.code === "ENOENT"
            ? "File or directory no longer exists."
            : "Could not access this repository path.",
        status: error.status || (error.code === "ENOENT" ? 404 : 409),
      }),
    );
  }
}
