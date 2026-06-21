import { describe, it, expect, vi } from "vitest";
import { ObsidianVaultFS } from "../../src/storage/obsidian-vault-fs";

function fakeVault() {
  const file = { path: "notes/a.md" };
  return {
    getAbstractFileByPath: vi.fn((p: string) => (p === "notes/a.md" ? file : null)),
    read: vi.fn().mockResolvedValue("content"),
    create: vi.fn().mockResolvedValue(undefined),
    modify: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getAllLoadedFiles: vi.fn().mockReturnValue([{ path: "notes/a.md" }, { path: "notes/sub/b.md" }]),
  };
}

describe("ObsidianVaultFS", () => {
  it("reads a file via getAbstractFileByPath + vault.read", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.read("notes/a.md")).toBe("content");
    expect(vault.read).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/a.md" }));
  });

  it("exists returns false when getAbstractFileByPath returns null", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.exists("missing.md")).toBe(false);
  });

  it("list filters loaded files to direct children of a folder", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.list("notes")).toEqual({ files: ["notes/a.md"], folders: ["sub"] });
  });
});
