import { Plugin, WorkspaceLeaf } from "obsidian";
import { ObsidianVaultFS } from "./storage/obsidian-vault-fs";
import { loadConnectionSettings } from "./storage/connection-settings";
import { loadAgentConfig } from "./storage/agent-config";
import { OpenAICompatProvider } from "./provider/openai-compat-provider";
import { OllamaNativeProvider } from "./provider/ollama-native-provider";
import { ModelProvider } from "./provider/types";
import { buildSearchIndex } from "./tools/search-index";
import { ToolRegistry } from "./tools/registry";
import { ContextBudget } from "./agent/context-budget";
import { AgentLoop } from "./agent/loop";
import { VaultAgentSidePanelView, VIEW_TYPE_VAULT_AGENT } from "./ui/side-panel-view";
import { VaultAgentSettingTab } from "./ui/settings-tab";

export default class VaultAgentPlugin extends Plugin {
  async onload(): Promise<void> {
    const fs = new ObsidianVaultFS(this.app.vault);
    const settings = loadConnectionSettings(window.localStorage);
    if (!settings) {
      console.warn("Vault Agent: no connection settings configured yet (open plugin settings).");
      return;
    }

    const provider: ModelProvider =
      settings.providerType === "ollama-native"
        ? new OllamaNativeProvider(settings.baseUrl)
        : new OpenAICompatProvider(settings.baseUrl);

    const index = await buildSearchIndex(fs);
    const registry = new ToolRegistry(fs, index);
    const config = await loadAgentConfig(fs);
    const loop = new AgentLoop(provider, registry, new ContextBudget(), config);

    this.registerView(VIEW_TYPE_VAULT_AGENT, (leaf: WorkspaceLeaf) => new VaultAgentSidePanelView(leaf, loop, fs));
    this.addSettingTab(new VaultAgentSettingTab(this.app, this));

    this.app.vault.on("modify", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("create", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("delete", (file) => index.removeFile(file.path));
    index.setResolvedLinks(this.app.metadataCache.resolvedLinks);
    this.app.metadataCache.on("resolve", () => index.setResolvedLinks(this.app.metadataCache.resolvedLinks));
  }

  onunload(): void {}
}
