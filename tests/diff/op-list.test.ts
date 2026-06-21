import { describe, it, expect } from "vitest";
import { applyOpList, AnchorNotFoundError } from "../../src/diff/op-list";

describe("applyOpList", () => {
  it("replaces text at an anchor", () => {
    const result = applyOpList("Hello world", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    expect(result).toBe("Hello there");
  });

  it("inserts after an anchor", () => {
    const result = applyOpList("Line one\nLine two", [
      { type: "insert_after", anchor: "Line one", text: "Inserted line" },
    ]);
    expect(result).toBe("Line one\nInserted line\nLine two");
  });

  it("deletes an anchored block", () => {
    const result = applyOpList("Keep this\nDelete this\nKeep that", [
      { type: "delete", anchor: "Delete this" },
    ]);
    expect(result).toBe("Keep this\nKeep that");
  });

  it("applies multiple operations in order", () => {
    const result = applyOpList("A\nB\nC", [
      { type: "replace", anchor: "B", old: "B", new: "B2" },
      { type: "insert_after", anchor: "C", text: "D" },
    ]);
    expect(result).toBe("A\nB2\nC\nD");
  });

  it("throws AnchorNotFoundError when the anchor text is not in the file", () => {
    expect(() =>
      applyOpList("Hello world", [{ type: "replace", anchor: "missing", old: "missing", new: "x" }])
    ).toThrow(AnchorNotFoundError);
  });
});
