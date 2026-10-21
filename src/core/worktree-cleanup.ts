import { readdir, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MemberConfig } from "./config.js";
import { isDirty, worktreeRemove } from "./git-ops.js";
import { POLYGIT, resolveMemberPath } from "./paths.js";

/** Remove only Git-approved member worktrees, never recursively delete user files. */
export async function removeWorktreeSet(
  root: string,
  worktreePath: string,
  members: MemberConfig[],
): Promise<void> {
  const targets = members.map((member) => ({
    name: member.path,
    source: resolveMemberPath(root, member.path),
    path: resolveMemberPath(worktreePath, member.path),
  }));
  const memberPaths = new Set(targets.map((member) => resolve(member.path)));

  // Refuse loose files outside member repos, too. Empty parent directories are OK.
  async function checkLayout(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (directory === worktreePath && entry.name === POLYGIT.REF_FILE) continue;
      if (memberPaths.has(resolve(path))) continue;
      if (entry.isDirectory()) await checkLayout(path);
      else throw new Error(`Untracked file outside member repositories: ${path}`);
    }
  }
  await checkLayout(worktreePath);
  for (const member of targets) {
    if (await isDirty(member.path)) {
      throw new Error(`${member.name} has uncommitted changes; commit or stash them before removal`);
    }
  }

  for (const member of targets) {
    // If Git refuses removal, preserve the remaining directories and PG registry.
    await worktreeRemove(member.source, member.path);
    console.log(`  ${member.name}: removed`);
  }

  async function removeEmptyDirectories(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeEmptyDirectories(join(directory, entry.name));
      else if (directory === worktreePath && entry.name === POLYGIT.REF_FILE) {
        await unlink(join(directory, entry.name));
      }
    }
    // A newly created or unexpected file makes rmdir fail instead of losing data.
    await rmdir(directory);
  }
  await removeEmptyDirectories(worktreePath);
}
