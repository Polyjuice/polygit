import { stat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";

const POLYGIT_DIR = ".polygit";
const WORKTREES_DIR = ".worktrees";
const POLYGIT_REF_FILE = ".polygit-ref";

export interface PolygitRoot {
  /** Absolute path to the polyrepo root (parent of .polygit) */
  root: string;
  /** Absolute path to the .polygit directory */
  polygitDir: string;
  /** If we're in a worktree, the worktree name */
  worktreeName: string | null;
  /** If we're in a worktree, the path to the main .polygit */
  mainPolygitDir: string | null;
}

/**
 * Check if a directory exists
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Find the .polygit root starting from a directory and walking up.
 * Also detects if we're inside a worktree.
 */
export async function findPolygitRoot(
  startDir: string = process.cwd()
): Promise<PolygitRoot | null> {
  let current = resolve(startDir);

  while (true) {
    // Check for .polygit directory (main polyrepo)
    const polygitPath = join(current, POLYGIT_DIR);
    if (await directoryExists(polygitPath)) {
      return {
        root: current,
        polygitDir: polygitPath,
        worktreeName: null,
        mainPolygitDir: null,
      };
    }

    // Check for .polygit-ref file (inside a worktree)
    const refPath = join(current, POLYGIT_REF_FILE);
    if (await fileExists(refPath)) {
      const { readFile } = await import("node:fs/promises");
      const refContent = await readFile(refPath, "utf-8");
      const mainPolygitDir = refContent.trim();

      // Extract worktree name from path
      // e.g., /Users/jack/heads/.worktrees/foobar -> foobar
      const worktreeName = extractWorktreeName(current);

      return {
        root: current,
        polygitDir: mainPolygitDir,
        worktreeName,
        mainPolygitDir,
      };
    }

    // Move up to parent directory
    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}

/**
 * Extract worktree name from a worktree path.
 * e.g., /Users/jack/heads/.worktrees/foobar -> foobar
 */
function extractWorktreeName(worktreePath: string): string | null {
  const parts = worktreePath.split("/");
  const worktreesIdx = parts.lastIndexOf(WORKTREES_DIR);
  if (worktreesIdx !== -1 && worktreesIdx < parts.length - 1) {
    return parts[worktreesIdx + 1];
  }
  return null;
}

/**
 * Get paths for config files within .polygit
 */
export function getConfigPaths(polygitDir: string) {
  return {
    config: join(polygitDir, "config.json"),
    state: join(polygitDir, "state.json"),
    worktrees: join(polygitDir, "worktrees.json"),
  };
}

/**
 * Get the worktrees directory path
 */
export function getWorktreesDir(root: string): string {
  return join(root, WORKTREES_DIR);
}

/**
 * Get a specific worktree path
 */
export function getWorktreePath(root: string, worktreeName: string): string {
  return join(root, WORKTREES_DIR, worktreeName);
}

/**
 * Resolve a member path relative to the polyrepo root
 */
export function resolveMemberPath(root: string, memberPath: string): string {
  // memberPath might be "./burpanet" or "burpanet"
  const normalized = memberPath.startsWith("./")
    ? memberPath.slice(2)
    : memberPath;
  return join(root, normalized);
}

/**
 * Get a relative member path from absolute path
 */
export function relativeMemberPath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  return "./" + rel;
}

/**
 * Constants
 */
export const POLYGIT = {
  DIR: POLYGIT_DIR,
  WORKTREES_DIR,
  REF_FILE: POLYGIT_REF_FILE,
} as const;
