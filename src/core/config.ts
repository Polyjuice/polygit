import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getConfigPaths } from "./paths.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a member repository
 */
export interface MemberConfig {
  /** Relative path from polyrepo root, e.g., "./burpanet" */
  path: string;
  /** Git remote URL (optional, used for clone) */
  remote?: string;
}

/**
 * Static configuration for the polyrepo (config.json)
 */
export interface PolygitConfig {
  /** Name of this polyrepo */
  name: string;
  /** List of member repositories */
  members: MemberConfig[];
}

/**
 * State of a single member repository
 */
export interface MemberState {
  /** Full commit SHA (for verification/fallback) */
  commit: string;
  /** Branch name if on a branch, null if detached HEAD */
  branch: string | null;
}

/**
 * Current state of all member repositories (state.json)
 */
export interface PolygitState {
  /** Map of member path to state */
  members: Record<string, MemberState>;
}

/**
 * Information about a worktree set
 */
export interface WorktreeInfo {
  /** Worktree name, e.g., "foobar" */
  name: string;
  /** Relative path from polyrepo root, e.g., ".worktrees/foobar" */
  path: string;
  /** Branch or commit ref when created */
  ref: string;
  /** ISO timestamp when created */
  createdAt: string;
}

/**
 * Configuration for worktree sets (worktrees.json)
 */
export interface WorktreesConfig {
  /** List of worktree sets (regular and preview) */
  worktrees: (WorktreeInfo | PreviewWorktreeInfo)[];
}

// ============================================================================
// Preview Worktree Types
// ============================================================================

/**
 * Merge strategy for preview worktrees
 */
export type MergeStrategy = "rebase" | "merge" | "claude";

/**
 * Per-member override for preview worktrees
 */
export interface PreviewMemberOverride {
  /** Override base branch for this member */
  base?: string;
  /** Override features for this member (empty array = no features) */
  features?: string[];
}

/**
 * Configuration for a preview worktree
 */
export interface PreviewConfig {
  /** Default base branch for all members */
  defaultBase: string;
  /** Default feature branches for all members */
  defaultFeatures: string[];
  /** Per-member overrides */
  memberOverrides?: Record<string, PreviewMemberOverride>;
  /** Merge strategy */
  strategy: MergeStrategy;
  /** Default behavior for uncommitted changes */
  uncommittedDefault: "include" | "discard";
}

/**
 * Extended worktree info for preview worktrees
 */
export interface PreviewWorktreeInfo extends WorktreeInfo {
  /** Type discriminator */
  type: "preview";
  /** Preview configuration */
  preview: PreviewConfig;
}

/**
 * Type guard to check if a worktree is a preview worktree
 */
export function isPreviewWorktree(
  wt: WorktreeInfo | PreviewWorktreeInfo
): wt is PreviewWorktreeInfo {
  return "type" in wt && wt.type === "preview";
}

// ============================================================================
// JSON I/O
// ============================================================================

/**
 * Read and parse a JSON file
 */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Write an object as JSON to a file
 */
async function writeJson<T>(path: string, data: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, content, "utf-8");
}

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Read the polyrepo configuration
 */
export async function readConfig(
  polygitDir: string
): Promise<PolygitConfig | null> {
  const paths = getConfigPaths(polygitDir);
  return readJson<PolygitConfig>(paths.config);
}

/**
 * Write the polyrepo configuration
 */
export async function writeConfig(
  polygitDir: string,
  config: PolygitConfig
): Promise<void> {
  const paths = getConfigPaths(polygitDir);
  await writeJson(paths.config, config);
}

/**
 * Read the current state
 */
export async function readState(
  polygitDir: string
): Promise<PolygitState | null> {
  const paths = getConfigPaths(polygitDir);
  return readJson<PolygitState>(paths.state);
}

/**
 * Write the current state
 */
export async function writeState(
  polygitDir: string,
  state: PolygitState
): Promise<void> {
  const paths = getConfigPaths(polygitDir);
  await writeJson(paths.state, state);
}

/**
 * Read worktrees configuration
 */
export async function readWorktrees(
  polygitDir: string
): Promise<WorktreesConfig> {
  const paths = getConfigPaths(polygitDir);
  const config = await readJson<WorktreesConfig>(paths.worktrees);
  return config ?? { worktrees: [] };
}

/**
 * Write worktrees configuration
 */
export async function writeWorktrees(
  polygitDir: string,
  config: WorktreesConfig
): Promise<void> {
  const paths = getConfigPaths(polygitDir);
  await writeJson(paths.worktrees, config);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create an empty/default config
 */
export function createDefaultConfig(name: string): PolygitConfig {
  return {
    name,
    members: [],
  };
}

/**
 * Create an empty state
 */
export function createEmptyState(): PolygitState {
  return {
    members: {},
  };
}
