import { afterEach, describe, expect, it } from "vitest";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, gitOk } from "../helpers/git.js";

describe("snapshot capture contracts (local origins only)", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  it("commits exactly every configured member and its current SHA", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    await addAndCommit(fixture.members.app, { "feature.txt": "ready\n" }, "Feature");
    const expected = { members: {
      "./app": { commit: await getHead(fixture.members.app), branch: "main" },
      "./lib": { commit: await getHead(fixture.members.lib), branch: "main" },
    } };

    await polygitOk(["commit", "-m", "Complete snapshot"], { cwd: fixture.root });

    // Inspect the committed object, not the working JSON or CLI's own status.
    expect(JSON.parse(await gitOk(["show", "HEAD:state.json"], fixture.meta)))
      .toEqual(expected);
  });

  it("does not publish an incomplete snapshot when one member is unreadable", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    const oldHead = await getHead(fixture.meta);
    const oldState = await readFile(join(fixture.meta, "state.json"), "utf8");
    await addAndCommit(fixture.members.app, { "feature.txt": "ready\n" }, "Feature");
    await rename(fixture.members.lib, join(fixture.root, ".unavailable-lib"));

    const result = await polygit(["commit", "-m", "Must fail"], { cwd: fixture.root });

    expect.soft(result.exitCode).not.toBe(0);
    expect.soft(result.stderr).toContain("./lib");
    expect.soft(result.stdout).not.toContain("Polycommit created");
    expect.soft(await getHead(fixture.meta)).toBe(oldHead);
    expect.soft(await readFile(join(fixture.meta, "state.json"), "utf8")).toBe(oldState);
  });
});
