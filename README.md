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

### init

Initialize a polygit repository.

```bash
pgit init [--name <name>]
```

Creates a `.polygit/` directory that tracks the state of all member repositories.

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
