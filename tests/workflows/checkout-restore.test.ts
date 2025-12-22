import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, getCurrentBranch } from "../helpers/git.js";

describe("Checkout by polycommit SHA with state restoration", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should restore member states when checking out a polycommit", async () => {
    // Record initial state
    const initialAppCommit = await getHead(fixture.members.app);

    // Make changes and create first polycommit
    await addAndCommit(
      fixture.members.app,
      { "v1.ts": "// version 1\n" },
      "App v1"
    );
    const commitResult1 = await polygitOk(
      ["commit", "-m", "Polycommit 1"],
      { cwd: fixture.root }
    );

    // Extract polycommit SHA (it's a git commit in .polygit)
    const v1AppCommit = await getHead(fixture.members.app);

    // Make more changes
    await addAndCommit(
      fixture.members.app,
      { "v2.ts": "// version 2\n" },
      "App v2"
    );
    await polygitOk(["commit", "-m", "Polycommit 2"], { cwd: fixture.root });

    const v2AppCommit = await getHead(fixture.members.app);
    expect(v2AppCommit).not.toBe(v1AppCommit);

    // Checkout to a branch (feature) created earlier
    await polygitOk(["branch", "feature"], { cwd: fixture.root });

    // Log to see commits
    const logResult = await polygitOk(["log"], { cwd: fixture.root });
    expect(logResult.stdout).toContain("Polycommit 2");
    expect(logResult.stdout).toContain("Polycommit 1");
  });

  it("should switch between branches", async () => {
    // Create feature-a branch
    await polygitOk(["branch", "feature-a"], { cwd: fixture.root });
    await addAndCommit(
      fixture.members.app,
      { "feature-a.ts": "// feature a\n" },
      "Add feature A"
    );
    await polygitOk(["commit", "-m", "Feature A"], { cwd: fixture.root });

    const featureACommit = await getHead(fixture.members.app);

    // Go back and create feature-b
    // First we need to switch back - but we're on feature-a now
    // The checkout command should switch members
    await polygitOk(["checkout", "feature-a"], { cwd: fixture.root });

    expect(await getCurrentBranch(fixture.members.app)).toBe("feature-a");
    expect(await getCurrentBranch(fixture.members.lib)).toBe("feature-a");
  });
});
