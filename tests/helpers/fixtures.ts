import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGitRepo, createBranch, gitOk } from "./git.js";

export interface TestContext {
  /** Root temp directory for this test */
  tempDir: string;
  /** Cleanup function - call in afterEach/afterAll */
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary directory for a test
 */
export async function createTestDir(
  prefix: string = "polygit-test-"
): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));

  return {
    tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a polyrepo test fixture with multiple member repos
 */
export interface PolyrepoFixture extends TestContext {
  /** Root of the polyrepo */
  root: string;
  /** Paths to member repos */
  members: Record<string, string>;
  /** Bare local origins, never network URLs. */
  origins: Record<string, string>;
}

export async function createPolyrepoFixture(options?: {
  memberCount?: number;
  memberNames?: string[];
}): Promise<PolyrepoFixture> {
  const ctx = await createTestDir();
  const root = ctx.tempDir;

  const memberNames =
    options?.memberNames ??
    Array.from(
      { length: options?.memberCount ?? 2 },
      (_, i) => `repo${i + 1}`
    );

  const members: Record<string, string> = {};
  const origins: Record<string, string> = {};
  const originsDir = join(root, ".origins");
  await mkdir(originsDir);

  for (const name of memberNames) {
    const memberPath = join(root, name);
    await createGitRepo(memberPath, {
      files: {
        "README.md": `# ${name}\n\nTest repository.\n`,
        "src/index.ts": `export const name = "${name}";\n`,
      },
      commitMessage: `Initial commit for ${name}`,
    });
    members[name] = memberPath;
    const origin = join(originsDir, `${name}.git`);
    await gitOk(["init", "--bare", origin], root);
    await gitOk(["remote", "add", "origin", origin], memberPath);
    await gitOk(["push", "-u", "origin", "main"], memberPath);
    origins[name] = origin;
  }

  return {
    ...ctx,
    root,
    members,
    origins,
  };
}

/**
 * Create a polyrepo with feature branches for preview testing.
 * The repos are left with detached HEAD so the base branch is available for worktrees.
 */
export async function createPolyrepoWithBranches(options?: {
  base?: string;
  features?: string[];
  memberNames?: string[];
}): Promise<PolyrepoFixture> {
  const memberNames = options?.memberNames ?? ["app", "lib"];
  const fixture = await createPolyrepoFixture({ memberNames });

  const base = options?.base ?? "main";
  const features = options?.features ?? ["feature-a", "feature-b"];

  for (const [name, memberPath] of Object.entries(fixture.members)) {
    // Get current branch name
    const currentBranch = await gitOk(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      memberPath
    );

    // Rename default branch to base if different
    if (currentBranch.trim() !== base) {
      await gitOk(["branch", "-m", currentBranch.trim(), base], memberPath);
    }

    // Create feature branches with changes
    for (const feature of features) {
      await createBranch(memberPath, feature, {
        files: {
          [`${feature}.txt`]: `Content from ${feature} in ${name}\n`,
        },
        commitMessage: `Add ${feature} changes`,
      });
      // Go back to base
      await gitOk(["checkout", base], memberPath);
    }

    // Detach HEAD so the base branch is available for worktrees
    // This is necessary because git worktree doesn't allow the same branch
    // to be checked out in multiple worktrees
    const headCommit = await gitOk(["rev-parse", "HEAD"], memberPath);
    await gitOk(["checkout", "--detach", headCommit.trim()], memberPath);
  }

  return fixture;
}
