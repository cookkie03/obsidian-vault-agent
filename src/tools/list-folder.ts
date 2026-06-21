import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

export async function listFolder(fs: VaultFS, path: string): Promise<{ files: string[]; folders: string[] }> {
  assertSafePath(path);
  return fs.list(path);
}
