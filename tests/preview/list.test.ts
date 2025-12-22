import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoWithBranches,
  type PolyrepoFixture,
} from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";

describe("polygit preview list", () => {
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

  it("should show empty list when no preview worktrees exist", async () => {
    const result = await polygitOk(["preview", "list"], { cwd: fixture.root });

    expect(result.stdout).toContain("No preview worktrees");
  });

  it("should list preview worktrees with details", async () => {
    // Create a single preview worktree (can't create multiple with same base branch)
    await polygitOk(
      ["preview", "add", "preview-1", "main", "feature-a", "feature-b"],
      { cwd: fixture.root }
    );

    const result = await polygitOk(["preview", "list"], { cwd: fixture.root });

    expect(result.stdout).toContain("Preview worktrees:");
    expect(result.stdout).toContain("preview-1");
    expect(result.stdout).toContain("Base: main");
    expect(result.stdout).toContain("Features:");
    expect(result.stdout).toContain("feature-a");
    expect(result.stdout).toContain("feature-b");
  });

  it("should not include regular worktrees in preview list", async () => {
    // Create a regular worktree
    await polygitOk(["worktree", "add", "regular-wt"], { cwd: fixture.root });

    // Create a preview worktree
    await polygitOk(
      ["preview", "add", "preview-wt", "main", "feature-a"],
      { cwd: fixture.root }
    );

    const result = await polygitOk(["preview", "list"], { cwd: fixture.root });

    expect(result.stdout).toContain("preview-wt");
    expect(result.stdout).not.toContain("regular-wt");
  });
});
