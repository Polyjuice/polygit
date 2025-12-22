import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { assertDirExists } from "../helpers/assertions.js";
import { join } from "node:path";

describe("polygit worktree add", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should create a worktree set", async () => {
    const result = await polygitOk(["worktree", "add", "test-wt"], {
      cwd: fixture.root,
    });

    expect(result.stdout).toContain("Creating worktree set 'test-wt'");
    expect(result.stdout).toContain("./app:");
    expect(result.stdout).toContain("./lib:");

    // Verify directory structure
    const wtPath = join(fixture.root, ".worktrees", "test-wt");
    await assertDirExists(wtPath);
    await assertDirExists(join(wtPath, "app"));
    await assertDirExists(join(wtPath, "lib"));
  });

  it("should create worktree at specific ref", async () => {
    // Create a branch first
    await polygitOk(["branch", "feature-x"], { cwd: fixture.root });

    // Create worktree at that branch
    const result = await polygitOk(["worktree", "add", "feature-wt", "feature-x"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("feature-wt");
  });

  it("should fail if worktree name already exists", async () => {
    await polygitOk(["worktree", "add", "existing"], { cwd: fixture.root });

    const result = await polygit(["worktree", "add", "existing"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already exists");
  });

  it("should not allow creating worktree from within a worktree", async () => {
    // Create first worktree
    await polygitOk(["worktree", "add", "wt1"], { cwd: fixture.root });

    const wtPath = join(fixture.root, ".worktrees", "wt1");

    // Try to create worktree from within wt1
    const result = await polygit(["worktree", "add", "wt2"], { cwd: wtPath });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot create worktree from within a worktree");
  });
});
