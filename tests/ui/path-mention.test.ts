import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listAllPaths, fuzzyMatchPaths, detectMentionTrigger } from "../../src/ui/path-mention";

describe("path mention", () => {
  it("lists every file path in the vault", async () => {
    const fs = new FakeVaultFS();
    await fs.create("Projects/a.md", "1");
    await fs.create("Projects/Sub/b.md", "2");
    expect((await listAllPaths(fs)).sort()).toEqual(["Projects/Sub/b.md", "Projects/a.md"]);
  });

  it("matches paths by subsequence, case-insensitive", () => {
    const matches = fuzzyMatchPaths(["Projects/Roadmap.md", "Personal/Diary.md"], "prjrdm");
    expect(matches).toEqual(["Projects/Roadmap.md"]);
  });

  it("returns no matches when the query is not a subsequence", () => {
    expect(fuzzyMatchPaths(["Projects/Roadmap.md"], "xyz")).toEqual([]);
  });
});

describe("detectMentionTrigger", () => {
  it("detects an active @ trigger at the cursor with its query", () => {
    const text = "hello @pro";
    expect(detectMentionTrigger(text, text.length)).toEqual({ triggerStart: 6, query: "pro" });
  });

  it("detects a bare @ with an empty query", () => {
    expect(detectMentionTrigger("@", 1)).toEqual({ triggerStart: 0, query: "" });
  });

  it("returns null once the cursor has moved past the mention word", () => {
    const text = "hello @pro continue";
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });

  it("returns null when @ is glued to a preceding word (not a mention)", () => {
    const text = "foo@bar";
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });

  it("returns null when there is no @ before the cursor", () => {
    expect(detectMentionTrigger("hello there", 11)).toBeNull();
  });
});
