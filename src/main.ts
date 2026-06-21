import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
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
    // Always register the settings tab first: it's the only way to set
    // connection settings the first time, so it can't be gated behind
    // settings already existing.
    this.addSettingTab(new VaultAgentSettingTab(this.app, this));

    const fs = new ObsidianVaultFS(this.app.vault);
    const settings = loadConnectionSettings(window.localStorage);
    if (!settings) {
      console.warn("Vault Agent: no connection settings configured yet (open plugin settings).");
      this.addRibbonIcon("bot", "Vault Agent", () => {
        new Notice("Vault Agent: configure provider type and base URL in plugin settings first.");
      });
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
    this.addRibbonIcon("bot", "Vault Agent", () => this.activateView());
    this.addCommand({
      id: "open-vault-agent",
      name: "Open Vault Agent panel",
      callback: () => this.activateView(),
    });

    this.app.vault.on("modify", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("create", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("delete", (file) => index.removeFile(file.path));
    index.setResolvedLinks(this.app.metadataCache.resolvedLinks);
    this.app.metadataCache.on("resolve", () => index.setResolvedLinks(this.app.metadataCache.resolvedLinks));
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_VAULT_AGENT)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      leaf = rightLeaf ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_VAULT_AGENT, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload(): void {}
}
