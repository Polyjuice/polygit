import { command, positional, string, flag } from "cmd-ts";
import { findPolygitRoot } from "../core/paths.js";
import { restoreWorkspace } from "../core/restore.js";

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
      description: "Discard conflicting tracked changes during checkout",
    }),
    offline: flag({
      long: "offline",
      description: "Use only existing repositories and local commits; do not clone or fetch",
    }),
  },
  handler: async ({ ref, force, offline }) => {
    const root = await findPolygitRoot();
    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exitCode = 1;
      return;
    }
    try {
      if (!(await restoreWorkspace(root, ref, { force, offline }))) {
        process.exitCode = 1;
        return;
      }
      console.log("\nCheckout complete");
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exitCode = 1;
    }
  },
});
