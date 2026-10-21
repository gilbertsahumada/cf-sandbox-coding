import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type GitEntry = { mode: string; type: string; sha: string };
type ExportedFile = Omit<GitEntry, "sha"> & {
  path: string;
  sha: string | null;
  content?: string;
};

export function exportChanges(directory: string, base: string) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw Error("Invalid base commit");
  const temporary = mkdtempSync(join(tmpdir(), "runner-export-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, "index") };
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: directory,
      env,
      maxBuffer: 12 * 1024 * 1024,
    });
  try {
    git("read-tree", base);
    git("add", "-A", "--", ".");
    const tree = git("write-tree").toString().trim();
    const entries = (sha: string): Map<string, GitEntry> =>
      new Map(
        git("ls-tree", "-rz", sha)
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const tab = line.indexOf("\t");
            const [mode, type, hash] = line.slice(0, tab).split(" ");
            return [line.slice(tab + 1), { mode, type, sha: hash }];
          }),
      );
    const before = entries(base),
      after = entries(tree),
      files = [];
    let size = 0;
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(path),
        current = after.get(path);
      if (old?.sha === current?.sha && old?.mode === current?.mode) continue;
      if (files.length >= 200)
        throw Error(
          "The proposal exceeds the 200-file limit. Download the patch.",
        );
      const file: ExportedFile = {
        path,
        mode: current?.mode || old!.mode,
        type: current?.type || old!.type,
        sha: current?.sha || null,
      };
      if (current?.type === "blob") {
        const bytes = git("cat-file", "blob", current.sha);
        size += bytes.length;
        if (size > 5 * 1024 * 1024)
          throw Error("The proposal exceeds 5 MB. Download the patch.");
        file.content = bytes.toString("base64");
      }
      files.push(file);
    }
    return { files };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith("/export-changes.mjs")) {
  try {
    console.log(
      JSON.stringify(exportChanges(process.argv[2], process.argv[3])),
    );
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { status?: number };
    console.log(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
