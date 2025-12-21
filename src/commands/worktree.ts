import {
  command,
  subcommands,
  positional,
  string,
  optional,
} from "cmd-ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  findPolygitRoot,
  resolveMemberPath,
  getWorktreesDir,
  getWorktreePath,
  POLYGIT,
} from "../core/paths.js";
import {
  readConfig,
  readWorktrees,
  writeWorktrees,
  type WorktreeInfo,
  type PolygitState,
} from "../core/config.js";
import {
  worktreeAdd as gitWorktreeAdd,
  worktreeRemove as gitWorktreeRemove,
  branchExists,
  createBranch,
  showFileAtRef,
} from "../core/git-ops.js";

// ============================================================================
// worktree add
// ============================================================================

const addCommand = command({
  name: "add",
  description: "Create a new worktree set for all members",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name for the worktree set",
    }),
    ref: positional({
      type: optional(string),
      displayName: "ref",
      description: "Branch or commit to checkout (defaults to current)",
    }),
  },
  handler: async ({ name: worktreeName, ref }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    // Can't create worktree from within a worktree
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

    // Check if worktree already exists
    if (worktrees.worktrees.some((w) => w.name === worktreeName)) {
      console.error(`Error: Worktree '${worktreeName}' already exists`);
      process.exit(1);
    }

    // Determine the target ref
    const targetRef = ref ?? "HEAD";

    // Get state for target ref (if specified)
    let targetState: PolygitState | null = null;
    if (ref) {
      const stateJson = await showFileAtRef(root.polygitDir, ref, "state.json");
      if (stateJson) {
        try {
          targetState = JSON.parse(stateJson);
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Create worktree directory
    const worktreePath = getWorktreePath(root.root, worktreeName);
    await mkdir(worktreePath, { recursive: true });

    console.log(`Creating worktree set '${worktreeName}'...`);

    // Create worktree for each member
    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);
      const memberName = member.path.replace("./", "");
      const memberWorktreePath = join(worktreePath, memberName);

      try {
        // Determine what to checkout for this member
        let checkoutRef = targetRef;

        if (targetState && targetState.members[member.path]) {
          const memberState = targetState.members[member.path];
          // Prefer branch if it exists
          if (memberState.branch && (await branchExists(memberPath, memberState.branch))) {
            checkoutRef = memberState.branch;
          } else {
            checkoutRef = memberState.commit;
          }
        } else if (ref) {
          // If ref is a branch name, try to use it
          if (await branchExists(memberPath, ref)) {
            checkoutRef = ref;
          } else {
            // Create the branch if it doesn't exist
            await createBranch(memberPath, ref);
            checkoutRef = ref;
          }
        }

        await gitWorktreeAdd(memberPath, memberWorktreePath, checkoutRef);
        console.log(`  ${member.path}: created at ${memberWorktreePath}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`  ${member.path}: ERROR - ${errorMessage}`);
      }
    }

    // Create .polygit-ref file pointing to main .polygit
    const refFilePath = join(worktreePath, POLYGIT.REF_FILE);
    await writeFile(refFilePath, root.polygitDir, "utf-8");

    // Record worktree in config
    const worktreeInfo: WorktreeInfo = {
      name: worktreeName,
      path: `.worktrees/${worktreeName}`,
      ref: targetRef,
      createdAt: new Date().toISOString(),
    };
    worktrees.worktrees.push(worktreeInfo);
    await writeWorktrees(root.polygitDir, worktrees);

    console.log(`\nWorktree set '${worktreeName}' created at ${worktreePath}`);
    console.log(`cd ${worktreePath} to work in this worktree`);
  },
});

// ============================================================================
// worktree list
// ============================================================================

const listCommand = command({
  name: "list",
  description: "List all worktree sets",
  args: {},
  handler: async () => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    // Use main .polygit even if in worktree
    const polygitDir = root.mainPolygitDir ?? root.polygitDir;
    const worktrees = await readWorktrees(polygitDir);

    if (worktrees.worktrees.length === 0) {
      console.log("No worktree sets");
      return;
    }

    console.log("Worktree sets:");
    for (const wt of worktrees.worktrees) {
      const date = new Date(wt.createdAt).toLocaleString();
      console.log(`  ${wt.name}: ${wt.path} (${wt.ref}) - created ${date}`);
    }
  },
});

// ============================================================================
// worktree remove
// ============================================================================

const removeCommand = command({
  name: "remove",
  description: "Remove a worktree set",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name of the worktree set to remove",
    }),
  },
  handler: async ({ name: worktreeName }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    // Can't remove worktree from within a worktree
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

    const worktreePath = getWorktreePath(root.root, worktreeName);

    console.log(`Removing worktree set '${worktreeName}'...`);

    // Remove worktree for each member
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

    // Remove worktree directory
    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Directory might already be gone
    }

    // Update worktrees config
    worktrees.worktrees = worktrees.worktrees.filter(
      (w) => w.name !== worktreeName
    );
    await writeWorktrees(root.polygitDir, worktrees);

    console.log(`\nWorktree set '${worktreeName}' removed`);
  },
});

// ============================================================================
// Export worktree subcommand
// ============================================================================

export const worktreeCommand = subcommands({
  name: "worktree",
  description: "Manage worktree sets",
  cmds: {
    add: addCommand,
    list: listCommand,
    remove: removeCommand,
  },
});
