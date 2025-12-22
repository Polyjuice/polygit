import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoWithBranches,
  type PolyrepoFixture,
} from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { gitOk, addAndCommit } from "../helpers/git.js";
import {
  assertDirExists,
  assertNotExists,
  readFileContent,
} from "../helpers/assertions.js";
import { join } from "node:path";

describe("Preview Lifecycle: add -> list -> update -> remove", () => {
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

  it("should complete the full preview lifecycle", async () => {
    // 1. Add preview
    const addResult = await polygitOk(
      ["preview", "add", "test-preview", "main", "feature-a", "feature-b"],
      { cwd: fixture.root }
    );
    expect(addResult.stdout).toContain("Creating preview worktree 'test-preview'");
    expect(addResult.stdout).toContain("Base: main");
    expect(addResult.stdout).toContain("Features: feature-a, feature-b");

    const previewPath = join(fixture.root, ".worktrees", "test-preview");
    await assertDirExists(previewPath);

    // Verify merged content
    const featureAContent = await readFileContent(
      join(previewPath, "app", "feature-a.txt")
    );
    expect(featureAContent).toContain("Content from feature-a");

    const featureBContent = await readFileContent(
      join(previewPath, "app", "feature-b.txt")
    );
    expect(featureBContent).toContain("Content from feature-b");

    // 2. List previews
    const listResult = await polygitOk(["preview", "list"], {
      cwd: fixture.root,
    });
    expect(listResult.stdout).toContain("test-preview");
    expect(listResult.stdout).toContain("Base: main");
    expect(listResult.stdout).toContain("feature-a");
    expect(listResult.stdout).toContain("feature-b");

    // 3. Update preview after adding new content to feature branch
    await gitOk(["checkout", "feature-a"], fixture.members.app);
    await addAndCommit(
      fixture.members.app,
      { "new-in-feature-a.txt": "New content in feature-a\n" },
      "Add new content to feature-a"
    );
    // Note: can't checkout main - it's being used by the preview worktree

    const updateResult = await polygitOk(
      ["preview", "update", "test-preview"],
      { cwd: fixture.root }
    );
    expect(updateResult.stdout).toContain("Updating preview worktree 'test-preview'");
    expect(updateResult.stdout).toContain("Update complete");

    // Verify new content is in preview
    const newContent = await readFileContent(
      join(previewPath, "app", "new-in-feature-a.txt")
    );
    expect(newContent).toContain("New content in feature-a");

    // 4. Remove preview
    const removeResult = await polygitOk(
      ["preview", "remove", "test-preview"],
      { cwd: fixture.root }
    );
    expect(removeResult.stdout).toContain("Removing preview worktree 'test-preview'");
    expect(removeResult.stdout).toContain("Preview worktree 'test-preview' removed");

    await assertNotExists(previewPath);

    // 5. List should be empty
    const emptyListResult = await polygitOk(["preview", "list"], {
      cwd: fixture.root,
    });
    expect(emptyListResult.stdout).toContain("No preview worktrees");
  });

  it("should support different merge strategies", async () => {
    // Create preview with rebase strategy
    // Note: Can only create one preview worktree per base branch (git worktree limitation)
    await polygitOk(
      ["preview", "add", "rebase-preview", "main", "feature-a", "-s", "rebase"],
      { cwd: fixture.root }
    );

    const listResult = await polygitOk(["preview", "list"], {
      cwd: fixture.root,
    });
    expect(listResult.stdout).toContain("rebase-preview");
    expect(listResult.stdout).toContain("Strategy: rebase");
  });
});
