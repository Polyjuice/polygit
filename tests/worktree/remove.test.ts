import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { assertDirExists, assertNotExists } from "../helpers/assertions.js";
import { join } from "node:path";

describe("polygit worktree remove", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should remove a worktree set", async () => {
    await polygitOk(["worktree", "add", "to-remove"], { cwd: fixture.root });

    const wtPath = join(fixture.root, ".worktrees", "to-remove");
    await assertDirExists(wtPath);

    const result = await polygitOk(["worktree", "remove", "to-remove"], {
      cwd: fixture.root,
    });

    expect(result.stdout).toContain("Removing worktree set 'to-remove'");
    expect(result.stdout).toContain("./app: removed");
    expect(result.stdout).toContain("./lib: removed");

    await assertNotExists(wtPath);
  });

  it("should fail when removing non-existent worktree", async () => {
    const result = await polygit(["worktree", "remove", "nonexistent"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });

  it("should not allow removing worktree from within a worktree", async () => {
    await polygitOk(["worktree", "add", "wt1"], { cwd: fixture.root });

    const wtPath = join(fixture.root, ".worktrees", "wt1");

    const result = await polygit(["worktree", "remove", "wt1"], { cwd: wtPath });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot remove worktree from within a worktree");
  });
});
