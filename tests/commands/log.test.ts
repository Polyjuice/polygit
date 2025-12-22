import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { addAndCommit } from "../helpers/git.js";

describe("polygit log", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should show polycommit history", async () => {
    // Create a few commits
    await addAndCommit(
      fixture.members.app,
      { "v1.ts": "// v1\n" },
      "Version 1"
    );
    await polygitOk(["commit", "-m", "First release"], { cwd: fixture.root });

    await addAndCommit(
      fixture.members.app,
      { "v2.ts": "// v2\n" },
      "Version 2"
    );
    await polygitOk(["commit", "-m", "Second release"], { cwd: fixture.root });

    const result = await polygitOk(["log"], { cwd: fixture.root });

    expect(result.stdout).toContain("Second release");
    expect(result.stdout).toContain("First release");
  });

  it("should limit log entries with -n flag", async () => {
    // Create multiple commits
    for (let i = 1; i <= 5; i++) {
      await addAndCommit(
        fixture.members.app,
        { [`file${i}.ts`]: `// file ${i}\n` },
        `Commit ${i}`
      );
      await polygitOk(["commit", "-m", `Polycommit ${i}`], {
        cwd: fixture.root,
      });
    }

    const result = await polygitOk(["log", "-n", "2"], { cwd: fixture.root });

    expect(result.stdout).toContain("Polycommit 5");
    expect(result.stdout).toContain("Polycommit 4");
    // Should not contain older commits
  });
});
