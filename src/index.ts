#!/usr/bin/env node

import { run, subcommands } from "cmd-ts";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { commitCommand } from "./commands/commit.js";
import { checkoutCommand } from "./commands/checkout.js";
import { branchCommand } from "./commands/branch.js";
import { logCommand } from "./commands/log.js";
import { worktreeCommand } from "./commands/worktree.js";
import { previewCommand } from "./commands/preview.js";

const app = subcommands({
  name: "polygit",
  description: "Git-like version control across multiple repositories",
  version: "0.1.0",
  cmds: {
    init: initCommand,
    status: statusCommand,
    commit: commitCommand,
    checkout: checkoutCommand,
    branch: branchCommand,
    log: logCommand,
    worktree: worktreeCommand,
    preview: previewCommand,
  },
});

run(app, process.argv.slice(2));
