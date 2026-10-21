import { command, option, string, optional } from "cmd-ts";
import { findPolygitRoot, resolveMemberPath } from "../core/paths.js";
import {
  readConfig,
  readState,
  writeState,
  createEmptyState,
  type MemberState,
} from "../core/config.js";
import {
  getStatus,
  addAll,
  commit as gitCommit,
} from "../core/git-ops.js";

export const commitCommand = command({
  name: "commit",
  description: "Create a polycommit (snapshot current state of all members)",
  args: {
    message: option({
      type: optional(string),
      long: "message",
      short: "m",
      description: "Commit message",
    }),
  },
  handler: async ({ message }) => {
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

    const previousState = await readState(root.polygitDir);
    const newState = createEmptyState();

    console.log("Capturing state of all members...");

    const changes: string[] = [];
    let captureFailed = false;

    for (const member of config.members) {
      const memberPath = resolveMemberPath(root.root, member.path);

      try {
        const status = await getStatus(memberPath);
        const memberState: MemberState = {
          commit: status.commit,
          branch: status.branch,
        };
        newState.members[member.path] = memberState;

        // Check if changed from previous state
        const prevMember = previousState?.members[member.path];
        if (!prevMember || prevMember.commit !== status.commit) {
          const shortCommit = status.commit.slice(0, 7);
          changes.push(
            `  ${member.path}: ${shortCommit} (${status.branch ?? "detached"})`
          );
        }
      } catch (err) {
        captureFailed = true;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Could not get status of ${member.path}: ${message}`);
      }
    }

    // Do not replace the last complete manifest with a partial capture.
    if (captureFailed) {
      console.error("Snapshot not created; previous state preserved.");
      process.exitCode = 1;
      return;
    }

    // Write new state
    await writeState(root.polygitDir, newState);

    // Generate commit message if not provided
    const commitMessage =
      message ?? `Polycommit: ${new Date().toISOString().slice(0, 19)}`;

    // Commit to .polygit
    await addAll(root.polygitDir);

    try {
      const commitHash = await gitCommit(root.polygitDir, commitMessage);
      const shortHash = commitHash.slice(0, 7);

      console.log(`\nPolycommit created: ${shortHash}`);
      console.log(`Message: ${commitMessage}`);

      if (changes.length > 0) {
        console.log("\nChanged members:");
        for (const change of changes) {
          console.log(change);
        }
      } else {
        console.log("\nNo changes from previous state");
      }
    } catch (err) {
      // Check if it's "nothing to commit"
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("nothing to commit")) {
        console.log("\nNo changes to commit");
      } else {
        throw err;
      }
    }
  },
});
