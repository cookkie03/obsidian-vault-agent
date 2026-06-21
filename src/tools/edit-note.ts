import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { PendingChange, snapshotHash } from "./pending-change";
import { applyOpList, OpListOperation, AnchorNotFoundError } from "../diff/op-list";

export type EditNoteRequest = OpListOperation[] | { fullContent: string };

export async function proposeEditNote(fs: VaultFS, path: string, request: EditNoteRequest): Promise<PendingChange> {
  assertSafePath(path);
  const currentContent = await fs.read(path);
  const newContent = Array.isArray(request)
    ? applyOpList(currentContent, request)
    : request.fullContent;
  return { path, newContent, baseSnapshotHash: snapshotHash(currentContent), kind: "edit" };
}

export { AnchorNotFoundError };
