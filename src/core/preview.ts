import { resolveMemberPath } from "./paths.js";
import {
  type PreviewConfig,
  type MergeStrategy,
} from "./config.js";
import {
  git,
  gitOrFail,
  branchExists,
  isDirty,
} from "./git-ops.js";

// ============================================================================
// Types
// ============================================================================

export interface MemberPreviewResult {
  memberPath: string;
  success: boolean;
  base: string;
  features: string[];
  appliedFeatures: string[];
  skippedFeatures: string[];
  conflicts: string[];
  error?: string;
}

export interface PreviewUpdateResult {
  success: boolean;
  members: MemberPreviewResult[];
}

export interface UpdateOptions {
  /** Override the merge strategy */
  strategy?: MergeStrategy;
  /** Members to include uncommitted changes for (null = use config default) */
  includeUncommitted?: string[] | "all" | "none";
  /** Dry run - don't actually perform the merge */
  dryRun?: boolean;
}

// ============================================================================
// Preview Update Logic
// ============================================================================

/**
 * Get the effective base and features for a member
 */
export function getMemberPreviewConfig(
  memberPath: string,
  config: PreviewConfig
): { base: string; features: string[] } {
  const override = config.memberOverrides?.[memberPath];
  return {
    base: override?.base ?? config.defaultBase,
    features: override?.features ?? config.defaultFeatures,
  };
}

/**
 * Determine if uncommitted changes should be preserved for a member
 */
export function shouldIncludeUncommitted(
  memberPath: string,
  config: PreviewConfig,
  options: UpdateOptions
): boolean {
  if (options.includeUncommitted === "all") {
    return true;
  }
  if (options.includeUncommitted === "none") {
    return false;
  }
  if (Array.isArray(options.includeUncommitted)) {
    return options.includeUncommitted.includes(memberPath);
  }
  // Use config default
  return config.uncommittedDefault === "include";
}

/**
 * Stash uncommitted changes
 */
export async function stashChanges(
  repoPath: string
): Promise<string | null> {
  const dirty = await isDirty(repoPath);
  if (!dirty) {
    return null;
  }
  await gitOrFail(["stash", "push", "-u", "-m", "polygit-preview-stash"], repoPath);
  return gitOrFail(["rev-parse", "refs/stash"], repoPath);
}

/**
 * Pop stashed changes
 */
export async function popStash(repoPath: string, stash: string): Promise<void> {
  // Apply the captured object, not whichever worktree last wrote stash@{0}.
  // Failed application deliberately leaves the recovery stash intact.
  await gitOrFail(["stash", "apply", stash], repoPath);
  const entries = await gitOrFail(["stash", "list", "--format=%H %gd"], repoPath);
  const entry = entries.split("\n").find((line) => line.startsWith(`${stash} `));
  if (entry) await gitOrFail(["stash", "drop", entry.split(" ")[1]], repoPath);
}

/**
 * Reset member to base branch
 */
export async function resetToBase(
  repoPath: string,
  base: string
): Promise<void> {
  // Fetch to make sure we have latest
  await gitOrFail(["fetch", "--all"], repoPath);
  const baseCommit = await gitOrFail(
    ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], repoPath,
  );
  // Rebuild on detached HEAD. Branch refs are shared with the source workspace.
  await gitOrFail(["checkout", "--detach", "--force", baseCommit, "--"], repoPath);
}

/**
 * Merge a feature branch using the specified strategy
 */
export async function mergeFeature(
  repoPath: string,
  feature: string,
  strategy: MergeStrategy
): Promise<{ success: boolean; conflicts: string[] }> {
  if (strategy === "rebase") {
    const result = await git(["rebase", feature], repoPath);
    if (result.exitCode !== 0) {
      // Abort rebase on failure
      await git(["rebase", "--abort"], repoPath);
      return { success: false, conflicts: [result.stderr] };
    }
    return { success: true, conflicts: [] };
  }

  // merge or claude strategy - start with regular merge
  const result = await git(["merge", "--no-ff", "-m", `Merge ${feature}`, feature], repoPath);

  if (result.exitCode === 0) {
    return { success: true, conflicts: [] };
  }

  // Check for conflicts
  const statusResult = await git(["status", "--porcelain"], repoPath);
  const conflictFiles = statusResult.stdout
    .split("\n")
    .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
    .map((line) => line.slice(3));

  if (conflictFiles.length > 0) {
    return { success: false, conflicts: conflictFiles };
  }

  // Some other error
  await git(["merge", "--abort"], repoPath);
  return { success: false, conflicts: [result.stderr] };
}

/**
 * Update a single member in a preview worktree
 */
export async function updateMember(
  root: string,
  memberPath: string,
  config: PreviewConfig,
  options: UpdateOptions,
  resolveConflicts?: (repoPath: string, conflicts: string[]) => Promise<boolean>
): Promise<MemberPreviewResult> {
  const repoPath = resolveMemberPath(root, memberPath);
  const { base, features } = getMemberPreviewConfig(memberPath, config);
  const strategy = options.strategy ?? config.strategy;

  const result: MemberPreviewResult = {
    memberPath,
    success: false,
    base,
    features,
    appliedFeatures: [],
    skippedFeatures: [],
    conflicts: [],
  };

  let stashed: string | null = null;
  try {
    // Stash if needed
    const includeUncommitted = shouldIncludeUncommitted(memberPath, config, options);
    if (includeUncommitted) {
      stashed = await stashChanges(repoPath);
    }

    // Reset to base
    await resetToBase(repoPath, base);

    // Merge each feature
    for (const feature of features) {
      // Check if feature branch exists
      if (!(await branchExists(repoPath, feature))) {
        console.log(`  Warning: ${memberPath} does not have branch '${feature}', skipping`);
        result.skippedFeatures.push(feature);
        continue;
      }

      const mergeResult = await mergeFeature(repoPath, feature, strategy);

      if (mergeResult.success) {
        result.appliedFeatures.push(feature);
      } else if (strategy === "claude" && resolveConflicts) {
        // Try Claude resolution
        const resolved = await resolveConflicts(repoPath, mergeResult.conflicts);
        if (resolved) {
          result.appliedFeatures.push(feature);
        } else {
          result.conflicts.push(...mergeResult.conflicts);
          // Abort and stop
          await git(["merge", "--abort"], repoPath);
          result.error = `Failed to resolve conflicts in ${feature}`;
          break;
        }
      } else {
        result.conflicts.push(...mergeResult.conflicts);
        result.error = `Merge conflict in ${feature}`;
        break;
      }
    }

    if (result.error) {
      if (stashed) result.error += `; local edits preserved in stash ${stashed} (git stash apply ${stashed})`;
      return result;
    }

    // Pop stash if we stashed
    if (stashed) {
      await popStash(repoPath, stashed);
      stashed = null;
    }

    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    if (stashed) result.error += `; local edits preserved in stash ${stashed} (git stash apply ${stashed})`;
  }

  return result;
}
