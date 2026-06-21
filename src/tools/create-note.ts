import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { PendingChange, snapshotHash } from "./pending-change";

export async function proposeCreateNote(fs: VaultFS, path: string, content: string): Promise<PendingChange> {
  assertSafePath(path);
  return { path, newContent: content, baseSnapshotHash: snapshotHash(""), kind: "create" };
}
