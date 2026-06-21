import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeManageTags } from "../../src/tools/manage-tags";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("manage_tags", () => {
  it("adds and removes tags in frontmatter", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntags:\n  - keep\n  - drop\n---\nBody");
    const change = await proposeManageTags(fs, "notes/a.md", ["new"], ["drop"]);
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("---\ntags:\n  - keep\n  - new\n---\nBody");
  });
});
