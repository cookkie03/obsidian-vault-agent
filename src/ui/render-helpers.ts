import { StepEvent } from "../agent/loop";
import { PendingChange } from "../tools/pending-change";

export function stepEventToLabel(event: StepEvent): string {
  switch (event.type) {
    case "tool-call":
      return `🔧 calling ${event.name}...`;
    case "tool-result":
      return `✓ ${event.name} done`;
    case "pending-change":
      return `⏸ waiting for approval: ${event.change.kind} ${event.change.path}`;
    case "final":
      return event.text;
    case "error":
      return `⚠ ${event.message}`;
    case "compact":
      return "♻️ compacted older messages into a summary";
  }
}

export function formatDiffPreview(change: PendingChange, oldContent: string): string {
  if (change.kind === "create") {
    return change.newContent.split("\n").map((line) => `+${line}`).join("\n");
  }
  const oldLines = oldContent.split("\n");
  const newLines = change.newContent.split("\n");
  const length = Math.max(oldLines.length, newLines.length);
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      out.push(` ${oldLine ?? ""}`);
    } else {
      if (oldLine !== undefined) out.push(`-${oldLine}`);
      if (newLine !== undefined) out.push(`+${newLine}`);
    }
  }
  return out.join("\n");
}
