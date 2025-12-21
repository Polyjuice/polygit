import { spawn } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitStatus {
  /** Current commit SHA */
  commit: string;
  /** Current branch name, or null if detached HEAD */
  branch: string | null;
  /** True if working directory has uncommitted changes */
  isDirty: boolean;
}

export interface GitLogEntry {
  /** Commit SHA */
  commit: string;
  /** Commit message (first line) */
  message: string;
  /** Author name */
  author: string;
  /** Commit date as ISO string */
  date: string;
}

// ============================================================================
// Core Git Execution
// ============================================================================

/**
 * Execute a git command in a directory
 */
export async function git(
  args: string[],
  cwd: string
): Promise<GitResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}

/**
 * Execute a git command and throw if it fails
 */
export async function gitOrFail(
  args: string[],
  cwd: string
): Promise<string> {
  const result = await git(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

// ============================================================================
// Repository Info
// ============================================================================

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  const result = await git(["rev-parse", "--git-dir"], path);
  return result.exitCode === 0;
}

/**
 * Get the current HEAD commit SHA
 */
export async function getHeadCommit(repoPath: string): Promise<string> {
  return gitOrFail(["rev-parse", "HEAD"], repoPath);
}

/**
 * Get the current branch name, or null if detached HEAD
 */
export async function getCurrentBranch(
  repoPath: string
): Promise<string | null> {
  const result = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
  if (result.exitCode !== 0) {
    return null; // Detached HEAD
  }
  return result.stdout;
}

/**
 * Check if working directory has uncommitted changes
 */
export async function isDirty(repoPath: string): Promise<boolean> {
  const result = await git(["status", "--porcelain"], repoPath);
  return result.stdout.length > 0;
}

/**
 * Get full status of a repository
 */
export async function getStatus(repoPath: string): Promise<GitStatus> {
  const [commit, branch, dirty] = await Promise.all([
    getHeadCommit(repoPath),
    getCurrentBranch(repoPath),
    isDirty(repoPath),
  ]);
  return { commit, branch, isDirty: dirty };
}

/**
 * Get the remote URL for a repository
 */
export async function getRemoteUrl(
  repoPath: string,
  remoteName: string = "origin"
): Promise<string | null> {
  const result = await git(["remote", "get-url", remoteName], repoPath);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

// ============================================================================
// Basic Operations
// ============================================================================

/**
 * Initialize a new git repository
 */
export async function init(repoPath: string): Promise<void> {
  await gitOrFail(["init"], repoPath);
}

/**
 * Stage all changes
 */
export async function addAll(repoPath: string): Promise<void> {
  await gitOrFail(["add", "-A"], repoPath);
}

/**
 * Create a commit
 */
export async function commit(
  repoPath: string,
  message: string
): Promise<string> {
  await gitOrFail(["commit", "-m", message], repoPath);
  return getHeadCommit(repoPath);
}

/**
 * Checkout a branch or commit
 */
export async function checkout(
  repoPath: string,
  ref: string
): Promise<void> {
  await gitOrFail(["checkout", ref], repoPath);
}

/**
 * Create a new branch at the current HEAD
 */
export async function createBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  await gitOrFail(["branch", branchName], repoPath);
}

/**
 * Check if a branch exists
 */
export async function branchExists(
  repoPath: string,
  branchName: string
): Promise<boolean> {
  const result = await git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    repoPath
  );
  return result.exitCode === 0;
}

/**
 * Get commit log
 */
export async function log(
  repoPath: string,
  count: number = 10
): Promise<GitLogEntry[]> {
  const format = "%H%x00%s%x00%an%x00%aI";
  const result = await git(
    ["log", `--format=${format}`, `-n`, String(count)],
    repoPath
  );

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout.split("\n").map((line) => {
    const [commit, message, author, date] = line.split("\x00");
    return { commit, message, author, date };
  });
}

/**
 * Get the commit SHA for a given ref (branch, tag, or commit)
 */
export async function resolveRef(
  repoPath: string,
  ref: string
): Promise<string | null> {
  const result = await git(["rev-parse", ref], repoPath);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

// ============================================================================
// Worktree Operations
// ============================================================================

/**
 * Add a new worktree
 */
export async function worktreeAdd(
  repoPath: string,
  worktreePath: string,
  branchOrCommit: string
): Promise<void> {
  await gitOrFail(["worktree", "add", worktreePath, branchOrCommit], repoPath);
}

/**
 * Remove a worktree
 */
export async function worktreeRemove(
  repoPath: string,
  worktreePath: string
): Promise<void> {
  await gitOrFail(["worktree", "remove", worktreePath], repoPath);
}

/**
 * List worktrees
 */
export async function worktreeList(
  repoPath: string
): Promise<{ path: string; commit: string; branch: string | null }[]> {
  const result = await git(["worktree", "list", "--porcelain"], repoPath);
  if (result.exitCode !== 0) {
    return [];
  }

  const worktrees: { path: string; commit: string; branch: string | null }[] =
    [];
  let current: { path?: string; commit?: string; branch?: string | null } = {};

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current.path = line.slice(9);
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.slice(5);
    } else if (line.startsWith("branch ")) {
      // refs/heads/main -> main
      const ref = line.slice(7);
      current.branch = ref.replace("refs/heads/", "");
    } else if (line === "detached") {
      current.branch = null;
    } else if (line === "") {
      if (current.path && current.commit !== undefined) {
        worktrees.push({
          path: current.path,
          commit: current.commit,
          branch: current.branch ?? null,
        });
      }
      current = {};
    }
  }

  // Handle last entry if no trailing newline
  if (current.path && current.commit !== undefined) {
    worktrees.push({
      path: current.path,
      commit: current.commit,
      branch: current.branch ?? null,
    });
  }

  return worktrees;
}

// ============================================================================
// File Operations for .polygit state
// ============================================================================

/**
 * Get file content at a specific ref
 */
export async function showFileAtRef(
  repoPath: string,
  ref: string,
  filePath: string
): Promise<string | null> {
  const result = await git(["show", `${ref}:${filePath}`], repoPath);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}
