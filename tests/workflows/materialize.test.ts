import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getHead, git, gitOk } from "../helpers/git.js";

describe("workspace materialization (local bare origins only)", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  async function metadataOnly() {
    const f = fixture!;
    const worker = join(f.root, ".worker");
    await mkdir(worker);
    await gitOk(["clone", "--", f.metaOrigin, join(worker, ".polygit")], f.root);
    return worker;
  }

  async function publishPin() {
    const f = fixture!;
    const saved = await addAndCommit(f.members.app, { "pinned.txt": "snapshot-only work\n" }, "Pinned revision");
    // Origin main stays at the old commit. Only an explicitly fetched pin exposes this revision.
    await gitOk(["push", "origin", `${saved}:refs/tags/polygit/commits/${saved}`], f.members.app);
    await polygitOk(["commit", "-m", "Pinned snapshot"], { cwd: f.root });
    await gitOk(["push", "origin", "main"], f.meta);
    return { saved, snapshot: await getHead(f.meta) };
  }

  it("checkout clones a missing member and explicitly fetches its snapshot pin", async () => {
    fixture = await createLocalFixture();
    const { saved, snapshot } = await publishPin();
    const worker = await metadataOnly();

    await polygitOk(["checkout", snapshot], { cwd: worker });

    expect(await getHead(join(worker, "app"))).toBe(saved);
    expect(await readFile(join(worker, "app", "pinned.txt"), "utf8")).toBe("snapshot-only work\n");
  });

  it("checkout fetches a pinned revision absent from an existing shallow no-tags clone", async () => {
    fixture = await createLocalFixture();
    const { saved, snapshot } = await publishPin();
    const worker = await metadataOnly();
    const app = join(worker, "app");
    await gitOk(["clone", "--depth", "1", "--no-tags", pathToFileURL(fixture.origins.app).href, app], worker);
    expect((await git(["cat-file", "-e", saved], app)).exitCode).not.toBe(0);

    await polygitOk(["checkout", snapshot], { cwd: worker });

    expect(await getHead(app)).toBe(saved);
  });

  it("can fetch a published commit without requiring a Polygit tag", async () => {
    fixture = await createLocalFixture();
    const worker = await metadataOnly();
    const app = join(worker, "app");
    await gitOk(["clone", "--no-local", fixture.origins.app, app], worker);
    const saved = await addAndCommit(fixture.members.app, { "new.txt": "new\n" }, "Published revision");
    await gitOk(["push", "origin", "main"], fixture.members.app);
    await polygitOk(["commit", "-m", "Published snapshot"], { cwd: fixture.root });
    await gitOk(["push", "origin", "main"], fixture.meta);
    await gitOk(["fetch", "origin"], join(worker, ".polygit"));

    await polygitOk(["checkout", await getHead(fixture.meta)], { cwd: worker });

    expect(await getHead(app)).toBe(saved);
  });


  it("rejects a snapshot tag pointing at the wrong commit", async () => {
    fixture = await createLocalFixture();
    const old = await getHead(fixture.members.app);
    const saved = await addAndCommit(fixture.members.app, { "target.txt": "target\n" }, "Target revision");
    await gitOk(["push", "origin", `${old}:refs/tags/polygit/commits/${saved}`], fixture.members.app);
    await polygitOk(["commit", "-m", "Wrong remote pin"], { cwd: fixture.root });
    await gitOk(["push", "origin", "main"], fixture.meta);
    const worker = await metadataOnly();

    const result = await polygit(["checkout", await getHead(fixture.meta)], { cwd: worker });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("does not point to");
    await expect(access(join(worker, "app"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("offline checkout refuses to clone a missing member", async () => {
    fixture = await createLocalFixture();
    const worker = await metadataOnly();
    const snapshot = await getHead(fixture.meta);

    const result = await polygit(["checkout", snapshot, "--offline"], { cwd: worker });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--offline");
    await expect(access(join(worker, "app"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("offline checkout refuses a missing object without fetching it", async () => {
    fixture = await createLocalFixture();
    const { saved, snapshot } = await publishPin();
    const worker = await metadataOnly();
    const app = join(worker, "app");
    await gitOk(["clone", "--no-tags", "--no-local", fixture.origins.app, app], worker);
    const before = await getHead(app);

    const result = await polygit(["checkout", snapshot, "--offline"], { cwd: worker });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--offline");
    expect(await getHead(app)).toBe(before);
    expect((await git(["cat-file", "-e", saved], app)).exitCode).not.toBe(0);
  });

  it("offline checkout works with local objects while the origin is unavailable", async () => {
    fixture = await createLocalFixture();
    const snapshot = await getHead(fixture.meta);
    await rename(fixture.origins.app, fixture.origins.app + ".unavailable");

    await polygitOk(["checkout", snapshot, "--offline"], { cwd: fixture.root });

    expect(await getHead(fixture.members.app)).toBe(JSON.parse(
      await gitOk(["show", `${snapshot}:state.json`], fixture.meta),
    ).members["./app"].commit);
  });

  it.each(["directory", "symlink"])("preserves an unrelated %s at a member destination", async (kind) => {
    fixture = await createLocalFixture();
    const worker = await metadataOnly();
    const app = join(worker, "app");
    const sourceHead = await getHead(fixture.members.app);
    if (kind === "symlink") await symlink(fixture.members.app, app, "dir");
    else {
      await mkdir(app);
      await writeFile(join(app, "notes.txt"), "keep\n");
    }

    const result = await polygit(["checkout", await getHead(fixture.meta), "--force"], { cwd: worker });

    expect(result.exitCode).not.toBe(0);
    expect(await getHead(fixture.members.app)).toBe(sourceHead);
    if (kind === "directory") expect(await readFile(join(app, "notes.txt"), "utf8")).toBe("keep\n");
  });

  it("fails clearly when a missing member has no recorded repository URL", async () => {
    fixture = await createLocalFixture();
    const config = JSON.parse(await readFile(join(fixture.meta, "config.json"), "utf8"));
    delete config.members[0].remote;
    await addAndCommit(fixture.meta, { "config.json": JSON.stringify(config) }, "No source URL");
    await gitOk(["push", "origin", "main"], fixture.meta);
    const worker = await metadataOnly();

    const result = await polygit(["checkout", await getHead(fixture.meta)], { cwd: worker });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("./app");
    expect(result.stderr).toContain("No repository URL");
  });

});
