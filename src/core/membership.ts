import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PolygitConfig, PolygitState } from "./config.js";
import { readWorktrees } from "./config.js";
import { getConfigPaths, type PolygitRoot } from "./paths.js";
import { getRemoteUrl, getStatus, gitOrFail } from "./git-ops.js";

/** Paths are always relative to the polyrepo root, even from a subdirectory. */
function normalizeMember(root: string, input: string): string {
  const path = relative(root, resolve(root, input));
  const parts = path.split(sep);
  if (!input || !path || isAbsolute(path) || parts[0] === ".." ||
      parts.some((part) => [".git", ".polygit", ".polygit-ref", ".worktrees"].includes(part))) {
    throw new Error(`Invalid member path '${input}': use a repository inside the polyrepo, outside its metadata and worktree directories`);
  }
  return `./${parts.join("/")}`;
}

async function inputMember(root: string, input: string): Promise<string> {
  if (isAbsolute(input)) {
    // Resolve aliases of the workspace root (e.g. macOS /var -> /private/var),
    // without resolving the member itself: unlink must work for missing paths.
    const canonicalRoot = await realpath(root);
    const absolute = resolve(input);
    for (let parent = dirname(absolute); ; parent = dirname(parent)) {
      const canonical = await realpath(parent).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      });
      if (canonical === canonicalRoot) return normalizeMember(root, relative(parent, absolute));
      if (parent === dirname(parent)) break;
    }
  }
  return normalizeMember(root, input);
}

async function readMetadata(path: string): Promise<string> {
  // Never follow a metadata symlink when replacing files or rolling back.
  if (!(await lstat(path)).isFile()) throw new Error(`Metadata must be a regular file: ${path}`);
  return readFile(path, "utf8");
}

/** Prepare both files before replacing either; restore original bytes on failure. */
async function writeMembership(
  files: { path: string; before: string; after: unknown }[],
): Promise<void> {
  const prepared = files.map((file) => ({ ...file, temporary: `${file.path}.${randomUUID()}.tmp` }));
  const replaced: typeof prepared = [];
  try {
    for (const file of prepared) {
      await writeFile(file.temporary, JSON.stringify(file.after, null, 2) + "\n", { flag: "wx" });
    }
    for (const file of prepared) {
      await rename(file.temporary, file.path);
      replaced.push(file);
    }
  } catch (error) {
    for (const file of replaced.reverse()) await writeFile(file.path, file.before);
    throw error;
  } finally {
    for (const file of prepared) await rm(file.temporary, { force: true });
  }
}

/** Change only membership metadata. No member checkout, staging, commit or fetch. */
export async function changeMembership(
  root: PolygitRoot,
  input: string,
  action: "link" | "unlink",
): Promise<string> {
  if (root.mainPolygitDir || root.worktreeName) {
    throw new Error("Membership can only be changed from the main polyrepo, not a worktree set");
  }
  const name = await inputMember(root.root, input);
  const paths = getConfigPaths(root.polygitDir);
  const [configText, stateText] = await Promise.all([
    readMetadata(paths.config), readMetadata(paths.state),
  ]);
  const config: PolygitConfig = JSON.parse(configText);
  const state: PolygitState = JSON.parse(stateText);
  if (!config || !Array.isArray(config.members) || !state?.members ||
      typeof state.members !== "object" || Array.isArray(state.members)) {
    throw new Error("Invalid membership metadata: expected config.members array and state.members object");
  }
  const members = config.members.map((member) => {
    if (!member || typeof member.path !== "string") throw new Error("Invalid member in config.json");
    return { member, name: normalizeMember(root.root, member.path) };
  });
  const matching = members.filter((entry) => entry.name === name);
  if (action === "link" && matching.length) throw new Error(`Member '${name}' is already linked`);
  if (action === "unlink" && !matching.length) throw new Error(`Member '${name}' is not linked`);

  // Worktree lifecycle commands use the current main config for every set.
  const worktrees = await readWorktrees(root.polygitDir);
  if (!Array.isArray(worktrees.worktrees)) throw new Error("Invalid worktrees.json");
  if (worktrees.worktrees.length) {
    throw new Error("Remove registered worktree sets and previews before changing membership (see 'pgit worktree list')");
  }
  const staged = await gitOrFail(["diff", "--cached", "--name-only", "--", "config.json", "state.json"], root.polygitDir);
  if (staged) throw new Error("Membership metadata is staged or conflicted; commit or unstage it before changing membership");

  if (action === "link") {
    if (members.some((entry) => entry.name.startsWith(name + "/") || name.startsWith(entry.name + "/"))) {
      throw new Error(`Member '${name}' overlaps an existing member`);
    }
    let path = root.root;
    for (const part of name.slice(2).split("/")) {
      path = join(path, part);
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Member paths must be directories without symlinks: ${path}`);
      }
    }
    const top = await gitOrFail(["rev-parse", "--show-toplevel"], path);
    if (await realpath(top) !== await realpath(path)) {
      throw new Error(`'${name}' is not the root of an independent Git working tree`);
    }
    const status = await getStatus(path); // Also requires a valid HEAD commit.
    const remote = await getRemoteUrl(path);
    // Relative local origins are relative to the repository, not the polyrepo.
    const source = remote && !isAbsolute(remote) && !/^[^/]+:/.test(remote)
      ? resolve(path, remote) : remote;
    config.members.push({ path: name, ...(source ? { remote: source } : {}) });
    state.members[name] = { commit: status.commit, branch: status.branch };
  } else {
    config.members = members.filter((entry) => entry.name !== name).map((entry) => entry.member);
    // Match normalized aliases, including older manually edited configurations.
    for (const key of Object.keys(state.members)) {
      if (normalizeMember(root.root, key) === name) delete state.members[key];
    }
  }

  await writeMembership([
    { path: paths.config, before: configText, after: config },
    { path: paths.state, before: stateText, after: state },
  ]);
  return name;
}
