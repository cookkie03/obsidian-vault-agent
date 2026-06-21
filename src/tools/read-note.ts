import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

export async function readNote(fs: VaultFS, path: string): Promise<string> {
  assertSafePath(path);
  return fs.read(path);
}
