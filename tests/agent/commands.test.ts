import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/agent/commands";

describe("parseCommand", () => {
  it("parses /resume with an id argument", () => {
    expect(parseCommand("/resume s1")).toEqual({ command: "resume", args: "s1" });
  });

  it("parses /resume with no argument", () => {
    expect(parseCommand("/resume")).toEqual({ command: "resume", args: "" });
  });

  it("parses /clear, /compact, /help", () => {
    expect(parseCommand("/clear")).toEqual({ command: "clear", args: "" });
    expect(parseCommand("/compact")).toEqual({ command: "compact", args: "" });
    expect(parseCommand("/help")).toEqual({ command: "help", args: "" });
  });

  it("treats an unrecognized leading slash as a skill invocation", () => {
    expect(parseCommand("/summarize in Italian")).toEqual({ command: "summarize", args: "in Italian" });
  });

  it("returns null for plain text", () => {
    expect(parseCommand("hello there")).toBeNull();
  });
});
