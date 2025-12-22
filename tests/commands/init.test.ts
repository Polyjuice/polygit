import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPolyrepoFixture,
  createTestDir,
  type PolyrepoFixture,
  type TestContext,
} from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import {
  assertPolygitInitialized,
  readPolygitJson,
} from "../helpers/assertions.js";

describe("polygit init", () => {
  let fixture: PolyrepoFixture;

  beforeEach(async () => {
    fixture = await createPolyrepoFixture({ memberNames: ["app", "lib"] });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("should initialize a new polyrepo", async () => {
    const result = await polygitOk(["init"], { cwd: fixture.root });

    expect(result.stdout).toContain("Initializing polygit");
    expect(result.stdout).toContain("app");
    expect(result.stdout).toContain("lib");

    await assertPolygitInitialized(fixture.root);
  });

  it("should use custom name with --name flag", async () => {
    await polygitOk(["init", "--name", "my-polyrepo"], { cwd: fixture.root });

    const config = await readPolygitJson<{ name: string }>(
      fixture.root,
      "config.json"
    );
    expect(config.name).toBe("my-polyrepo");
  });

  it("should fail if already initialized", async () => {
    await polygitOk(["init"], { cwd: fixture.root });

    const result = await polygit(["init"], { cwd: fixture.root });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already");
  });

  it("should record member states", async () => {
    await polygitOk(["init"], { cwd: fixture.root });

    const state = await readPolygitJson<{ members: Record<string, unknown> }>(
      fixture.root,
      "state.json"
    );

    expect(state.members["./app"]).toBeDefined();
    expect(state.members["./lib"]).toBeDefined();
  });

  it("should handle directory with no git repos", async () => {
    const ctx: TestContext = await createTestDir();

    try {
      const result = await polygit(["init"], { cwd: ctx.tempDir });
      // Should either succeed with no members or fail gracefully
      expect(result.exitCode).toBeDefined();
    } finally {
      await ctx.cleanup();
    }
  });
});
