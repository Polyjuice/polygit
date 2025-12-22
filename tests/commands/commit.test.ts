import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { addAndCommit } from "../helpers/git.js";

describe("polygit commit", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should create a polycommit with custom message", async () => {
    // Make changes in a member
    await addAndCommit(
      fixture.members.app,
      { "feature.ts": "// feature\n" },
      "Add feature"
    );

    const result = await polygitOk(
      ["commit", "-m", "Test polycommit"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("Polycommit");
    expect(result.stdout).toContain("Test polycommit");
  });

  it("should record member states in polycommit", async () => {
    await addAndCommit(
      fixture.members.app,
      { "v1.ts": "// v1\n" },
      "Version 1"
    );

    const result = await polygitOk(
      ["commit", "-m", "V1 release"],
      { cwd: fixture.root }
    );

    expect(result.stdout).toContain("./app");
  });

  it("should create polycommit after making changes", async () => {
    // Make a small change to create a valid commit
    await addAndCommit(
      fixture.members.lib,
      { "lib-change.ts": "// lib change\n" },
      "Lib change"
    );

    const result = await polygitOk(
      ["commit", "-m", "Sync state"],
      { cwd: fixture.root }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sync state");
  });
});
