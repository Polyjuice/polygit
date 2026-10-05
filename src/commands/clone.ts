import { command, positional, option, optional, string } from "cmd-ts";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getCurrentBranch, gitOrFail } from "../core/git-ops.js";
import { POLYGIT } from "../core/paths.js";
import { restoreWorkspace } from "../core/restore.js";

export const cloneCommand = command({
  name: "clone",
  description: "Clone a meta-repository and restore all recorded member revisions",
  args: {
    repository: positional({ type: string, displayName: "repository", description: "Meta-repository URL or path" }),
    directory: positional({ type: optional(string), displayName: "directory", description: "Workspace directory (defaults to repository name)" }),
    branch: option({ type: optional(string), long: "branch", short: "b", description: "Meta branch or tag to clone" }),
  },
  handler: async ({ repository, directory, branch }) => {
    const inferred = repository.replace(/[\\/]+$/, "").split(/[/:\\]/).pop()?.replace(/\.git$/, "");
    if (!directory && (!inferred || inferred === "." || inferred === "..")) {
      console.error("Error: Specify a destination directory for this repository");
      process.exitCode = 1;
      return;
    }
    const root = resolve(directory ?? inferred!);
    const polygitDir = join(root, POLYGIT.DIR);
    try {
      const existing = await lstat(root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing && (existing.isSymbolicLink() || !existing.isDirectory() || (await readdir(root)).length)) {
        throw new Error(`Destination '${root}' must be absent or an empty directory`);
      }
      await mkdir(root, { recursive: true });
      await gitOrFail([
        "clone", "--no-local", ...(branch ? ["--branch", branch] : []), "--", repository, polygitDir,
      ], process.cwd());
      const ref = await getCurrentBranch(polygitDir) ?? "HEAD";
      const restored = await restoreWorkspace({ root, polygitDir, worktreeName: null, mainPolygitDir: null }, ref, { exactMembers: true });
      if (!restored) throw new Error("Member restoration failed; the cloned workspace is retained for retry");
      console.log(`\nPolygit cloned to ${root}`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exitCode = 1;
    }
  },
});
