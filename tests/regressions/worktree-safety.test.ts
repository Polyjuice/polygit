import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { getHead, gitOk } from "../helpers/git.js";

describe.each(["worktree", "preview"])("%s removal preserves unfinished work (local origins only)", (command) => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  it.each([
    { kind: "tracked edit", filename: "README.md" },
    { kind: "untracked file", filename: "untracked.txt" },
  ])("refuses removal with a $kind and preserves its bytes", async ({ filename }) => {
    fixture = await createLocalFixture();
    const sourceHead = await getHead(fixture.members.app);
    if (command === "preview") {
      await gitOk(["branch", "feature"], fixture.members.app);
      await polygitOk(["preview", "add", "scratch", "main", "feature"], { cwd: fixture.root });
    } else {
      await polygitOk(["worktree", "add", "scratch"], { cwd: fixture.root });
    }
    const worktree = join(fixture.root, ".worktrees", "scratch", "app");
    expect(await getHead(worktree)).toBe(sourceHead);
    const file = join(worktree, filename);
    const content = "irreplaceable local work\n";
    await writeFile(file, content);
    const registryPath = join(fixture.meta, "worktrees.json");
    const registry = await readFile(registryPath, "utf8");
    const gitRegistry = await gitOk(["worktree", "list", "--porcelain"], fixture.members.app);

    const result = await polygit([command, "remove", "scratch"], { cwd: fixture.root });

    expect.soft(result.exitCode).not.toBe(0);
    const remainingContent = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    expect.soft(remainingContent).toBe(content);
    expect.soft(await readFile(registryPath, "utf8")).toBe(registry);
    expect.soft(await gitOk(["worktree", "list", "--porcelain"], fixture.members.app))
      .toBe(gitRegistry);
    expect.soft(await getHead(fixture.members.app)).toBe(sourceHead);
  });
});
