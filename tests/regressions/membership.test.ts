import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { changeMembership } from "../../src/core/membership.js";
import { createLocalFixture, type LocalFixture } from "../helpers/local-fixture.js";
import { getHead, gitOk } from "../helpers/git.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe("membership metadata write recovery", () => {
  let fixture: LocalFixture | undefined;
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    await fixture?.cleanup();
  });

  it("restores both original files and leaves no temporary files if the second replacement fails", async () => {
    fixture = await createLocalFixture();
    const config = join(fixture.meta, "config.json");
    const state = join(fixture.meta, "state.json");
    const original = await Promise.all([readFile(config, "utf8"), readFile(state, "utf8")]);
    const entries = await readdir(fixture.meta);
    const head = await getHead(fixture.meta);
    const index = await gitOk(["write-tree"], fixture.meta);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename)
      .mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(new Error("Simulated filesystem failure"));

    await expect(changeMembership({
      root: fixture.root, polygitDir: fixture.meta,
      mainPolygitDir: null, worktreeName: null,
    }, "app", "unlink")).rejects.toThrow("Simulated filesystem failure");

    expect(await Promise.all([readFile(config, "utf8"), readFile(state, "utf8")])).toEqual(original);
    expect(await readdir(fixture.meta)).toEqual(entries);
    expect(await getHead(fixture.meta)).toBe(head);
    expect(await gitOk(["write-tree"], fixture.meta)).toBe(index);
  });
});
