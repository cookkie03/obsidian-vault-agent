import { Plugin } from "obsidian";

export default class VaultAgentPlugin extends Plugin {
  async onload() {
    console.log("Vault Agent plugin loaded");
  }

  onunload() {
    console.log("Vault Agent plugin unloaded");
  }
}
