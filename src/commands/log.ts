import { command, option, number, optional } from "cmd-ts";
import { findPolygitRoot } from "../core/paths.js";
import { log as gitLog } from "../core/git-ops.js";

export const logCommand = command({
  name: "log",
  description: "Show polycommit history",
  args: {
    count: option({
      type: optional(number),
      long: "count",
      short: "n",
      description: "Number of commits to show (default: 10)",
    }),
  },
  handler: async ({ count }) => {
    const root = await findPolygitRoot();

    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exit(1);
    }

    const entries = await gitLog(root.polygitDir, count ?? 10);

    if (entries.length === 0) {
      console.log("No polycommits yet");
      return;
    }

    for (const entry of entries) {
      const shortCommit = entry.commit.slice(0, 7);
      const date = new Date(entry.date).toLocaleString();

      console.log(`${shortCommit} ${entry.message}`);
      console.log(`  Author: ${entry.author}`);
      console.log(`  Date:   ${date}`);
      console.log("");
    }
  },
});
