import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, getCurrentBranch, gitOk } from "../helpers/git.js";

describe("preview composition and recovery (local origins only)", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  async function prepareFeature(files: Record<string, string>) {
    fixture = await createLocalFixture();
    const app = fixture.members.app;
    const base = await getHead(app);
    await gitOk(["switch", "-c", "feature"], app);
    const feature = await addAndCommit(app, files, "Feature v1");
    await gitOk(["push", "-u", "origin", "feature"], app);
    // Free the base branch to isolate composition from Git's branch-in-use rule.
    // Whether previews work with main still checked out is a separate contract.
    await gitOk(["checkout", "--detach", "main"], app);
    return { ...fixture, app, base, feature,
      preview: join(fixture.root, ".worktrees", "integration", "app") };
  }

  it.each(["merge", "rebase"])("composes with %s without moving source base or feature refs", async (strategy) => {
    const f = await prepareFeature({ "feature.txt": "feature content\n" });

    await polygitOk(["preview", "add", "integration", "main", "feature", "-s", strategy], { cwd: f.root });

    expect.soft(await readFile(join(f.preview, "feature.txt"), "utf8"))
      .toBe("feature content\n");
    expect.soft(await gitOk(["rev-parse", "refs/heads/main"], f.app)).toBe(f.base);
    expect.soft(await gitOk(["rev-parse", "refs/heads/feature"], f.app)).toBe(f.feature);
    expect.soft(await getHead(f.app)).toBe(f.base);
  });

  it("allows independent previews while main remains checked out in the source repo", async () => {
    const f = await prepareFeature({ "feature.txt": "feature content\n" });
    await gitOk(["switch", "main"], f.app);

    for (const name of ["first", "second"]) {
      await polygitOk(["preview", "add", name, "main", "feature"], { cwd: f.root });
      const preview = join(f.root, ".worktrees", name, "app");
      expect(await readFile(join(preview, "feature.txt"), "utf8")).toBe("feature content\n");
    }
    await writeFile(join(f.root, ".worktrees", "first", "app", "feature.txt"), "preview-only edit\n");
    expect(await readFile(join(f.root, ".worktrees", "second", "app", "feature.txt"), "utf8"))
      .toBe("feature content\n");
    expect(await getCurrentBranch(f.app)).toBe("main");
    expect(await getHead(f.app)).toBe(f.base);
    expect(await gitOk(["rev-parse", "refs/heads/feature"], f.app)).toBe(f.feature);
  });

  it("returns failure when initial preview composition has a merge conflict", async () => {
    const f = await prepareFeature({ "README.md": "feature version\n" });
    await gitOk(["switch", "main"], f.app);
    await addAndCommit(f.app, { "README.md": "incompatible base version\n" }, "Base change");
    await gitOk(["push", "origin", "main"], f.app);
    await gitOk(["checkout", "--detach"], f.app);

    const result = await polygit(
      ["preview", "add", "integration", "main", "feature"], { cwd: f.root },
    );

    expect.soft(result.exitCode).not.toBe(0);
    expect.soft(result.stderr).toMatch(/conflict/i);
    expect.soft(result.stderr).toContain("README.md");
  });

  it("reports stash-restoration conflicts and retains a recoverable copy of edits", async () => {
    const f = await prepareFeature({ "README.md": "feature v1\n" });
    await polygitOk(["preview", "add", "integration", "main", "feature"], { cwd: f.root });
    expect(await readFile(join(f.preview, "README.md"), "utf8")).toBe("feature v1\n");
    const localEdit = "unfinished preview work\n";
    await writeFile(join(f.preview, "README.md"), localEdit);
    await gitOk(["switch", "feature"], f.app);
    await addAndCommit(f.app, { "README.md": "feature v2\n" }, "Feature v2");
    await gitOk(["push", "origin", "feature"], f.app);

    const result = await polygit(["preview", "update", "integration"], { cwd: f.root });

    expect.soft(result.exitCode).not.toBe(0);
    expect.soft(result.stdout).not.toContain("Update complete.");
    // The fixture produces a real stash-pop conflict, not a failed feature merge.
    expect.soft(await gitOk(["diff", "--name-only", "--diff-filter=U"], f.preview))
      .toContain("README.md");
    expect.soft(await gitOk(["show", "stash@{0}:README.md"], f.preview))
      .toBe(localEdit.trim());
  });

  it("rebuilds from the current feature history instead of retaining obsolete merges", async () => {
    const f = await prepareFeature({ "obsolete.txt": "old feature\n" });
    await polygitOk(["preview", "add", "integration", "main", "feature"], { cwd: f.root });
    expect(await readFile(join(f.preview, "obsolete.txt"), "utf8")).toBe("old feature\n");
    // Simulate a developer replacing a feature's history, entirely on local origin.
    await gitOk(["switch", "feature"], f.app);
    await gitOk(["reset", "--hard", f.base], f.app);
    await addAndCommit(f.app, { "replacement.txt": "new feature\n" }, "Replacement feature");
    await gitOk(["push", "--force", "origin", "feature"], f.app);

    await polygitOk(["preview", "update", "integration"], { cwd: f.root });

    expect.soft(await readFile(join(f.preview, "replacement.txt"), "utf8")).toBe("new feature\n");
    await expect.soft(readFile(join(f.preview, "obsolete.txt"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
