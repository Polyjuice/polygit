import { command, positional, string } from "cmd-ts";
import { changeMembership } from "../core/membership.js";
import { findPolygitRoot } from "../core/paths.js";

function membershipCommand(action: "link" | "unlink") {
  return command({
    name: action,
    description: action === "link"
      ? "Register an existing repository as a member without moving its files"
      : "Remove a member registration without deleting its repository",
    args: {
      path: positional({
        type: string,
        displayName: "path",
        description: "Member path relative to the polyrepo root (or an absolute path inside it)",
      }),
    },
    handler: async ({ path }) => {
      try {
        const root = await findPolygitRoot();
        if (!root) throw new Error("Not in a polygit repository");
        const name = await changeMembership(root, path, action);
        console.log(`${action === "link" ? "Linked" : "Unlinked"} ${name}. Repository files are unchanged.`);
        console.log("Membership metadata updated. Run 'pgit commit' to record this change.");
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    },
  });
}

export const linkCommand = membershipCommand("link");
export const unlinkCommand = membershipCommand("unlink");
