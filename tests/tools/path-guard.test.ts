import { describe, it, expect } from "vitest";
import { assertSafePath, PathEscapeError } from "../../src/tools/path-guard";

describe("assertSafePath", () => {
  it("allows a normal vault-relative path", () => {
    expect(() => assertSafePath("notes/a.md")).not.toThrow();
  });

  it("rejects paths with ..", () => {
    expect(() => assertSafePath("../etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafePath("/etc/passwd")).toThrow(PathEscapeError);
  });
});
