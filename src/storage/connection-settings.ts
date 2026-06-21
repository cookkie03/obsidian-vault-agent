const STORAGE_KEY = "vault-agent:connection-settings";

export interface ConnectionSettings {
  providerType: "openai-compat" | "ollama-native";
  baseUrl: string;
}

export function loadConnectionSettings(storage: Storage): ConnectionSettings | null {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveConnectionSettings(storage: Storage, settings: ConnectionSettings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
