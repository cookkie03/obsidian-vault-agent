import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { saveSession, listSessions, loadSession } from "../../src/storage/chat-sessions";

describe("chat sessions", () => {
  it("saves a session as JSON under .agents/chats/", async () => {
    const fs = new FakeVaultFS();
    await saveSession(fs, {
      id: "2026-06-20T10-00-00",
      createdAt: "2026-06-20T10:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    expect(await fs.exists(".agents/chats/2026-06-20T10-00-00.json")).toBe(true);
  });

  it("lists sessions with a preview of the first user message", async () => {
    const fs = new FakeVaultFS();
    await saveSession(fs, {
      id: "s1",
      createdAt: "2026-06-20T10:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "plan my week" }] }],
    });
    expect(await listSessions(fs)).toEqual([
      { id: "s1", createdAt: "2026-06-20T10:00:00.000Z", firstUserMessage: "plan my week" },
    ]);
  });

  it("loads a session back by id", async () => {
    const fs = new FakeVaultFS();
    const session = { id: "s1", createdAt: "2026-06-20T10:00:00.000Z", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }] };
    await saveSession(fs, session);
    expect(await loadSession(fs, "s1")).toEqual(session);
  });
});
