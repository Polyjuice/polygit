import {
  command,
  subcommands,
  positional,
  string,
  optional,
  option,
  multioption,
  flag,
  oneOf,
  array,
  restPositionals,
} from "cmd-ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  findPolygitRoot,
  resolveMemberPath,
  getWorktreePath,
  POLYGIT,
} from "../core/paths.js";
import {
  readConfig,
  readWorktrees,
  writeWorktrees,
  isPreviewWorktree,
  type PreviewWorktreeInfo,
  type PreviewConfig,
  type MergeStrategy,
  type PreviewMemberOverride,
} from "../core/config.js";
import {
  worktreeAdd as gitWorktreeAdd,
  worktreeRemove as gitWorktreeRemove,
  branchExists,
} from "../core/git-ops.js";
import { updateMember } from "../core/preview.js";
import { createClaudeResolver } from "../core/claude-resolver.js";

// ============================================================================
// preview add
// ============================================================================

const addCommand = command({
  name: "add",
  description: "Create a preview worktree that merges feature branches onto a base",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name for the preview worktree",
    }),
    base: positional({
      type: string,
      displayName: "base",
      description: "Base branch for all members",
    }),
    features: restPositionals({
      type: string,
      displayName: "features",
      description: "Feature branches to merge",
    }),
    strategy: option({
      type: optional(oneOf(["rebase", "merge", "claude"])),
      long: "strategy",
      short: "s",
      description: "Merge strategy: rebase, merge, or claude (default: merge)",
    }),
    overrides: multioption({
      type: array(string),
      long: "override",
      short: "o",
      description: "Per-member override: 'member:base=branch,features=f1,f2'",
    }),
    uncommittedDefault: option({
      type: optional(oneOf(["include", "discard"])),
      long: "uncommitted",
      description: "Default behavior for uncommitted changes (default: include)",
    }),
  },
  handler: async ({ name: worktreeName, base, features, strategy, overrides, uncommittedDefault }) => {
    if (features.length === 0) {
      console.error("Error: At least one feature branch is required");
      console.error("Usage: polygit preview add <name> <base> <feature>...");
      process.exit(1);
    }

    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    if (root.worktreeName) {
      console.error("Error: Cannot create worktree from within a worktree");
      console.error("Run this command from the main polyrepo root");
      process.exit(1);
    }

    const config = await readConfig(root.polygitDir);
    if (!config) {
      console.error("Error: Could not read polygit config");
      process.exit(1);
    }

    const worktrees = await readWorktrees(root.polygitDir);

    if (worktrees.worktrees.some((w) => w.name === worktreeName)) {
      console.error(`Error: Worktree '${worktreeName}' already exists`);
      process.exit(1);
    }

    // Parse overrides
    const memberOverrides: Record<string, PreviewMemberOverride> = {};
    for (const override of overrides) {
      const colonIdx = override.indexOf(":");
      if (colonIdx === -1) {
        console.error(`Error: Invalid override format '${override}'`);
        console.error("Expected format: 'member:base=branch,features=f1,f2'");
        process.exit(1);
      }

      const memberPath = override.slice(0, colonIdx);
      const paramsStr = override.slice(colonIdx + 1);

      const parsed: PreviewMemberOverride = {};
      for (const param of paramsStr.split(",")) {
        const [key, value] = param.split("=");
        if (key === "base") {
          parsed.base = value;
        } else if (key === "features") {
          parsed.features = value ? value.split(",") : [];
        }
      }
      memberOverrides[memberPath.startsWith("./") ? memberPath : `./${memberPath}`] = parsed;
    }

    const previewConfig: PreviewConfig = {
      defaultBase: base,
      defaultFeatures: features,
      memberOverrides: Object.keys(memberOverrides).length > 0 ? memberOverrides : undefined,
      strategy: (strategy as MergeStrategy) ?? "merge",
      uncommittedDefault: (uncommittedDefault as "include" | "discard") ?? "include",
    };

    const worktreePath = getWorktreePath(root.root, worktreeName);
    await mkdir(worktreePath, { recursive: true });

    console.log(`Creating preview worktree '${worktreeName}'...`);
    console.log(`  Base: ${base}`);
    console.log(`  Features: ${features.join(", ")}`);
    console.log(`  Strategy: ${previewConfig.strategy}`);

    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);
      const memberName = member.path.replace("./", "");
      const memberWorktreePath = join(worktreePath, memberName);

      try {
        if (!(await branchExists(memberPath, base))) {
          console.error(`Error: ${member.path} does not have base branch '${base}'`);
          await rm(worktreePath, { recursive: true, force: true });
          process.exit(1);
        }

        await gitWorktreeAdd(memberPath, memberWorktreePath, base);
        console.log(`  ${member.path}: created worktree`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`  ${member.path}: ERROR - ${errorMessage}`);
        await rm(worktreePath, { recursive: true, force: true });
        process.exit(1);
      }
    }

    const refFilePath = join(worktreePath, POLYGIT.REF_FILE);
    await writeFile(refFilePath, root.polygitDir, "utf-8");

    const worktreeInfo: PreviewWorktreeInfo = {
      name: worktreeName,
      path: `.worktrees/${worktreeName}`,
      ref: base,
      createdAt: new Date().toISOString(),
      type: "preview",
      preview: previewConfig,
    };
    worktrees.worktrees.push(worktreeInfo);
    await writeWorktrees(root.polygitDir, worktrees);

    console.log(`\nPreview worktree '${worktreeName}' created at ${worktreePath}`);

    console.log("\nPerforming initial merge of feature branches...");

    const resolveConflicts = previewConfig.strategy === "claude" ? createClaudeResolver() : undefined;

    for (const member of config.members) {
      console.log(`\n${member.path}:`);
      const result = await updateMember(
        worktreePath,
        member.path,
        previewConfig,
        { strategy: previewConfig.strategy },
        resolveConflicts
      );

      if (result.success) {
        if (result.appliedFeatures.length > 0) {
          console.log(`  Applied: ${result.appliedFeatures.join(", ")}`);
        }
        if (result.skippedFeatures.length > 0) {
          console.log(`  Skipped (no branch): ${result.skippedFeatures.join(", ")}`);
        }
      } else {
        console.error(`  Failed: ${result.error}`);
        if (result.conflicts.length > 0) {
          console.error(`  Conflicts in: ${result.conflicts.join(", ")}`);
        }
      }
    }

    console.log(`\ncd ${worktreePath} to work in this preview worktree`);
    console.log("Run 'polygit preview update' to refresh the merged state");
  },
});

// ============================================================================
// preview list
// ============================================================================

const listCommand = command({
  name: "list",
  description: "List all preview worktrees",
  args: {},
  handler: async () => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    const polygitDir = root.mainPolygitDir ?? root.polygitDir;
    const worktrees = await readWorktrees(polygitDir);

    const previews = worktrees.worktrees.filter(isPreviewWorktree);

    if (previews.length === 0) {
      console.log("No preview worktrees");
      return;
    }

    console.log("Preview worktrees:");
    for (const wt of previews) {
      const date = new Date(wt.createdAt).toLocaleString();
      console.log(`  ${wt.name}: ${wt.path}`);
      console.log(`    Base: ${wt.preview.defaultBase}`);
      console.log(`    Features: ${wt.preview.defaultFeatures.join(", ")}`);
      console.log(`    Strategy: ${wt.preview.strategy}`);
      console.log(`    Created: ${date}`);
    }
  },
});

// ============================================================================
// preview update
// ============================================================================

const updateCommand = command({
  name: "update",
  description: "Update a preview worktree by re-merging feature branches",
  args: {
    name: positional({
      type: optional(string),
      displayName: "name",
      description: "Name of the preview worktree (optional if inside one)",
    }),
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
  handler: async ({ name: worktreeName, strategy, noUncommitted, uncommitted, uncommittedFor, dryRun }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    // Determine which worktree to update
    const targetName = worktreeName ?? root.worktreeName;
    if (!targetName) {
      console.error("Error: Must specify a preview worktree name or run from within one");
      console.error("Usage: polygit preview update <name>");
      process.exit(1);
    }

    const polygitDir = root.mainPolygitDir ?? root.polygitDir;
    const worktrees = await readWorktrees(polygitDir);
    const worktreeInfo = worktrees.worktrees.find((w) => w.name === targetName);

    if (!worktreeInfo) {
      console.error(`Error: Could not find worktree '${targetName}' in config`);
      process.exit(1);
    }

    if (!isPreviewWorktree(worktreeInfo)) {
      console.error(`Error: '${targetName}' is not a preview worktree`);
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
      includeUncommitted = "none";
    } else if (uncommitted) {
      includeUncommitted = "all";
    } else if (uncommittedFor.length > 0) {
      includeUncommitted = uncommittedFor.map((m: string) =>
        m.startsWith("./") ? m : `./${m}`
      );
    } else {
      includeUncommitted = previewConfig.uncommittedDefault === "include" ? "all" : "none";
    }

    const effectiveStrategy = (strategy as MergeStrategy) ?? previewConfig.strategy;

    // Determine the worktree path
    const mainRoot = root.mainPolygitDir ? join(root.mainPolygitDir, "..") : root.root;
    const worktreePath = getWorktreePath(mainRoot, targetName);

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

    console.log(`Updating preview worktree '${targetName}'...`);
    console.log(`  Strategy: ${effectiveStrategy}`);

    const resolveConflicts = effectiveStrategy === "claude" ? createClaudeResolver() : undefined;

    let allSuccess = true;

    for (const member of config.members) {
      console.log(`\n${member.path}:`);
      const result = await updateMember(
        worktreePath,
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

// ============================================================================
// preview remove
// ============================================================================

const removeCommand = command({
  name: "remove",
  description: "Remove a preview worktree",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name of the preview worktree to remove",
    }),
  },
  handler: async ({ name: worktreeName }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    if (root.worktreeName) {
      console.error("Error: Cannot remove worktree from within a worktree");
      console.error("Run this command from the main polyrepo root");
      process.exit(1);
    }

    const config = await readConfig(root.polygitDir);
    if (!config) {
      console.error("Error: Could not read polygit config");
      process.exit(1);
    }

    const worktrees = await readWorktrees(root.polygitDir);
    const worktreeInfo = worktrees.worktrees.find((w) => w.name === worktreeName);

    if (!worktreeInfo) {
      console.error(`Error: Worktree '${worktreeName}' not found`);
      process.exit(1);
    }

    if (!isPreviewWorktree(worktreeInfo)) {
      console.error(`Error: '${worktreeName}' is not a preview worktree`);
      console.error("Use 'polygit worktree remove' for regular worktrees");
      process.exit(1);
    }

    const worktreePath = getWorktreePath(root.root, worktreeName);

    console.log(`Removing preview worktree '${worktreeName}'...`);

    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);
      const memberName = member.path.replace("./", "");
      const memberWorktreePath = join(worktreePath, memberName);

      try {
        await gitWorktreeRemove(memberPath, memberWorktreePath);
        console.log(`  ${member.path}: removed`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`  ${member.path}: ERROR - ${errorMessage}`);
      }
    }

    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Directory might already be gone
    }

    worktrees.worktrees = worktrees.worktrees.filter(
      (w) => w.name !== worktreeName
    );
    await writeWorktrees(root.polygitDir, worktrees);

    console.log(`\nPreview worktree '${worktreeName}' removed`);
  },
});

// ============================================================================
// Export preview subcommand
// ============================================================================

export const previewCommand = subcommands({
  name: "preview",
  description: "Manage preview worktrees",
  cmds: {
    add: addCommand,
    list: listCommand,
    update: updateCommand,
    remove: removeCommand,
  },
});
