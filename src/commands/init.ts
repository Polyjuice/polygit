import { command, option, string, optional } from "cmd-ts";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { POLYGIT, findPolygitRoot } from "../core/paths.js";
import {
  writeConfig,
  writeState,
  createDefaultConfig,
  createEmptyState,
  type MemberConfig,
  type MemberState,
} from "../core/config.js";
import {
  isGitRepo,
  init as gitInit,
  addAll,
  commit as gitCommit,
  getStatus,
  getRemoteUrl,
} from "../core/git-ops.js";

export const initCommand = command({
  name: "init",
  description: "Initialize a new polygit polyrepo in the current directory",
  args: {
    name: option({
      type: optional(string),
      long: "name",
      short: "n",
      description: "Name for this polyrepo (defaults to directory name)",
    }),
  },
  handler: async ({ name }) => {
    const cwd = process.cwd();

    // Check if already initialized
    const existing = await findPolygitRoot(cwd);
    if (existing && existing.root === cwd) {
      console.error("Error: polygit already initialized in this directory");
      process.exit(1);
    }

    const polyrepoName = name ?? basename(cwd);
    const polygitDir = join(cwd, POLYGIT.DIR);

    console.log(`Initializing polygit in ${cwd}...`);

    // Create .polygit directory
    await mkdir(polygitDir, { recursive: true });

    // Initialize git repo in .polygit
    await gitInit(polygitDir);

    // Scan for member repos
    const members: MemberConfig[] = [];
    const entries = await readdir(cwd);

    for (const entry of entries) {
      // Skip hidden directories and common non-repo directories
      if (entry.startsWith(".") || entry === "node_modules") {
        continue;
      }

      const entryPath = join(cwd, entry);
      const entryStat = await stat(entryPath);

      if (!entryStat.isDirectory()) {
        continue;
      }

      // Check if it's a git repo
      if (await isGitRepo(entryPath)) {
        const remote = await getRemoteUrl(entryPath);
        const memberConfig: MemberConfig = {
          path: `./${entry}`,
        };
        if (remote) {
          memberConfig.remote = remote;
        }
        members.push(memberConfig);
        console.log(`  Found member: ${entry}${remote ? ` (${remote})` : ""}`);
      }
    }

    if (members.length === 0) {
      console.log("  No git repositories found in subdirectories");
    }

    // Create config
    const config = createDefaultConfig(polyrepoName);
    config.members = members;
    await writeConfig(polygitDir, config);

    // Get current state of all members
    const state = createEmptyState();
    for (const member of members) {
      const memberPath = join(cwd, member.path.slice(2));
      try {
        const status = await getStatus(memberPath);
        const memberState: MemberState = {
          commit: status.commit,
          branch: status.branch,
        };
        state.members[member.path] = memberState;
      } catch (err) {
        console.error(`  Warning: Could not get status of ${member.path}`);
      }
    }
    await writeState(polygitDir, state);

    // Create initial commit in .polygit
    await addAll(polygitDir);
    try {
      await gitCommit(polygitDir, "Initial polygit commit");
      console.log("\nCreated initial polycommit");
    } catch {
      // No files to commit (empty state)
      console.log("\nInitialized (no initial commit - add members first)");
    }

    console.log(`\nPolygit initialized with ${members.length} member(s)`);
    console.log("Use 'polygit status' to see the current state");
  },
});
