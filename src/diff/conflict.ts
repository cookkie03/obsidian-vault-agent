import { createHash } from "node:crypto";

export class ConflictError extends Error {
  constructor() {
    super("File changed since the proposal was generated; re-read the file before retrying.");
    this.name = "ConflictError";
  }
}

export function snapshotHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function assertNoConflict(currentContent: string, snapshotHashAtProposalTime: string): void {
  if (snapshotHash(currentContent) !== snapshotHashAtProposalTime) {
    throw new ConflictError();
  }
}
