import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoWithBranches,
  type PolyrepoFixture,
} from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { assertDirExists, assertNotExists } from "../helpers/assertions.js";
import { join } from "node:path";

describe("polygit preview remove", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoWithBranches({
      base: "main",
      features: ["feature-a", "feature-b"],
    });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should remove a preview worktree", async () => {
    await polygitOk(
      ["preview", "add", "to-remove", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const previewPath = join(fixture.root, ".worktrees", "to-remove");
    await assertDirExists(previewPath);

    const result = await polygitOk(["preview", "remove", "to-remove"], {
      cwd: fixture.root,
    });

    expect(result.stdout).toContain("Removing preview worktree 'to-remove'");
    expect(result.stdout).toContain("./app: removed");
    expect(result.stdout).toContain("./lib: removed");
    expect(result.stdout).toContain("Preview worktree 'to-remove' removed");

    await assertNotExists(previewPath);
  });

  it("should fail when removing non-existent preview", async () => {
    const result = await polygit(["preview", "remove", "nonexistent"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });

  it("should not remove regular worktrees with preview remove", async () => {
    // Create a regular worktree
    await polygitOk(["worktree", "add", "regular-wt"], { cwd: fixture.root });

    const result = await polygit(["preview", "remove", "regular-wt"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("is not a preview worktree");
  });

  it("should not allow removing preview from within a worktree", async () => {
    await polygitOk(
      ["preview", "add", "preview-wt", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const previewPath = join(fixture.root, ".worktrees", "preview-wt");

    const result = await polygit(["preview", "remove", "preview-wt"], {
      cwd: previewPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot remove worktree from within a worktree");
  });
});
