import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, getCurrentBranch, gitOk } from "../helpers/git.js";

describe("development checkout and historical restoration (local origins only)", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  it("restores a saved SHA after its branch advances, without rewinding that branch", async () => {
    fixture = await createLocalFixture();
    const app = fixture.members.app;
    const saved = await addAndCommit(app, { "version.txt": "v1\n" }, "Version 1");
    await polygitOk(["commit", "-m", "Version 1"], { cwd: fixture.root });
    const snapshot = await getHead(fixture.meta);
    const newer = await addAndCommit(app, { "version.txt": "v2\n" }, "Version 2");
    await polygitOk(["commit", "-m", "Version 2"], { cwd: fixture.root });

    await polygitOk(["checkout", snapshot], { cwd: fixture.root });

    expect.soft(await getHead(app)).toBe(saved);
    expect.soft(await readFile(join(app, "version.txt"), "utf8")).toBe("v1\n");
    expect.soft(await gitOk(["rev-parse", "refs/heads/main"], app)).toBe(newer);
  });

  it("switches between genuinely different development polybranches", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    const mainHeads = Object.fromEntries(await Promise.all(
      Object.entries(fixture.members).map(async ([name, path]) => [name, await getHead(path)]),
    ));
    const mainReadme = await readFile(join(fixture.members.app, "README.md"), "utf8");
    await polygitOk(["branch", "feature"], { cwd: fixture.root });
    const featureHead = await addAndCommit(
      fixture.members.app, { "README.md": "feature implementation\n" }, "Feature",
    );
    await polygitOk(["commit", "-m", "Feature snapshot"], { cwd: fixture.root });

    await polygitOk(["checkout", "main"], { cwd: fixture.root });
    for (const [name, path] of Object.entries(fixture.members)) {
      expect(await getCurrentBranch(path)).toBe("main");
      expect(await getHead(path)).toBe(mainHeads[name]);
    }
    expect(await readFile(join(fixture.members.app, "README.md"), "utf8")).toBe(mainReadme);

    await polygitOk(["checkout", "feature"], { cwd: fixture.root });
    for (const path of Object.values(fixture.members)) {
      expect(await getCurrentBranch(path)).toBe("feature");
    }
    expect(await getHead(fixture.members.app)).toBe(featureHead);
    expect(await getHead(fixture.members.lib)).toBe(mainHeads.lib);
    expect(await readFile(join(fixture.members.app, "README.md"), "utf8"))
      .toBe("feature implementation\n");
  });

  it("returns failure and identifies a member whose saved commit cannot be checked out", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    await gitOk(["switch", "-c", "feature"], fixture.members.app);
    const featureHead = await addAndCommit(
      fixture.members.app, { "feature.txt": "ready\n" }, "Feature",
    );
    await gitOk(["switch", "main"], fixture.members.app);
    const libBefore = await getHead(fixture.members.lib);
    // An unavailable object requires neither a server nor a mocked Git command.
    await writeFile(join(fixture.meta, "state.json"), JSON.stringify({ members: {
      "./app": { commit: featureHead, branch: "feature" },
      "./lib": { commit: "0".repeat(40), branch: null },
    } }));
    await gitOk(["add", "state.json"], fixture.meta);
    await gitOk(["commit", "-m", "Snapshot with unavailable member"], fixture.meta);
    const target = await getHead(fixture.meta);

    const result = await polygit(["checkout", target], { cwd: fixture.root });

    // Preflight rejection or an explicitly reported partial result are both valid.
    expect.soft(result.exitCode).not.toBe(0);
    expect.soft(result.stderr).toContain("./lib");
    expect.soft(result.stdout).not.toContain("Checkout complete");
    expect.soft(await getHead(fixture.members.lib)).toBe(libBefore);
  });

  it("restores historical members even if current configuration omits them", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    const libSaved = await getHead(fixture.members.lib);
    // Isolate historical membership from the separate branch-preference regression.
    await gitOk(["checkout", "--detach"], fixture.members.lib);
    await polygitOk(["commit", "-m", "Both members"], { cwd: fixture.root });
    const snapshot = await getHead(fixture.meta);
    await addAndCommit(fixture.members.lib, { "later.txt": "later\n" }, "Later revision");
    const config = JSON.parse(await readFile(join(fixture.meta, "config.json"), "utf8"));
    config.members = config.members.filter((m: { path: string }) => m.path !== "./lib");
    await writeFile(join(fixture.meta, "config.json"), JSON.stringify(config));
    await polygitOk(["commit", "-m", "Remove lib from configuration"], { cwd: fixture.root });

    await polygitOk(["checkout", snapshot], { cwd: fixture.root });

    expect(await getHead(fixture.members.lib)).toBe(libSaved);
  });

  it("fails safely when a member branch is occupied by another worktree", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    await polygitOk(["branch", "feature"], { cwd: fixture.root });
    await polygitOk(["checkout", "main"], { cwd: fixture.root });
    await gitOk([
      "worktree", "add", join(fixture.root, ".lib-feature"), "feature",
    ], fixture.members.lib);
    const appHead = await getHead(fixture.members.app);

    const result = await polygit(["checkout", "feature"], { cwd: fixture.root });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("./lib");
    expect(result.stdout).not.toContain("Checkout complete");
    // Preflight rejection, rollback, or an explicitly reported partial checkout
    // are all acceptable; do not require a particular mutation order.
    expect(["main", "feature"]).toContain(await getCurrentBranch(fixture.members.app));
    expect(await getHead(fixture.members.app)).toBe(appHead);
    expect(await gitOk(["status", "--porcelain"], fixture.members.app)).toBe("");
    expect(await getCurrentBranch(fixture.members.lib)).toBe("main");
  });
});
