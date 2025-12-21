import { command, positional, string, flag } from "cmd-ts";
import { findPolygitRoot, resolveMemberPath } from "../core/paths.js";
import { readConfig, type PolygitState } from "../core/config.js";
import {
  checkout as gitCheckout,
  isDirty,
  branchExists,
  showFileAtRef,
} from "../core/git-ops.js";

export const checkoutCommand = command({
  name: "checkout",
  description: "Checkout a polycommit or branch across all members",
  args: {
    ref: positional({
      type: string,
      displayName: "ref",
      description: "Branch name or commit to checkout",
    }),
    force: flag({
      long: "force",
      short: "f",
      description: "Force checkout even if members have uncommitted changes",
    }),
  },
  handler: async ({ ref, force }) => {
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

    // Check for dirty working directories
    if (!force) {
      const dirtyMembers: string[] = [];
      for (const member of config.members) {
        const memberPath = resolveMemberPath(root.root, member.path);
        if (await isDirty(memberPath)) {
          dirtyMembers.push(member.path);
        }
      }

      if (dirtyMembers.length > 0) {
        console.error("Error: The following members have uncommitted changes:");
        for (const m of dirtyMembers) {
          console.error(`  ${m}`);
        }
        console.error("\nCommit or stash your changes, or use --force to discard them");
        process.exit(1);
      }
    }

    // Get state.json from the target ref
    const stateJson = await showFileAtRef(root.polygitDir, ref, "state.json");
    if (!stateJson) {
      console.error(`Error: Could not find state.json at ref '${ref}'`);
      console.error("Make sure the ref exists and has a valid polygit state");
      process.exit(1);
    }

    let targetState: PolygitState;
    try {
      targetState = JSON.parse(stateJson);
    } catch {
      console.error("Error: Invalid state.json at target ref");
      process.exit(1);
    }

    // First, checkout .polygit to the target ref
    console.log(`Checking out .polygit to ${ref}...`);
    await gitCheckout(root.polygitDir, ref);

    // Now checkout each member
    console.log("\nChecking out members:");

    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);
      const memberState = targetState.members[member.path];

      if (!memberState) {
        console.log(`  ${member.path}: (not in recorded state, skipping)`);
        continue;
      }

      try {
        // If we have a branch and it exists, checkout the branch
        // Otherwise checkout the commit (detached HEAD)
        let checkoutTarget: string;
        if (memberState.branch && (await branchExists(memberPath, memberState.branch))) {
          checkoutTarget = memberState.branch;
        } else {
          checkoutTarget = memberState.commit;
        }

        await gitCheckout(memberPath, checkoutTarget);
        const shortCommit = memberState.commit.slice(0, 7);
        console.log(
          `  ${member.path}: ${shortCommit} (${memberState.branch ?? "detached"})`
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`  ${member.path}: ERROR - ${errorMessage}`);
      }
    }

    console.log("\nCheckout complete");
  },
});
