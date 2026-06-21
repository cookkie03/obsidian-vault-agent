import { VaultFS } from "./vault-fs";
import { snapshotHash, assertNoConflict } from "../diff/conflict";

export interface PendingChange {
  path: string;
  newContent: string;
  baseSnapshotHash: string;
  kind: "create" | "edit";
}

export async function applyPendingChange(fs: VaultFS, change: PendingChange): Promise<void> {
  if (change.kind === "create") {
    await fs.create(change.path, change.newContent);
    return;
  }
  const currentContent = await fs.read(change.path);
  assertNoConflict(currentContent, change.baseSnapshotHash);
  await fs.modify(change.path, change.newContent);
}

export { snapshotHash };
