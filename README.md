# polygit

Git-like version control across multiple repositories.

Polygit treats a collection of git repositories as a single unit, enabling synchronized branching, checkout, and commit operations across all member repos.

## Key Features

- **Polycommits**: Atomic snapshots across all member repositories
- **Unified branching**: Create/checkout branches in all repos simultaneously
- **Worktree sets**: Git worktrees spanning all member repos
- **Preview worktrees**: Auto-merge multiple feature branches for testing parallel work
- **Claude conflict resolution**: AI-powered merge conflict resolution using Claude Agent SDK

## Installation

```bash
npm install -g polygit
```

## Quick Start

```bash
# Initialize a polyrepo in a directory containing git repos
cd my-projects
polygit init

# Create a branch across all repos
polygit branch feature/new-feature

# Switch all repos to that branch
polygit checkout feature/new-feature

# Check status of all repos
polygit status

# Commit a snapshot of current state
polygit commit -m "Synchronized commit"
```

## Commands

### init

Initialize a polygit repository.

```bash
polygit init [--name <name>]
```

Creates a `.polygit/` directory that tracks the state of all member repositories.

### status

Show the status of all member repositories.

```bash
polygit status
```

Displays branch, uncommitted changes, and sync state for each member.

### commit

Create a polycommit (synchronized snapshot).

```bash
polygit commit -m "message"
```

Records the current branch and commit of each member repository.

### checkout

Checkout a branch or polycommit across all repos.

```bash
polygit checkout <ref>
```

If the ref is a branch name, switches all repos to that branch. If it's a polycommit, restores the exact state recorded in that commit.

### branch

Manage branches across all repos.

```bash
# Create a branch in all repos
polygit branch <name>

# List branches (coming soon)
polygit branch --list
```

### log

Show polycommit history.

```bash
polygit log
```

### worktree

Manage worktree sets across all member repositories.

```bash
# Create a new worktree set
polygit worktree add <name> [ref]

# List worktree sets
polygit worktree list

# Remove a worktree set
polygit worktree remove <name>
```

#### Preview Worktrees

Create a worktree that auto-merges multiple feature branches:

```bash
polygit worktree add-preview <name> \
  --base main \
  --features feature/a --features feature/b \
  --strategy merge
```

Options:
- `--base <branch>`: Base branch for all members
- `--features <branch>`: Feature branches to merge (repeatable)
- `--strategy <strategy>`: Merge strategy: `rebase`, `merge`, or `claude`
- `--override <spec>`: Per-member override (format: `member:base=branch,features=f1,f2`)
- `--uncommitted-default <mode>`: Default for uncommitted changes: `include` or `discard`

### update

Refresh a preview worktree by re-merging feature branches.

```bash
# Inside a preview worktree
polygit update
```

Options:
- `--strategy <strategy>`: Override merge strategy
- `--no-uncommitted`: Discard all uncommitted changes
- `--uncommitted`: Include all uncommitted changes
- `--uncommitted-for <member>`: Include uncommitted only for specific members
- `--dry-run`: Show what would be merged without making changes

## Preview Worktrees

Preview worktrees solve the problem of testing multiple parallel feature branches together. This is especially useful when:

- Multiple developers (or AI agents) are working on separate features
- You need to test how features interact before merging to main
- You want an auto-updated environment that combines work from multiple branches

### Example Workflow

```bash
# Create a preview worktree combining two features
polygit worktree add-preview test-integration \
  --base main \
  --features feature/auth --features feature/api

# Work in the preview worktree
cd .worktrees/test-integration

# After making changes to feature branches, refresh:
polygit update

# When done, remove the preview
cd ..
polygit worktree remove test-integration
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
