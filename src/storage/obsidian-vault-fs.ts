import type { Vault, TFile } from "obsidian";
import { VaultFS } from "../tools/vault-fs";

export class ObsidianVaultFS implements VaultFS {
  constructor(private vault: Vault) {}

  async read(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return this.vault.read(file as TFile);
  }

  async create(path: string, content: string): Promise<void> {
    await this.vault.create(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`File not found: ${path}`);
    await this.vault.modify(file as TFile, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async list(folderPath: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = folderPath === "" ? "" : `${folderPath}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.vault.getAllLoadedFiles()) {
      if (!file.path.startsWith(prefix) || file.path === folderPath) continue;
      const rest = file.path.slice(prefix.length);
      if (rest.includes("/")) {
        folders.add(rest.split("/")[0]);
      } else {
        files.push(file.path);
      }
    }
    return { files, folders: [...folders] };
  }

  async delete(path: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file) await this.vault.delete(file);
  }
}
