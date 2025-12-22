import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoWithBranches,
  type PolyrepoFixture,
} from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { assertDirExists, readFileContent } from "../helpers/assertions.js";
import { join } from "node:path";

describe("polygit preview add", () => {
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

  it("should create a preview worktree with merge strategy", async () => {
    const result = await polygitOk(
      ["preview", "add", "my-preview", "main", "feature-a", "feature-b"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Creating preview worktree 'my-preview'");
    expect(result.stdout).toContain("Base: main");
    expect(result.stdout).toContain("Features: feature-a, feature-b");
    expect(result.stdout).toContain("Strategy: merge");

    // Verify preview directory exists
    const previewPath = join(fixture.root, ".worktrees", "my-preview");
    await assertDirExists(previewPath);
    await assertDirExists(join(previewPath, "app"));
    await assertDirExists(join(previewPath, "lib"));

    // Verify merged content exists
    const featureAContent = await readFileContent(
      join(previewPath, "app", "feature-a.txt")
    );
    expect(featureAContent).toContain("Content from feature-a");
  });

  it("should use rebase strategy when specified", async () => {
    const result = await polygitOk(
      ["preview", "add", "rebase-preview", "main", "feature-a", "-s", "rebase"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Strategy: rebase");
  });

  it("should handle missing feature branches gracefully", async () => {
    const result = await polygitOk(
      ["preview", "add", "partial", "main", "feature-a", "nonexistent"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Skipped (no branch): nonexistent");
    expect(result.stdout).toContain("Applied: feature-a");
  });

  it("should fail without feature branches", async () => {
    const result = await polygit(
      ["preview", "add", "no-features", "main"],
      { cwd: fixture.root }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("At least one feature branch is required");
  });

  it("should fail with invalid base branch", async () => {
    const result = await polygit(
      ["preview", "add", "bad-base", "nonexistent-base", "feature-a"],
      { cwd: fixture.root }
    );

    expect(result.exitCode).not.toBe(0);
  });
});
