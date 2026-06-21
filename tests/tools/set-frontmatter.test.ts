import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeSetFrontmatter } from "../../src/tools/frontmatter";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("set_frontmatter", () => {
  it("merges new keys into existing frontmatter, preserving the body", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntitle: Old\n---\nBody text");
    const change = await proposeSetFrontmatter(fs, "notes/a.md", { title: "New", status: "done" });
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("---\ntitle: New\nstatus: done\n---\nBody text");
  });
});
