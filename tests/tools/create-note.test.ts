import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeCreateNote } from "../../src/tools/create-note";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("create_note", () => {
  it("proposes a pending change without writing to the filesystem", async () => {
    const fs = new FakeVaultFS();
    const change = await proposeCreateNote(fs, "Projects/new.md", "# New note");
    expect(await fs.exists("Projects/new.md")).toBe(false);
    expect(change).toEqual({ path: "Projects/new.md", newContent: "# New note", baseSnapshotHash: expect.any(String), kind: "create" });
  });

  it("applying the pending change writes the file", async () => {
    const fs = new FakeVaultFS();
    const change = await proposeCreateNote(fs, "Projects/new.md", "# New note");
    await applyPendingChange(fs, change);
    expect(await fs.read("Projects/new.md")).toBe("# New note");
  });
});
