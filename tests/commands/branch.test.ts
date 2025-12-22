import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyrepoFixture, type PolyrepoFixture } from "../helpers/fixtures.js";
import { polygitOk } from "../helpers/cli.js";
import { getCurrentBranch } from "../helpers/git.js";

describe("polygit branch", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
    await polygitOk(["init"], { cwd: fixture.root });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should create a branch in all members", async () => {
    const result = await polygitOk(["branch", "feature-new"], {
      cwd: fixture.root,
    });

    expect(result.stdout).toContain("feature-new");
    expect(result.stdout).toContain("created");

    // Verify members are on the new branch
    expect(await getCurrentBranch(fixture.members.app)).toBe("feature-new");
    expect(await getCurrentBranch(fixture.members.lib)).toBe("feature-new");
  });

  it("should create polybranch and switch all members", async () => {
    await polygitOk(["branch", "develop"], { cwd: fixture.root });

    // Both members should be on develop
    const appBranch = await getCurrentBranch(fixture.members.app);
    const libBranch = await getCurrentBranch(fixture.members.lib);

    expect(appBranch).toBe("develop");
    expect(libBranch).toBe("develop");
  });
});
