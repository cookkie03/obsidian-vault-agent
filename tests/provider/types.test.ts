import { describe, it, expect } from "vitest";
import { ChatMessage } from "../../src/provider/types";

describe("ChatMessage", () => {
  it("supports a plain text user message", () => {
    const msg: ChatMessage = { role: "user", content: [{ type: "text", text: "hi" }] };
    expect(msg.content[0]).toEqual({ type: "text", text: "hi" });
  });
});
