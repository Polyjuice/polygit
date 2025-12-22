import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { assertDirExists, assertNotExists } from "../helpers/assertions.js";
import { join } from "node:path";

describe("Worktree Lifecycle: add -> list -> remove", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should complete the full worktree lifecycle", async () => {
    // 1. Add worktree
    const addResult = await polygitOk(["worktree", "add", "test-wt"], {
      cwd: fixture.root,
    });
    expect(addResult.stdout).toContain("Creating worktree set 'test-wt'");
    expect(addResult.stdout).toContain("./app:");
    expect(addResult.stdout).toContain("./lib:");

    // Verify worktree directory exists
    const wtPath = join(fixture.root, ".worktrees", "test-wt");
    await assertDirExists(wtPath);
    await assertDirExists(join(wtPath, "app"));
    await assertDirExists(join(wtPath, "lib"));

    // 2. List worktrees
    const listResult = await polygitOk(["worktree", "list"], {
      cwd: fixture.root,
    });
    expect(listResult.stdout).toContain("test-wt");
    expect(listResult.stdout).toContain(".worktrees/test-wt");

    // 3. Remove worktree
    const removeResult = await polygitOk(["worktree", "remove", "test-wt"], {
      cwd: fixture.root,
    });
    expect(removeResult.stdout).toContain("Removing worktree set 'test-wt'");
    expect(removeResult.stdout).toContain("./app: removed");
    expect(removeResult.stdout).toContain("./lib: removed");

    // Verify worktree directory is gone
    await assertNotExists(wtPath);

    // 4. List should be empty
    const emptyListResult = await polygitOk(["worktree", "list"], {
      cwd: fixture.root,
    });
    expect(emptyListResult.stdout).toContain("No worktree");
  });

  it("should support multiple worktrees", async () => {
    // Create multiple worktrees
    await polygitOk(["worktree", "add", "wt1"], { cwd: fixture.root });
    await polygitOk(["worktree", "add", "wt2"], { cwd: fixture.root });
    await polygitOk(["worktree", "add", "wt3"], { cwd: fixture.root });

    // List should show all
    const listResult = await polygitOk(["worktree", "list"], {
      cwd: fixture.root,
    });
    expect(listResult.stdout).toContain("wt1");
    expect(listResult.stdout).toContain("wt2");
    expect(listResult.stdout).toContain("wt3");

    // Remove one
    await polygitOk(["worktree", "remove", "wt2"], { cwd: fixture.root });

    // List should show remaining
    const afterRemoveResult = await polygitOk(["worktree", "list"], {
      cwd: fixture.root,
    });
    expect(afterRemoveResult.stdout).toContain("wt1");
    expect(afterRemoveResult.stdout).not.toContain("wt2");
    expect(afterRemoveResult.stdout).toContain("wt3");
  });
});
