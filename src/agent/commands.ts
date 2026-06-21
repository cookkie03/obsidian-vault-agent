const BUILT_IN_COMMANDS = new Set(["resume", "clear", "compact", "help"]);

export interface ParsedCommand {
  command: string;
  args: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  if (!input.startsWith("/")) return null;
  const [head, ...rest] = input.slice(1).split(" ");
  return { command: head, args: rest.join(" ") };
}

export function isBuiltInCommand(command: string): boolean {
  return BUILT_IN_COMMANDS.has(command);
}
