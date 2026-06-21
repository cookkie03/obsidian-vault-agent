import { describe, it, expect } from "vitest";
import { snapshotHash, assertNoConflict, ConflictError } from "../../src/diff/conflict";

describe("conflict detection", () => {
  it("produces the same hash for identical content", () => {
    expect(snapshotHash("hello")).toBe(snapshotHash("hello"));
  });

  it("produces a different hash for different content", () => {
    expect(snapshotHash("hello")).not.toBe(snapshotHash("hello!"));
  });

  it("does not throw when the file is unchanged since the snapshot", () => {
    const hash = snapshotHash("original content");
    expect(() => assertNoConflict("original content", hash)).not.toThrow();
  });

  it("throws ConflictError when the file changed since the snapshot", () => {
    const hash = snapshotHash("original content");
    expect(() => assertNoConflict("someone edited this", hash)).toThrow(ConflictError);
  });
});
