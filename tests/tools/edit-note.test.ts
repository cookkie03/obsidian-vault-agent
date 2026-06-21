import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeEditNote } from "../../src/tools/edit-note";
import { applyPendingChange } from "../../src/tools/pending-change";
import { ConflictError } from "../../src/diff/conflict";

describe("edit_note", () => {
  it("proposes an op-list edit and applies it", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    expect(change.newContent).toBe("Hello there");
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("Hello there");
  });

  it("falls back to full-content replacement when the anchor is not found", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", { fullContent: "Replaced entirely" });
    expect(change.newContent).toBe("Replaced entirely");
  });

  it("rejects apply when the file changed since the proposal (conflict)", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    await fs.modify("notes/a.md", "Someone else edited this");
    await expect(applyPendingChange(fs, change)).rejects.toThrow(ConflictError);
  });
});
