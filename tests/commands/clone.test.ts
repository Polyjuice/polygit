import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { polygit, polygitOk } from "../helpers/cli.js";
import { addAndCommit, getCurrentBranch, getHead, gitOk } from "../helpers/git.js";

describe("polygit clone (local bare origins only)", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => { await fixture?.cleanup(); });

  it("clones a complete snapshot even when member branches have advanced", async () => {
    fixture = await createLocalFixture(["app", "lib"]);
    const expected = JSON.parse(await gitOk(["show", "HEAD:state.json"], fixture.meta));
    const newer = await addAndCommit(fixture.members.app, { "later.txt": "not in snapshot\n" }, "Later work");
    await gitOk(["push", "origin", "main"], fixture.members.app);
    const destination = join(fixture.root, ".worker");

    await polygitOk(["clone", fixture.metaOrigin, destination], { cwd: fixture.root });

    expect(await getHead(join(destination, ".polygit"))).toBe(await getHead(fixture.meta));
    expect(await getCurrentBranch(join(destination, ".polygit"))).toBe("main");
    for (const name of ["app", "lib"]) {
      const member = join(destination, name);
      expect(await getHead(member)).toBe(expected.members[`./${name}`].commit);
      expect(await gitOk(["remote", "get-url", "origin"], member)).toBe(fixture.origins[name]);
      expect(await gitOk(["status", "--porcelain"], member)).toBe("");
    }
    await expect(access(join(destination, "app", "later.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await getHead(fixture.members.app)).toBe(newer);
  });

  it("clones the requested metadata branch and its recorded revisions", async () => {
    fixture = await createLocalFixture();
    await polygitOk(["branch", "feature"], { cwd: fixture.root });
    const saved = await addAndCommit(fixture.members.app, { "feature.txt": "feature\n" }, "Feature");
    await gitOk(["push", "origin", "feature"], fixture.members.app);
    await polygitOk(["commit", "-m", "Feature snapshot"], { cwd: fixture.root });
    await gitOk(["push", "origin", "feature"], fixture.meta);
    const destination = join(fixture.root, ".feature-worker");

    await polygitOk(["clone", "--branch", "feature", fixture.metaOrigin, destination], { cwd: fixture.root });

    expect(await getCurrentBranch(join(destination, ".polygit"))).toBe("feature");
    expect(await getHead(join(destination, "app"))).toBe(saved);
    expect(await readFile(join(destination, "app", "feature.txt"), "utf8")).toBe("feature\n");
    // Branch checkout after cloning still offers an attached development branch.
    await polygitOk(["checkout", "feature"], { cwd: destination });
    expect(await getCurrentBranch(join(destination, "app"))).toBe("feature");
  });

  it("infers a directory name when none is supplied", async () => {
    fixture = await createLocalFixture();
    const parent = join(fixture.root, ".destination");
    await mkdir(parent);

    await polygitOk(["clone", fixture.metaOrigin], { cwd: parent });

    expect(await getHead(join(parent, "meta", "app"))).toBe(await getHead(fixture.members.app));
  });

  it("accepts an empty destination directory", async () => {
    fixture = await createLocalFixture();
    const destination = join(fixture.root, ".empty-worker");
    await mkdir(destination);

    await polygitOk(["clone", fixture.metaOrigin, destination], { cwd: fixture.root });

    expect(await getHead(join(destination, "app"))).toBe(await getHead(fixture.members.app));
  });

  it("refuses an occupied destination without modifying it", async () => {
    fixture = await createLocalFixture();
    const destination = join(fixture.root, ".occupied");
    await mkdir(destination);
    const file = join(destination, "notes.txt");
    await writeFile(file, "keep this\n");

    const result = await polygit(["clone", fixture.metaOrigin, destination], { cwd: fixture.root });

    expect(result.exitCode).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("keep this\n");
    await expect(access(join(destination, ".polygit"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("can retry a failed clone after an unavailable member revision is published", async () => {
    fixture = await createLocalFixture();
    const saved = await addAndCommit(fixture.members.app, { "local-only.txt": "ready later\n" }, "Unpublished revision");
    await polygitOk(["commit", "-m", "Not yet available"], { cwd: fixture.root });
    await gitOk(["push", "origin", "main"], fixture.meta);
    const snapshot = await getHead(fixture.meta);
    const worker = join(fixture.root, ".worker");

    const failed = await polygit(["clone", fixture.metaOrigin, worker], { cwd: fixture.root });

    expect(failed.exitCode).not.toBe(0);
    expect(failed.stderr).toContain("./app");
    expect(failed.stdout).not.toContain("Polygit cloned to");
    expect(await getHead(join(worker, ".polygit"))).toBe(snapshot);
    await expect(access(join(worker, "app"))).rejects.toMatchObject({ code: "ENOENT" });

    await gitOk(["push", "origin", `${saved}:refs/tags/polygit/commits/${saved}`], fixture.members.app);
    await polygitOk(["checkout", snapshot], { cwd: worker });
    expect(await getHead(join(worker, "app"))).toBe(saved);
    // Repeating the restore uses the completed clone and leaves a clean tree.
    await polygitOk(["checkout", snapshot, "--offline"], { cwd: worker });
    expect(await gitOk(["status", "--porcelain"], join(worker, "app"))).toBe("");
  });

  it("rejects a manifest path that escapes the workspace", async () => {
    fixture = await createLocalFixture();
    const config = JSON.parse(await readFile(join(fixture.meta, "config.json"), "utf8"));
    const state = JSON.parse(await readFile(join(fixture.meta, "state.json"), "utf8"));
    config.members[0].path = "../escape";
    state.members["../escape"] = state.members["./app"];
    delete state.members["./app"];
    await addAndCommit(fixture.meta, { "config.json": JSON.stringify(config), "state.json": JSON.stringify(state) }, "Unsafe path");
    await gitOk(["push", "origin", "main"], fixture.meta);
    const worker = join(fixture.root, ".worker");

    const result = await polygit(["clone", fixture.metaOrigin, worker], { cwd: fixture.root });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsafe member path");
    await expect(access(join(fixture.root, "escape"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
