import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";

describe("polygit worktree list", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should show empty list when no worktrees exist", async () => {
    const result = await polygitOk(["worktree", "list"], { cwd: fixture.root });

    expect(result.stdout).toContain("No worktree");
  });

  it("should list created worktrees", async () => {
    await polygitOk(["worktree", "add", "wt1"], { cwd: fixture.root });
    await polygitOk(["worktree", "add", "wt2"], { cwd: fixture.root });

    const result = await polygitOk(["worktree", "list"], { cwd: fixture.root });

    expect(result.stdout).toContain("wt1");
    expect(result.stdout).toContain("wt2");
    expect(result.stdout).toContain(".worktrees/wt1");
    expect(result.stdout).toContain(".worktrees/wt2");
  });
});
