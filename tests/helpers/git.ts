import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a git command
 */
export async function git(args: string[], cwd: string): Promise<GitResult> {
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

    proc.on("error", () => {
      resolve({ exitCode: 1, stdout: "", stderr: "Failed to spawn git" });
    });
  });
}

/**
 * Execute git and throw on failure
 */
export async function gitOk(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Create a git repository with an initial commit
 */
export async function createGitRepo(
  path: string,
  options?: {
    files?: Record<string, string>;
    commitMessage?: string;
  }
): Promise<void> {
  await mkdir(path, { recursive: true });
  await gitOk(["init"], path);
  await gitOk(["config", "user.email", "test@example.com"], path);
  await gitOk(["config", "user.name", "Test User"], path);

  // Create files
  const files = options?.files ?? { "README.md": "# Test Repo\n" };
  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(path, filename);
    await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
    await writeFile(filePath, content);
  }

  await gitOk(["add", "-A"], path);
  await gitOk(
    ["commit", "-m", options?.commitMessage ?? "Initial commit"],
    path
  );
}

/**
 * Create a branch and optionally add commits
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  options?: {
    checkout?: boolean;
    files?: Record<string, string>;
    commitMessage?: string;
  }
): Promise<void> {
  await gitOk(["branch", branchName], repoPath);

  if (options?.checkout !== false) {
    await gitOk(["checkout", branchName], repoPath);
  }

  if (options?.files) {
    for (const [filename, content] of Object.entries(options.files)) {
      const filePath = join(repoPath, filename);
      await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
      await writeFile(filePath, content);
    }
    await gitOk(["add", "-A"], repoPath);
    await gitOk(
      ["commit", "-m", options.commitMessage ?? `Add files to ${branchName}`],
      repoPath
    );
  }
}

/**
 * Get the current HEAD commit SHA
 */
export async function getHead(repoPath: string): Promise<string> {
  return gitOk(["rev-parse", "HEAD"], repoPath);
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  const result = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * Add a file and commit
 */
export async function addAndCommit(
  repoPath: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(repoPath, filename);
    await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
    await writeFile(filePath, content);
  }
  await gitOk(["add", "-A"], repoPath);
  await gitOk(["commit", "-m", message], repoPath);
  return getHead(repoPath);
}
