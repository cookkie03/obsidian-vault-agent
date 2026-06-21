import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { ToolRegistry } from "../../src/tools/registry";
import { buildSearchIndex } from "../../src/tools/search-index";

describe("ToolRegistry", () => {
  it("dispatches a read-only tool and returns its result immediately", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "hello");
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const outcome = await registry.dispatch({ id: "1", name: "read_note", arguments: { path: "notes/a.md" } });
    expect(outcome).toEqual({ kind: "result", value: "hello" });
  });

  it("dispatches a mutating tool and returns a pending change instead of writing", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const outcome = await registry.dispatch({ id: "2", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } });
    expect(outcome.kind).toBe("pending");
    expect(await fs.exists("notes/new.md")).toBe(false);
  });

  it("exposes a schema for every registered tool", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const names = registry.schemas().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([
      "search_notes", "read_note", "read_image", "list_folder",
      "get_frontmatter", "set_frontmatter", "manage_tags", "create_note", "edit_note",
    ]));
  });
});
