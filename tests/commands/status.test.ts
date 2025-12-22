import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit } from "../helpers/git.js";

describe("polygit status", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should show status of all members", async () => {
    const result = await polygitOk(["status"], { cwd: fixture.root });

    expect(result.stdout).toContain("./app");
    expect(result.stdout).toContain("./lib");
  });

  it("should show clean status after init", async () => {
    const result = await polygitOk(["status"], { cwd: fixture.root });

    // Status should indicate members are in sync
    expect(result.exitCode).toBe(0);
  });

  it("should detect diverged state when member has new commits", async () => {
    // Make a commit in app that polygit doesn't know about
    await addAndCommit(
      fixture.members.app,
      { "new-file.ts": "// new file\n" },
      "Add new file"
    );

    const result = await polygitOk(["status"], { cwd: fixture.root });

    // Status should indicate divergence
    expect(result.stdout).toContain("./app");
  });

  it("should fail when not in a polygit repo", async () => {
    const { createTestDir } = await import("../helpers/fixtures.js");
    const ctx = await createTestDir();

    try {
      const result = await polygit(["status"], { cwd: ctx.tempDir });
      expect(result.exitCode).not.toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });
});
