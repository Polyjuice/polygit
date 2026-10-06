import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdir, readFile, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { createTestDir } from "../helpers/fixtures.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, createGitRepo, getHead, gitOk } from "../helpers/git.js";

describe("link and unlink membership", () => {
  let fixture: LocalFixture;
  beforeEach(async () => { fixture = await createLocalFixture(["app", "lib"]); });
  afterEach(async () => { await fixture.cleanup(); });

  async function metadata() {
    return {
      config: await readFile(join(fixture.meta, "config.json"), "utf8"),
      state: await readFile(join(fixture.meta, "state.json"), "utf8"),
      head: await getHead(fixture.meta),
      index: await gitOk(["write-tree"], fixture.meta),
    };
  }

  async function expectFailure(args: string[], message?: string, cwd = fixture.root) {
    const before = await metadata();
    const result = await polygit(args, { cwd });
    expect(result.exitCode).not.toBe(0);
    if (message) expect(result.stderr).toContain(message);
    expect(await metadata()).toEqual(before);
    return result;
  }

  it("links an existing dirty repository, preserving other snapshots and the index", async () => {
    const path = join(fixture.root, "new repo");
    await createGitRepo(path);
    await gitOk(["remote", "add", "origin", "https://example.invalid/new.git"], path);
    await writeFile(join(path, "README.md"), "uncommitted edit\n");
    await writeFile(join(path, "untracked.txt"), "keep\n");
    const repoHead = await getHead(path);
    const repoStatus = await gitOk(["status", "--porcelain"], path);
    const before = await metadata();
    // Linking must not recapture unrelated members that have advanced.
    await addAndCommit(fixture.members.app, { "later.txt": "later\n" }, "Later");

    const result = await polygitOk(["link", "./new repo/"], { cwd: fixture.root });

    const after = await metadata();
    expect(JSON.parse(after.config).members).toEqual([
      ...JSON.parse(before.config).members,
      { path: "./new repo", remote: "https://example.invalid/new.git" },
    ]);
    expect(JSON.parse(after.state).members).toEqual({
      ...JSON.parse(before.state).members,
      "./new repo": { commit: repoHead, branch: "main" },
    });
    expect(after.head).toBe(before.head);
    expect(after.index).toBe(before.index);
    expect(await getHead(path)).toBe(repoHead);
    expect(await gitOk(["status", "--porcelain"], path)).toBe(repoStatus);
    expect(result.stdout).toContain("pgit commit");
    await polygitOk(["commit", "-m", "Link new repo"], { cwd: fixture.root });
    expect(JSON.parse(await gitOk(["show", "HEAD:config.json"], fixture.meta)).members)
      .toHaveLength(3);
  });

  it("links a nested detached checkout without an origin from a subdirectory", async () => {
    const path = join(fixture.root, "packages", "new");
    await createGitRepo(path);
    await gitOk(["checkout", "--detach"], path);
    await polygitOk(["link", "packages/new"], { cwd: fixture.members.app });
    const after = await metadata();
    expect(JSON.parse(after.config).members.at(-1)).toEqual({ path: "./packages/new" });
    expect(JSON.parse(after.state).members["./packages/new"])
      .toEqual({ commit: await getHead(path), branch: null });
  });

  it("accepts an absolute in-workspace path and records a relative origin as absolute", async () => {
    const path = join(fixture.root, "new");
    await createGitRepo(path);
    await gitOk(["remote", "add", "origin", "../.origins/app.git"], path);
    await polygitOk(["link", path], { cwd: fixture.root });
    expect(JSON.parse((await metadata()).config).members.at(-1)).toEqual({
      path: "./new", remote: await realpath(fixture.origins.app),
    });
  });

  it.each(["app", "./app/", "lib/../app"])("rejects duplicate alias %s", async (path) => {
    await expectFailure(["link", path], "already linked");
  });

  it.each(["link", "unlink"])("%s rejects unsafe paths", async (action) => {
    for (const path of ["", ".", "..", "/", "../outside", ".polygit", ".git", ".worktrees/test", "x/.git/y"]) {
      await expectFailure([action, path], path ? "Invalid member path" : "No value provided");
    }
  });

  it("rejects missing, ordinary, and unborn repositories", async () => {
    await expectFailure(["link", "absent"]);
    const path = join(fixture.root, "new");
    await mkdir(path);
    await expectFailure(["link", "new"]);
    await gitOk(["init"], path);
    await expectFailure(["link", "new"]);
  });

  it("rejects a directory inherited from an unregistered parent repository", async () => {
    const path = join(fixture.root, "new");
    await createGitRepo(path);
    await mkdir(join(path, "subdir"));
    await expectFailure(["link", "new/subdir"], "independent Git working tree");
  });

  it("rejects overlapping members in either direction", async () => {
    await createGitRepo(join(fixture.members.app, "child"));
    await expectFailure(["link", "app/child"], "overlaps");
    const parent = join(fixture.root, "packages");
    await createGitRepo(join(parent, "child"));
    await polygitOk(["link", "packages/child"], { cwd: fixture.root });
    await createGitRepo(parent);
    await expectFailure(["link", "packages"], "overlaps");
  });

  it("rejects symlinked checkouts and parents", async () => {
    await symlink(fixture.members.app, join(fixture.root, "alias"), "dir");
    await expectFailure(["link", "alias"], "without symlinks");
    await mkdir(join(fixture.root, "packages"));
    await createGitRepo(join(fixture.root, "packages", "child"));
    await symlink(join(fixture.root, "packages"), join(fixture.root, "alias-parent"), "dir");
    await expectFailure(["link", "alias-parent/child"], "without symlinks");
  });

  it("unlinks a moved checkout without accessing any member and commits the removal", async () => {
    const before = await metadata();
    const relocated = join(fixture.root, ".relocated-app");
    await rename(fixture.members.app, relocated);
    await rename(fixture.members.lib, join(fixture.root, ".unavailable-lib"));
    const head = await getHead(relocated);

    await polygitOk(["unlink", fixture.members.app], { cwd: fixture.root });

    const after = await metadata();
    expect(JSON.parse(after.config).members).toEqual([JSON.parse(before.config).members[1]]);
    expect(JSON.parse(after.state).members).toEqual({ "./lib": JSON.parse(before.state).members["./lib"] });
    expect(after.head).toBe(before.head);
    expect(after.index).toBe(before.index);
    expect(await getHead(relocated)).toBe(head);
    await expect(access(fixture.members.app)).rejects.toMatchObject({ code: "ENOENT" });

    await rename(join(fixture.root, ".unavailable-lib"), fixture.members.lib);
    await polygitOk(["commit", "-m", "Unlink app"], { cwd: fixture.root });
    expect(JSON.parse(await gitOk(["show", "HEAD:config.json"], fixture.meta)).members)
      .toEqual(JSON.parse(after.config).members);
    expect(JSON.parse(await gitOk(["show", `${before.head}:config.json`], fixture.meta)).members)
      .toHaveLength(2);
    await polygitOk(["status"], { cwd: fixture.root });
    const removal = await getHead(fixture.meta);
    await polygitOk(["checkout", before.head], { cwd: fixture.root });
    expect(await getHead(fixture.members.app)).toBe(head);
    await polygitOk(["checkout", removal], { cwd: fixture.root });
    // Restoring the removal snapshot leaves the now-unregistered checkout intact.
    expect(await getHead(fixture.members.app)).toBe(head);
  });

  it("preserves tracked edits, untracked files, HEAD and Git worktree registration when unlinking", async () => {
    const app = fixture.members.app;
    await writeFile(join(app, "README.md"), "unfinished\n");
    await writeFile(join(app, "untracked.txt"), "precious\n");
    const head = await getHead(app);
    const registry = await gitOk(["worktree", "list", "--porcelain"], app);
    await polygitOk(["unlink", "app"], { cwd: join(app, "src") });
    expect(await readFile(join(app, "README.md"), "utf8")).toBe("unfinished\n");
    expect(await readFile(join(app, "untracked.txt"), "utf8")).toBe("precious\n");
    expect(await getHead(app)).toBe(head);
    expect(await gitOk(["worktree", "list", "--porcelain"], app)).toBe(registry);
  });

  it("can unlink all members, and rejects unknown or repeated removals", async () => {
    await expectFailure(["unlink", "unknown"], "not linked");
    await polygitOk(["unlink", fixture.members.app], { cwd: fixture.root });
    await expectFailure(["unlink", "app"], "not linked");
    await polygitOk(["unlink", "lib"], { cwd: fixture.root });
    const after = await metadata();
    expect(JSON.parse(after.config).members).toEqual([]);
    expect(JSON.parse(after.state).members).toEqual({});
    await polygitOk(["commit", "-m", "Empty workspace"], { cwd: fixture.root });
  });

  it("removes legacy path aliases and tolerates an absent saved member state", async () => {
    const before = await metadata();
    const config = JSON.parse(before.config);
    config.members[0].path = "app/";
    const state = JSON.parse(before.state);
    delete state.members["./app"];
    state.members["app/"] = JSON.parse(before.state).members["./app"];
    await writeFile(join(fixture.meta, "config.json"), JSON.stringify(config));
    await writeFile(join(fixture.meta, "state.json"), JSON.stringify(state));
    await polygitOk(["unlink", "app"], { cwd: fixture.root });
    expect(JSON.parse((await metadata()).state).members).not.toHaveProperty("app/");
    delete state.members["./lib"];
    delete state.members["app/"];
    await writeFile(join(fixture.meta, "state.json"), JSON.stringify(state));
    await polygitOk(["unlink", "lib"], { cwd: fixture.root });
  });

  it.each(["worktree", "preview"])("refuses both changes while a %s set exists, including from inside it", async (kind) => {
    if (kind === "worktree") {
      await polygitOk(["worktree", "add", "scratch"], { cwd: fixture.root });
    } else {
      for (const member of Object.values(fixture.members)) await gitOk(["branch", "feature"], member);
      await polygitOk(["preview", "add", "scratch", "main", "feature"], { cwd: fixture.root });
    }
    const registry = await readFile(join(fixture.meta, "worktrees.json"), "utf8");
    await createGitRepo(join(fixture.root, "new"));
    for (const args of [["link", "new"], ["unlink", "app"]]) {
      await expectFailure(args, "Remove registered worktree sets");
      await expectFailure(args, "main polyrepo", join(fixture.root, ".worktrees", "scratch"));
    }
    expect(await readFile(join(fixture.meta, "worktrees.json"), "utf8")).toBe(registry);
  });

  it.each(["link", "unlink"])("%s refuses staged membership metadata", async (action) => {
    await createGitRepo(join(fixture.root, "new"));
    await writeFile(join(fixture.meta, "state.json"), (await metadata()).state + "\n");
    await gitOk(["add", "state.json"], fixture.meta);
    await expectFailure([action, action === "link" ? "new" : "app"], "staged");
  });

  it("preserves unrelated staged metadata and unstaged configuration edits", async () => {
    const config = JSON.parse((await metadata()).config);
    config.name = "Renamed workspace";
    await writeFile(join(fixture.meta, "config.json"), JSON.stringify(config));
    await writeFile(join(fixture.meta, "notes.txt"), "notes\n");
    await gitOk(["add", "notes.txt"], fixture.meta);
    const before = await metadata();
    await polygitOk(["unlink", "app"], { cwd: fixture.root });
    const after = await metadata();
    expect(JSON.parse(after.config).name).toBe(config.name);
    expect(after.index).toBe(before.index);
  });

  it("rejects malformed metadata without modifying it", async () => {
    await writeFile(join(fixture.meta, "state.json"), "{ broken");
    await expectFailure(["unlink", "app"]);
    await writeFile(join(fixture.meta, "state.json"), '{"members":[]}');
    await expectFailure(["unlink", "app"], "Invalid membership metadata");
  });

  it("refuses symlinked metadata without modifying its target", async () => {
    const path = join(fixture.meta, "state.json");
    const target = join(fixture.root, "saved-state.json");
    await rename(path, target);
    await symlink(target, path);
    const before = await readFile(target, "utf8");
    await expectFailure(["unlink", "app"], "regular file");
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("refuses commands outside a polyrepo", async () => {
    const outside = await createTestDir();
    try {
      for (const action of ["link", "unlink"]) {
        const result = await polygit([action, "app"], { cwd: outside.tempDir });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Not in a polygit repository");
      }
    } finally { await outside.cleanup(); }
  });
});
