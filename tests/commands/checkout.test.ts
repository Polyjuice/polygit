import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, getCurrentBranch } from "../helpers/git.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("polygit checkout", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should checkout a branch across all members", async () => {
    // Create branch first
    await polygitOk(["branch", "feature-x"], { cwd: fixture.root });

    // Checkout back to original branch then to feature-x
    const result = await polygitOk(["checkout", "feature-x"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).toBe(0);

    // Verify members are on the branch
    expect(await getCurrentBranch(fixture.members.app)).toBe("feature-x");
    expect(await getCurrentBranch(fixture.members.lib)).toBe("feature-x");
  });

  it("should fail checkout with dirty working directory", async () => {
    // Create a branch
    await polygitOk(["branch", "test-branch"], { cwd: fixture.root });

    // Make uncommitted changes
    await writeFile(
      join(fixture.members.app, "dirty.ts"),
      "// uncommitted\n"
    );

    const result = await polygit(["checkout", "test-branch"], {
      cwd: fixture.root,
    });

    // Should fail due to dirty state
    expect(result.exitCode).not.toBe(0);
  });

  it("should force checkout with --force flag", async () => {
    // Create a branch
    await polygitOk(["branch", "test-branch"], { cwd: fixture.root });

    // Verify actual discard of a tracked edit, not merely bypassing dirty checks.
    const file = join(fixture.members.app, "README.md");
    const original = await readFile(file, "utf8");
    await writeFile(
      file,
      "// uncommitted\n"
    );

    const result = await polygitOk(["checkout", "--force", "test-branch"], {
      cwd: fixture.root,
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(file, "utf8")).toBe(original);
  });
});
