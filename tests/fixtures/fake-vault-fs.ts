import { VaultFS } from "../../src/tools/vault-fs";

export class FakeVaultFS implements VaultFS {
  private files = new Map<string, string>();

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    this.files.set(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async list(folderPath: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = folderPath === "" ? "" : `${folderPath}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) {
        folders.add(rest.split("/")[0]);
      } else {
        files.push(path);
      }
    }
    return { files, folders: [...folders] };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}
