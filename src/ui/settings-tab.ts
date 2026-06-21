import { App, PluginSettingTab, Setting } from "obsidian";
import { ConnectionSettings, loadConnectionSettings, saveConnectionSettings } from "../storage/connection-settings";
import type VaultAgentPlugin from "../main";

export class VaultAgentSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VaultAgentPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    const current: ConnectionSettings = loadConnectionSettings(window.localStorage) ?? {
      providerType: "openai-compat",
      baseUrl: "",
    };

    new Setting(this.containerEl)
      .setName("Provider type")
      .addDropdown((drop) =>
        drop
          .addOption("openai-compat", "OpenAI-compatible")
          .addOption("ollama-native", "Ollama-native")
          .setValue(current.providerType)
          .onChange((value) => {
            current.providerType = value as ConnectionSettings["providerType"];
            saveConnectionSettings(window.localStorage, current);
          })
      );

    new Setting(this.containerEl)
      .setName("Base URL")
      .setDesc("Tailscale/MagicDNS address of the remote model server. Stored on this device only, never in the vault.")
      .addText((text) =>
        text.setValue(current.baseUrl).onChange((value) => {
          current.baseUrl = value;
          saveConnectionSettings(window.localStorage, current);
        })
      );
  }
}
