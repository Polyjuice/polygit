import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { addAndCommit, getCurrentBranch } from "../helpers/git.js";

describe("Basic Workflow: init -> status -> branch -> commit -> log", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should complete the full basic workflow", async () => {
    // 1. Initialize
    const initResult = await polygitOk(["init"], { cwd: fixture.root });
    expect(initResult.stdout).toContain("Initializing polygit");
    expect(initResult.stdout).toContain("app");
    expect(initResult.stdout).toContain("lib");

    // 2. Status after init
    const statusResult = await polygitOk(["status"], { cwd: fixture.root });
    expect(statusResult.stdout).toContain("./app:");
    expect(statusResult.stdout).toContain("./lib:");

    // 3. Create a new branch
    const branchResult = await polygitOk(["branch", "feature-x"], {
      cwd: fixture.root,
    });
    expect(branchResult.stdout).toContain("feature-x");

    // Verify both members are on the new branch
    expect(await getCurrentBranch(fixture.members.app)).toBe("feature-x");
    expect(await getCurrentBranch(fixture.members.lib)).toBe("feature-x");

    // 4. Make changes to members
    await addAndCommit(
      fixture.members.app,
      { "new-feature.ts": "// new feature\n" },
      "Add new feature"
    );

    // 5. Create a polycommit
    const commitResult = await polygitOk(
      ["commit", "-m", "Feature X implementation"],
      { cwd: fixture.root }
    );
    expect(commitResult.stdout).toContain("Polycommit");
    expect(commitResult.stdout).toContain("Feature X implementation");

    // 6. Check log
    const logResult = await polygitOk(["log"], { cwd: fixture.root });
    expect(logResult.stdout).toContain("Feature X implementation");
  });

  it("should handle multiple branches and commits", async () => {
    await polygitOk(["init"], { cwd: fixture.root });

    // Create first feature branch
    await polygitOk(["branch", "feature-a"], { cwd: fixture.root });
    await addAndCommit(
      fixture.members.app,
      { "feature-a.ts": "// feature a\n" },
      "Add feature A"
    );
    await polygitOk(["commit", "-m", "Feature A done"], { cwd: fixture.root });

    // Create second feature branch from first
    await polygitOk(["branch", "feature-b"], { cwd: fixture.root });
    await addAndCommit(
      fixture.members.lib,
      { "feature-b.ts": "// feature b\n" },
      "Add feature B"
    );
    await polygitOk(["commit", "-m", "Feature B done"], { cwd: fixture.root });

    // Log should show both
    const logResult = await polygitOk(["log"], { cwd: fixture.root });
    expect(logResult.stdout).toContain("Feature B done");
    expect(logResult.stdout).toContain("Feature A done");
  });
});
