# polygit

Git-like version control across multiple repositories.

Polygit treats a collection of git repositories as a single unit, enabling synchronized branching, checkout, and commit operations across all member repos.

**Command:** Both `polygit` and `pgit` work identically. Examples use `pgit` for brevity.

## Key Features

- **Polycommits**: Versioned snapshots of exact commits across all member repositories
- **Unified branching**: Create/checkout branches in all repos simultaneously
- **Worktree sets**: Git worktrees spanning all member repos
- **Preview worktrees**: Auto-merge multiple feature branches for testing parallel work
- **Claude conflict resolution**: AI-powered merge conflict resolution using Claude Agent SDK

## Installation

```bash
npm install -g polygit
```

This installs both `polygit` and `pgit` commands.

## Quick Start

```bash
# Initialize a polyrepo in a directory containing git repos
cd my-projects
pgit init

# Create a branch across all repos
pgit branch feature/new-feature

# Switch all repos to that branch
pgit checkout feature/new-feature

# Check status of all repos
pgit status

# Commit a snapshot of current state
pgit commit -m "Synchronized commit"
```

## Commands

### clone

Clone an existing workspace from its **meta-repository** (the remote for `.polygit/`):

```bash
pgit clone <meta-repository> [directory]
pgit clone --branch <branch-or-tag> <meta-repository> [directory]
```

This creates `<directory>/.polygit`, clones the recorded member repositories,
and checks out their exact saved revisions, even if their remote branches have
advanced. Without a directory argument, the repository name is used. A destination
must be absent or empty. The selected metadata branch remains attached; members
start at their recorded commits. Use `pgit checkout <branch>` to switch to member
development branches afterward.

If a member cannot be restored, clone returns a nonzero exit status and keeps the
metadata and any completed clones. After resolving the issue, retry with
`pgit checkout <polycommit-sha>` from the new workspace.

### init

Initialize a polygit repository.

```bash
pgit init [--name <name>]
```

Creates a `.polygit/` directory that tracks the state of all member repositories.

### link / unlink

Change membership in an existing polyrepo:

```bash
pgit link ./new-repo
pgit commit -m "Link new-repo"

pgit unlink ./old-repo
pgit commit -m "Unlink old-repo"
```

`link` registers an **existing Git checkout inside the polyrepo**. It records its
current commit, branch (or detached HEAD), and origin URL when available. It does
not clone, move, or create a repository. The checkout must have at least one
commit. Dirty checkouts are allowed; only their committed revision is recorded.
Nested paths are supported, but members cannot overlap, traverse symlinks, or live
inside `.polygit`, `.git`, or `.worktrees`. Relative local origins are recorded as
absolute paths for restoration.

`unlink` removes the member from both `config.json` and `state.json`. Its checkout
can already be missing or moved. Repository files, uncommitted work, branches,
remotes, and Git worktree registrations are left untouched. Other members' saved
states are preserved. Unlinking the last member is allowed; linking an existing
member or unlinking an unknown member returns an error.

Paths are relative to the **polyrepo root**, even when invoked from a subdirectory;
`repo`, `./repo/`, and an absolute path inside that root are equivalent. To unlink
a moved checkout, use its **old registered path**, not its new location:

```bash
cd /Users/martin/src/evryzin
pgit unlink ./polygit
pgit commit -m "Unlink polygit"
```

Both commands leave membership edits **unstaged and uncommitted**. Review them with
`git -C .polygit diff`, then use `pgit commit` to record them. As usual, that commit
captures all remaining members and stages metadata changes, so review any other
pending metadata edits too. Historical polycommits retain their original membership;
checking out an older snapshot can restore an unlinked member, including cloning it
again when its origin is available.

Run membership commands from the main polyrepo, not a Polygit worktree set.
Remove registered worktree sets and previews before changing membership (use
`pgit worktree list` to find them): all sets currently share the main membership
list. Staged or conflicted `config.json` / `state.json` must be committed or unstaged
first. No network access is needed by either command.

### status

Show the status of all member repositories.

```bash
pgit status
```

Displays branch, uncommitted changes, and sync state for each member.

### commit

Create a polycommit (synchronized snapshot).

```bash
pgit commit -m "message"
```

Records the current branch and commit of each member repository.

Commit file changes inside each member first: a polycommit records existing commits,
not uncommitted edits. If any member cannot be read, capture fails and preserves the
previous snapshot.

### checkout

Checkout a branch or polycommit across all repos.

```bash
pgit checkout <ref>
```

If the ref is a branch name, switches all repos to that branch. If it's a polycommit, restores the exact state recorded in that commit.

Historical checkout uses the configuration and commit SHAs from that polycommit,
with detached member HEADs; it does not rewind development branches. Missing member
commits cause an error rather than falling back to current branch tips. A failure
during checkout returns a nonzero exit status and reports that some members may
already have switched.

Missing member repositories are cloned automatically from the URLs in the target
snapshot. Missing commit objects are fetched as needed, first through a
`polygit/commits/<SHA>` snapshot tag if available, otherwise by requesting the SHA.
Servers that do not permit direct SHA requests must provide the snapshot tag.
Member URLs must be absolute paths or repository URLs, not relative local paths.
Existing non-repository directories and symlinks are never overwritten, and
repositories absent from the target snapshot are not deleted.

```bash
pgit checkout <ref> --offline  # Fail if a repo or commit is unavailable locally
```

`--offline` disables member cloning and fetching. The target metadata ref must
already be available locally in either mode. Member revisions must have been
published to their recorded origins before another machine can restore them.

### branch

Manage branches across all repos.

```bash
# Create a branch in all repos
pgit branch <name>

# List branches (coming soon)
pgit branch --list
```

### log

Show polycommit history.

```bash
pgit log
```

### worktree

Manage worktree sets across all member repositories.

```bash
# Create a new worktree set
pgit worktree add <name> [ref]

# List worktree sets
pgit worktree list

# Remove a worktree set
pgit worktree remove <name>
```

Removal refuses uncommitted changes, including untracked files. Commit or stash
your work before removing a worktree set or preview.

### preview

Manage preview worktrees that auto-merge multiple feature branches.

```bash
# Create a preview worktree
pgit preview add <name> <base> <feature>...

# List preview worktrees
pgit preview list

# Update/refresh a preview worktree
pgit preview update [name]

# Remove a preview worktree
pgit preview remove <name>
```

#### Examples

```bash
# Merge two features onto main
pgit preview add my-preview main feature/auth feature/api

# Use rebase strategy instead of merge
pgit preview add my-preview main feature/auth feature/api -s rebase

# Use Claude AI to resolve conflicts
pgit preview add my-preview main feature/auth feature/api -s claude
```

#### Options for `preview add`

- `-s <strategy>`: Merge strategy: `merge` (default), `rebase`, or `claude`
- `-o <spec>`: Per-member override (format: `member:base=branch,features=f1,f2`)
- `--uncommitted <mode>`: Default for uncommitted changes: `include` (default) or `discard`

#### Options for `preview update`

- `-s <strategy>`: Override merge strategy
- `--no-uncommitted`: Discard all uncommitted changes
- `--uncommitted`: Include all uncommitted changes
- `--uncommitted-for <member>`: Include uncommitted only for specific members
- `--dry-run`: Show what would be merged without making changes

By default, uncommitted changes are included (uses the setting from `preview add`).

## Preview Worktrees

Preview worktrees solve the problem of testing multiple parallel feature branches together. This is especially useful when:

- Multiple developers (or AI agents) are working on separate features
- You need to test how features interact before merging to main
- You want an auto-updated environment that combines work from multiple branches

Previews use detached worktrees, so source branches remain unchanged and multiple
previews can share a base that is also checked out in your main workspace. Refresh
rebuilds from the current local base and feature branches. Merge or edit-restoration
conflicts return a nonzero exit status; stashed edits remain available for recovery.

### Example Workflow

```bash
# Create a preview worktree combining two features
pgit preview add test-integration main feature/auth feature/api

# Work in the preview worktree
cd .worktrees/test-integration

# After making changes to feature branches, refresh:
pgit preview update

# When done, remove the preview
cd ..
pgit preview remove test-integration
```

### Merge Strategies

1. **merge** (default): Standard git merge with merge commits
2. **rebase**: Rebase features onto base (fails on conflicts)
3. **claude**: Use Claude AI to automatically resolve merge conflicts

## Claude Conflict Resolution

When using `--strategy claude`, polygit uses the Claude Agent SDK to automatically resolve merge conflicts.

### Setup

1. Install the Claude Agent SDK (included as a dependency)

2. Configure your API key in `~/.polygit/config.json`:

```json
{
  "anthropicApiKey": "sk-ant-..."
}
```

Or set the `ANTHROPIC_API_KEY` environment variable.

### How It Works

When a merge conflict occurs:
1. Polygit reads the file with conflict markers
2. Sends the content to Claude with instructions to resolve
3. Claude analyzes both sides and produces a merged version
4. The resolved content is written back and staged

## Configuration

### Global Configuration

`~/.polygit/config.json`:

```json
{
  "anthropicApiKey": "sk-ant-..."
}
```

### Repository Configuration

`.polygit/config.json`:

```json
{
  "name": "my-polyrepo",
  "members": [
    { "path": "./repo-a" },
    { "path": "./repo-b" }
  ]
}
```

## How It Works

Polygit uses a `.polygit/` directory (itself a git repository) to track the synchronized state of all member repositories. Each "polycommit" is actually a commit in this meta-repository that records:

- The current branch of each member
- The current commit SHA of each member
- Any additional metadata

This approach provides:
- Full git semantics for the polyrepo
- Ability to checkout any historical synchronized state
- Branch and merge operations at the polyrepo level

## License

MIT
