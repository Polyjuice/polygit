import { command, flag, multioption, option, optional, oneOf, string, array } from "cmd-ts";
import { findPolygitRoot } from "../core/paths.js";
import {
  readConfig,
  readWorktrees,
  isPreviewWorktree,
  type MergeStrategy,
} from "../core/config.js";
import { updateMember } from "../core/preview.js";
import { createClaudeResolver } from "../core/claude-resolver.js";

// ============================================================================
// polygit update
// ============================================================================

export const updateCommand = command({
  name: "update",
  description: "Update the current preview worktree by re-merging feature branches",
  args: {
    strategy: option({
      type: optional(oneOf(["rebase", "merge", "claude"])),
      long: "strategy",
      short: "s",
      description: "Override merge strategy",
    }),
    noUncommitted: flag({
      long: "no-uncommitted",
      description: "Discard all uncommitted changes",
    }),
    uncommitted: flag({
      long: "uncommitted",
      description: "Include all uncommitted changes",
    }),
    uncommittedExcept: multioption({
      type: array(string),
      long: "no-uncommitted-except",
      description: "Discard uncommitted except for specified members",
    }),
    uncommittedFor: multioption({
      type: array(string),
      long: "uncommitted-for",
      description: "Include uncommitted only for specified members",
    }),
    dryRun: flag({
      long: "dry-run",
      description: "Show what would be merged without making changes",
    }),
  },
  handler: async ({ strategy, noUncommitted, uncommitted, uncommittedExcept, uncommittedFor, dryRun }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    // Must be in a worktree
    if (!root.worktreeName) {
      console.error("Error: Must be run from within a preview worktree");
      console.error("Use 'polygit worktree add-preview' to create one");
      process.exit(1);
    }

    // Get the worktree config
    const polygitDir = root.mainPolygitDir ?? root.polygitDir;
    const worktrees = await readWorktrees(polygitDir);
    const worktreeInfo = worktrees.worktrees.find((w) => w.name === root.worktreeName);

    if (!worktreeInfo) {
      console.error(`Error: Could not find worktree '${root.worktreeName}' in config`);
      process.exit(1);
    }

    if (!isPreviewWorktree(worktreeInfo)) {
      console.error("Error: This is not a preview worktree");
      console.error("The 'update' command only works with preview worktrees");
      process.exit(1);
    }

    const config = await readConfig(polygitDir);
    if (!config) {
      console.error("Error: Could not read polygit config");
      process.exit(1);
    }

    const previewConfig = worktreeInfo.preview;

    // Determine uncommitted behavior
    let includeUncommitted: string[] | "all" | "none";
    if (noUncommitted) {
      if (uncommittedExcept.length > 0) {
        // No uncommitted except for specific members
        includeUncommitted = uncommittedExcept.map((m: string) =>
          m.startsWith("./") ? m : `./${m}`
        );
      } else {
        includeUncommitted = "none";
      }
    } else if (uncommitted) {
      includeUncommitted = "all";
    } else if (uncommittedFor.length > 0) {
      includeUncommitted = uncommittedFor.map((m: string) =>
        m.startsWith("./") ? m : `./${m}`
      );
    } else {
      // Use default from config
      includeUncommitted = previewConfig.uncommittedDefault === "include" ? "all" : "none";
    }

    const effectiveStrategy = (strategy as MergeStrategy) ?? previewConfig.strategy;

    if (dryRun) {
      console.log("Dry run - showing what would be merged:\n");
      console.log(`Base: ${previewConfig.defaultBase}`);
      console.log(`Features: ${previewConfig.defaultFeatures.join(", ")}`);
      console.log(`Strategy: ${effectiveStrategy}`);
      console.log(`Uncommitted: ${typeof includeUncommitted === "string" ? includeUncommitted : includeUncommitted.join(", ")}`);
      if (previewConfig.memberOverrides) {
        console.log("\nMember overrides:");
        for (const [member, override] of Object.entries(previewConfig.memberOverrides)) {
          const parts: string[] = [];
          if (override.base) parts.push(`base=${override.base}`);
          if (override.features) parts.push(`features=${override.features.join(",")}`);
          console.log(`  ${member}: ${parts.join(", ")}`);
        }
      }
      return;
    }

    console.log(`Updating preview worktree '${root.worktreeName}'...`);
    console.log(`  Strategy: ${effectiveStrategy}`);

    const resolveConflicts = effectiveStrategy === "claude" ? createClaudeResolver() : undefined;

    let allSuccess = true;

    for (const member of config.members) {
      console.log(`\n${member.path}:`);
      const result = await updateMember(
        root.root,
        member.path,
        previewConfig,
        {
          strategy: effectiveStrategy,
          includeUncommitted,
          dryRun,
        },
        resolveConflicts
      );

      if (result.success) {
        console.log(`  Base: ${result.base}`);
        if (result.appliedFeatures.length > 0) {
          console.log(`  Applied: ${result.appliedFeatures.join(", ")}`);
        }
        if (result.skippedFeatures.length > 0) {
          console.log(`  Skipped (no branch): ${result.skippedFeatures.join(", ")}`);
        }
      } else {
        allSuccess = false;
        console.error(`  Failed: ${result.error}`);
        if (result.conflicts.length > 0) {
          console.error(`  Conflicts in: ${result.conflicts.join(", ")}`);
        }
      }
    }

    if (allSuccess) {
      console.log("\nUpdate complete.");
    } else {
      console.log("\nUpdate completed with errors.");
      process.exit(1);
    }
  },
});
