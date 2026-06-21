import { describe, it, expect } from "vitest";
import { stepEventToLabel, formatDiffPreview } from "../../src/ui/render-helpers";

describe("stepEventToLabel", () => {
  it("labels a tool-call event", () => {
    expect(stepEventToLabel({ type: "tool-call", name: "search_notes" })).toBe("🔧 calling search_notes...");
  });

  it("labels a tool-result event", () => {
    expect(stepEventToLabel({ type: "tool-result", name: "search_notes" })).toBe("✓ search_notes done");
  });

  it("labels a pending-change event", () => {
    expect(stepEventToLabel({ type: "pending-change", change: { path: "a.md", newContent: "x", baseSnapshotHash: "h", kind: "create" } })).toBe(
      "⏸ waiting for approval: create a.md"
    );
  });
});

describe("formatDiffPreview", () => {
  it("marks added lines for a create", () => {
    const preview = formatDiffPreview({ path: "a.md", newContent: "line one\nline two", baseSnapshotHash: "h", kind: "create" }, "");
    expect(preview).toBe("+line one\n+line two");
  });

  it("marks changed lines for an edit by diffing old vs new line by line", () => {
    const preview = formatDiffPreview(
      { path: "a.md", newContent: "kept\nchanged-new", baseSnapshotHash: "h", kind: "edit" },
      "kept\nchanged-old"
    );
    expect(preview).toBe(" kept\n-changed-old\n+changed-new");
  });
});
