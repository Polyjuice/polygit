import { command, positional, string, flag } from "cmd-ts";
import { findPolygitRoot, resolveMemberPath } from "../core/paths.js";
import type { PolygitConfig, PolygitState } from "../core/config.js";
import {
  checkout as gitCheckout,
  isDirty,
  branchExists,
  showFileAtRef,
  resolveRef,
  getStatus,
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
      description: "Discard conflicting tracked changes during checkout",
    }),
  },
  handler: async ({ ref, force }) => {
    const root = await findPolygitRoot();
    if (!root) {
      console.error("Error: Not in a polygit repository");
      process.exitCode = 1;
      return;
    }

    // Resolve once so both configuration and state come from the same snapshot.
    const snapshot = await resolveRef(root.polygitDir, ref);
    if (!snapshot) {
      console.error(`Error: Could not resolve '${ref}' to a polycommit`);
      process.exitCode = 1;
      return;
    }
    const [configJson, stateJson] = await Promise.all([
      showFileAtRef(root.polygitDir, snapshot, "config.json"),
      showFileAtRef(root.polygitDir, snapshot, "state.json"),
    ]);
    let config: PolygitConfig;
    let state: PolygitState;
    try {
      if (!configJson || !stateJson) throw new Error("Missing configuration or state");
      config = JSON.parse(configJson);
      state = JSON.parse(stateJson);
      if (
        !config || !Array.isArray(config.members) || !state?.members ||
        typeof state.members !== "object" || Array.isArray(state.members)
      ) {
        throw new Error("Invalid configuration or state");
      }
    } catch (error) {
      console.error(`Error: Invalid snapshot '${ref}': ${error}`);
      process.exitCode = 1;
      return;
    }

    // Named polybranches follow development branches; all other refs restore SHAs.
    const branchName = ref.replace(/^refs\/heads\//, "");
    const isPolybranch = await branchExists(root.polygitDir, branchName);
    const plan: { path: string; name: string; target: string; detach: boolean }[] = [];
    let preflightFailed = false;
    for (const member of config.members) {
      try {
        if (!member || typeof member.path !== "string") throw new Error("Invalid member path");
        const saved = state.members[member.path];
        if (
          !saved || typeof saved.commit !== "string" ||
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(saved.commit) ||
          !(saved.branch === null || typeof saved.branch === "string")
        ) {
          throw new Error("Missing or invalid recorded state");
        }
        const path = resolveMemberPath(root.root, member.path);
        if (!force && await isDirty(path)) {
          throw new Error("Uncommitted changes: commit or stash them, or use --force for tracked changes");
        }
        const useBranch = isPolybranch && saved.branch !== null && await branchExists(path, saved.branch);
        const target = useBranch ? saved.branch! : saved.commit;
        if (!(await resolveRef(path, target))) throw new Error(`Commit or branch '${target}' is unavailable`);
        plan.push({ path, name: member.path, target, detach: !useBranch });
      } catch (error) {
        preflightFailed = true;
        console.error(`  ${member?.path ?? "(invalid member)"}: ERROR - ${error}`);
      }
    }
    if (preflightFailed) {
      console.error("Checkout not started; resolve the member errors first.");
      process.exitCode = 1;
      return;
    }

    console.log(`Checking out .polygit to ${ref}...`);
    await gitCheckout(root.polygitDir, isPolybranch ? branchName : snapshot, { detach: !isPolybranch });
    console.log("\nChecking out members:");
    let failed = false;
    for (const member of plan) {
      try {
        await gitCheckout(member.path, member.target, { force, detach: member.detach });
        const actual = await getStatus(member.path);
        console.log(`  ${member.name}: ${actual.commit.slice(0, 7)} (${actual.branch ?? "detached"})`);
      } catch (error) {
        failed = true;
        console.error(`  ${member.name}: ERROR - ${error}`);
      }
    }
    if (failed) {
      console.error("Checkout failed for some members; other members may have switched. Run 'polygit status' to inspect.");
      process.exitCode = 1;
      return;
    }
    console.log("\nCheckout complete");
  },
});
