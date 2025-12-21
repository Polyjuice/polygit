import { command, positional, string } from "cmd-ts";
import { findPolygitRoot, resolveMemberPath } from "../core/paths.js";
import {
  readConfig,
  readState,
  writeState,
  createEmptyState,
  type MemberState,
} from "../core/config.js";
import {
  createBranch,
  branchExists,
  checkout as gitCheckout,
  getStatus,
  addAll,
  commit as gitCommit,
} from "../core/git-ops.js";

export const branchCommand = command({
  name: "branch",
  description: "Create a new polybranch (branch in .polygit and all members)",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name for the new branch",
    }),
  },
  handler: async ({ name: branchName }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    const config = await readConfig(root.polygitDir);
    if (!config) {
      console.error("Error: Could not read polygit config");
      process.exit(1);
    }

    // Check if branch already exists in .polygit
    if (await branchExists(root.polygitDir, branchName)) {
      console.error(`Error: Branch '${branchName}' already exists in .polygit`);
      process.exit(1);
    }

    console.log(`Creating polybranch '${branchName}'...`);

    // Create branch in .polygit first
    await createBranch(root.polygitDir, branchName);
    await gitCheckout(root.polygitDir, branchName);
    console.log(`  .polygit: created and checked out '${branchName}'`);

    // Create branch in each member
    const newState = createEmptyState();

    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);

      try {
        // Check if branch already exists in this member
        const exists = await branchExists(memberPath, branchName);

        if (exists) {
          // Branch exists, just checkout
          await gitCheckout(memberPath, branchName);
          console.log(`  ${member.path}: checked out existing '${branchName}'`);
        } else {
          // Create new branch at current HEAD
          await createBranch(memberPath, branchName);
          await gitCheckout(memberPath, branchName);
          console.log(`  ${member.path}: created and checked out '${branchName}'`);
        }

        // Record state
        const status = await getStatus(memberPath);
        const memberState: MemberState = {
          commit: status.commit,
          branch: status.branch,
        };
        newState.members[member.path] = memberState;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`  ${member.path}: ERROR - ${errorMessage}`);
      }
    }

    // Write state and commit to .polygit
    await writeState(root.polygitDir, newState);
    await addAll(root.polygitDir);

    try {
      await gitCommit(
        root.polygitDir,
        `Create polybranch '${branchName}'`
      );
    } catch {
      // Might be nothing to commit if state hasn't changed
    }

    console.log(`\nPolybranch '${branchName}' created`);
    console.log("All members are now on this branch");
  },
});
