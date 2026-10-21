import { lstat, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MemberConfig, MemberState, PolygitConfig, PolygitState } from "./config.js";
import type { PolygitRoot } from "./paths.js";
import { POLYGIT } from "./paths.js";
import {
  branchExists, checkout, getStatus, git, gitOrFail, isDirty, resolveRef, showFileAtRef,
} from "./git-ops.js";

export interface RestoreOptions {
  force?: boolean;
  offline?: boolean;
  /** Clone starts at the saved revisions even when its metadata is on a branch. */
  exactMembers?: boolean;
}

interface MemberPlan {
  name: string;
  path: string;
  config: MemberConfig;
  saved: MemberState;
  missing: boolean;
  target: string;
  detach: boolean;
  createBranch?: string;
}

/** A cloned manifest must never write outside its workspace or into metadata. */
function memberPath(root: string, name: string): string {
  if (typeof name !== "string" || !name || isAbsolute(name)) {
    throw new Error("Member path must be relative to the workspace");
  }
  const path = resolve(root, name);
  const rel = relative(root, path);
  const parts = rel.split(sep);
  if (!rel || parts[0] === ".." || isAbsolute(rel) ||
      parts.some((part) => [".git", POLYGIT.DIR, POLYGIT.REF_FILE, ".worktrees"].includes(part))) {
    throw new Error(`Unsafe member path '${name}'`);
  }
  return path;
}

/** Returns false for absent paths, but refuses symlinks and non-directory parents. */
async function inspectPath(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry) return false;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Refusing to overwrite non-directory or symlink '${current}'`);
    }
  }
  return true;
}

function remoteFor(member: MemberConfig): string {
  const remote = member.remote;
  if (!remote || typeof remote !== "string") throw new Error("No repository URL recorded in this snapshot");
  if (!isAbsolute(remote) && !/^[^/]+:/.test(remote)) {
    throw new Error("Recorded repository URL is relative; use an absolute path or URL");
  }
  return remote;
}

async function ensureCommit(path: string, member: MemberConfig, sha: string, offline: boolean): Promise<void> {
  if (await resolveRef(path, sha)) return;
  if (offline) throw new Error(`Commit ${sha} is unavailable locally (--offline)`);
  const remote = remoteFor(member);
  const pin = `refs/tags/polygit/commits/${sha}`;
  const pinned = await git(["fetch", "--no-tags", "--", remote, pin], path);
  if (pinned.exitCode === 0) {
    if (await resolveRef(path, "FETCH_HEAD") !== sha) {
      throw new Error(`Snapshot tag '${pin}' does not point to ${sha}`);
    }
  } else {
    // Existing repositories need not already use Polygit's publication tags.
    // Servers that disallow direct SHA requests must expose the snapshot tag.
    await gitOrFail(["fetch", "--no-tags", "--", remote, sha], path);
  }
  if (await resolveRef(path, sha) !== sha) throw new Error(`Recorded commit ${sha} remains unavailable`);
}

async function cloneMember(member: MemberPlan): Promise<void> {
  const remote = remoteFor(member.config);
  await mkdir(dirname(member.path), { recursive: true });
  const temporary = await mkdtemp(join(dirname(member.path), ".pgit-clone-"));
  try {
    // No checkout until the recorded object is present; use the real transport
    // even for local origins so unrelated loose objects cannot mask missing pins.
    await gitOrFail(["clone", "--no-checkout", "--no-tags", "--no-local", "--", remote, temporary], dirname(member.path));
    await ensureCommit(temporary, member.config, member.saved.commit, false);
    await checkout(temporary, member.saved.commit, { detach: true });
    const occupied = await lstat(member.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (occupied) throw new Error(`Destination appeared while cloning: ${member.path}`);
    await rename(temporary, member.path);
  } finally {
    // This is our private temporary directory, never a user's existing checkout.
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Shared workspace restoration for clone and checkout. Never pushes anything. */
export async function restoreWorkspace(root: PolygitRoot, ref: string, options: RestoreOptions = {}): Promise<boolean> {
  const snapshot = await resolveRef(root.polygitDir, ref);
  if (!snapshot) throw new Error(`Could not resolve '${ref}' to a polycommit`);
  const [configJson, stateJson] = await Promise.all([
    showFileAtRef(root.polygitDir, snapshot, "config.json"),
    showFileAtRef(root.polygitDir, snapshot, "state.json"),
  ]);
  if (!configJson || !stateJson) throw new Error(`Snapshot '${ref}' lacks configuration or state`);
  const config: PolygitConfig = JSON.parse(configJson);
  const state: PolygitState = JSON.parse(stateJson);
  if (!config || !Array.isArray(config.members) || !state?.members ||
      typeof state.members !== "object" || Array.isArray(state.members)) {
    throw new Error(`Invalid snapshot '${ref}'`);
  }

  const branchName = ref.replace(/^refs\/heads\//, "");
  const isPolybranch = await branchExists(root.polygitDir, branchName);
  const plan: MemberPlan[] = [];
  let failed = false;
  // Validate every path and existing working tree before cloning or fetching.
  for (const member of config.members) {
    try {
      const path = memberPath(root.root, member?.path);
      if (plan.some((other) => path === other.path || path.startsWith(other.path + sep) || other.path.startsWith(path + sep))) {
        throw new Error("Duplicate or overlapping member paths");
      }
      const saved = state.members[member.path];
      if (!saved || typeof saved.commit !== "string" ||
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(saved.commit) ||
          !(saved.branch === null || typeof saved.branch === "string")) {
        throw new Error("Missing or invalid recorded state");
      }
      const missing = !(await inspectPath(root.root, path));
      if (missing) {
        if (options.offline) throw new Error("Repository is missing (--offline)");
        remoteFor(member);
      } else {
        const top = await gitOrFail(["rev-parse", "--show-toplevel"], path);
        if (await realpath(top) !== await realpath(path)) throw new Error("Directory is not an independent Git working tree");
        if (!options.force && await isDirty(path)) throw new Error("Uncommitted changes: commit or stash them first");
      }
      plan.push({ name: member.path, path, config: member, saved, missing, target: saved.commit, detach: true });
    } catch (error) {
      failed = true;
      console.error(`  ${member?.path ?? "(invalid member)"}: ERROR - ${error}`);
    }
  }
  if (failed) return false;

  for (const member of plan) {
    try {
      if (member.missing) {
        console.log(`  ${member.name}: cloning recorded repository`);
        await cloneMember(member);
      }
      if (isPolybranch && !options.exactMembers && member.saved.branch) {
        const branch = member.saved.branch;
        if (await branchExists(member.path, branch)) {
          member.target = branch;
          member.detach = false;
        } else if (await resolveRef(member.path, `refs/remotes/origin/${branch}`)) {
          member.target = `refs/remotes/origin/${branch}`;
          member.detach = false;
          member.createBranch = branch;
        }
      }
      if (member.detach) await ensureCommit(member.path, member.config, member.saved.commit, !!options.offline);
    } catch (error) {
      failed = true;
      console.error(`  ${member.name}: ERROR - ${error}`);
    }
  }
  if (failed) {
    console.error("Restoration incomplete; existing checkouts were not switched. Completed clones are retained for retry.");
    return false;
  }

  console.log(`Checking out .polygit to ${ref}...`);
  await checkout(root.polygitDir, isPolybranch ? branchName : snapshot, { detach: !isPolybranch });
  console.log("\nChecking out members:");
  for (const member of plan) {
    try {
      if (member.createBranch) {
        await gitOrFail(["checkout", ...(options.force ? ["--force"] : []), "--track", "-b", member.createBranch, member.target, "--"], member.path);
      } else {
        await checkout(member.path, member.target, { force: options.force, detach: member.detach });
      }
      const actual = await getStatus(member.path);
      console.log(`  ${member.name}: ${actual.commit.slice(0, 7)} (${actual.branch ?? "detached"})`);
    } catch (error) {
      failed = true;
      console.error(`  ${member.name}: ERROR - ${error}`);
    }
  }
  if (failed) console.error("Checkout failed for some members; other members may have switched. Run 'polygit status' to inspect.");
  return !failed;
}
