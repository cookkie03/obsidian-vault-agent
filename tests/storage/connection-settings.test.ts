import { describe, it, expect } from "vitest";
import { loadConnectionSettings, saveConnectionSettings } from "../../src/storage/connection-settings";

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe("connection settings", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadConnectionSettings(new FakeStorage())).toBeNull();
  });

  it("round-trips through save and load", () => {
    const storage = new FakeStorage();
    saveConnectionSettings(storage, { providerType: "ollama-native", baseUrl: "http://mac.tailnet:11434" });
    expect(loadConnectionSettings(storage)).toEqual({ providerType: "ollama-native", baseUrl: "http://mac.tailnet:11434" });
  });
});
