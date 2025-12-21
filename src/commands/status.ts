import { command } from "cmd-ts";
import { join } from "node:path";
import { findPolygitRoot, resolveMemberPath } from "../core/paths.js";
import { readConfig, readState } from "../core/config.js";
import { getStatus, getCurrentBranch, getHeadCommit } from "../core/git-ops.js";

export const statusCommand = command({
  name: "status",
  description: "Show the status of all member repositories",
  args: {},
  handler: async () => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      console.error("Run 'polygit init' to initialize one");
      process.exit(1);
    }

    const config = await readConfig(root.polygitDir);
    if (!config) {
      console.error("Error: Could not read polygit config");
      process.exit(1);
    }

    const state = await readState(root.polygitDir);

    // Show worktree info if applicable
    if (root.worktreeName) {
      console.log(`Worktree: ${root.worktreeName}`);
      console.log("");
    }

    // Show .polygit status
    try {
      const polygitBranch = await getCurrentBranch(root.polygitDir);
      const polygitCommit = await getHeadCommit(root.polygitDir);
      const shortCommit = polygitCommit.slice(0, 7);
      console.log(
        `.polygit: ${polygitBranch ?? "detached"} (${shortCommit})`
      );
    } catch {
      console.log(".polygit: (no commits yet)");
    }

    console.log("");

    // Show each member's status
    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);
      const recordedState = state?.members[member.path];

      try {
        const currentStatus = await getStatus(memberPath);
        const shortCommit = currentStatus.commit.slice(0, 7);
        const branchInfo = currentStatus.branch ?? "detached";

        // Check if matches recorded state
        let matchStatus = "";
        if (recordedState) {
          if (currentStatus.commit === recordedState.commit) {
            matchStatus = " - matches";
          } else {
            matchStatus = " - DIVERGED";
          }
        } else {
          matchStatus = " - (not recorded)";
        }

        // Check if dirty
        const dirtyStatus = currentStatus.isDirty ? " [dirty]" : "";

        console.log(
          `${member.path}: ${shortCommit} (${branchInfo})${dirtyStatus}${matchStatus}`
        );
      } catch (err) {
        console.log(`${member.path}: ERROR - could not read status`);
      }
    }

    if (config.members.length === 0) {
      console.log("No member repositories configured");
      console.log("Add git repositories to this directory and run 'polygit init' again");
    }
  },
});
