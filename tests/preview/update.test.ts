import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoWithBranches,
  type PolyrepoFixture,
} from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { gitOk, addAndCommit } from "../helpers/git.js";
import { readFileContent } from "../helpers/assertions.js";
import { join } from "node:path";

describe("polygit preview update", () => {
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

  it("should update preview with new feature branch changes", async () => {
    // Create preview
    await polygitOk(
      ["preview", "add", "update-test", "main", "feature-a"],
      { cwd: fixture.root }
    );

    // Add new commits to feature-a in the original repo
    await gitOk(["checkout", "feature-a"], fixture.members.app);
    await addAndCommit(
      fixture.members.app,
      { "new-change.txt": "New content\n" },
      "New feature-a commit"
    );

    // Update preview
    const result = await polygitOk(
      ["preview", "update", "update-test"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Updating preview worktree 'update-test'");
    expect(result.stdout).toContain("Update complete");

    // Verify new changes are in preview
    const previewPath = join(fixture.root, ".worktrees", "update-test", "app");
    const newContent = await readFileContent(
      join(previewPath, "new-change.txt")
    );
    expect(newContent).toContain("New content");
  });

  it("should support dry-run", async () => {
    await polygitOk(
      ["preview", "add", "dry-run-test", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const result = await polygitOk(
      ["preview", "update", "dry-run-test", "--dry-run"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain("Base: main");
    expect(result.stdout).toContain("Features: feature-a");
  });

  it("should allow strategy override", async () => {
    await polygitOk(
      ["preview", "add", "strategy-test", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const result = await polygitOk(
      ["preview", "update", "strategy-test", "-s", "rebase"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Strategy: rebase");
  });

  it("should update from within the preview worktree", async () => {
    await polygitOk(
      ["preview", "add", "inside-test", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const previewPath = join(fixture.root, ".worktrees", "inside-test");

    // Update from within the worktree (without specifying name)
    const result = await polygitOk(["preview", "update"], { cwd: previewPath });

    expect(result.stdout).toContain("Updating preview worktree 'inside-test'");
  });
});
