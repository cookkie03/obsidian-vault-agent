# Obsidian Vault Agent Plugin v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Obsidian plugin that gives an AI agent (remote, multimodal) read/write access to the vault, with human-in-the-loop approval on every mutating action, lazy local retrieval, and a chat side panel.

**Architecture:** Four isolated modules (`provider/`, `tools/`, `agent/`, `ui/`) per `docs/superpowers/specs/2026-06-18-obsidian-agent-plugin-design.md`. Tools depend on a small `VaultFS` interface (not `app.vault` directly), so they're unit-testable against an in-memory/temp-dir fake and, in production, backed by the real Obsidian vault. No agentic framework dependency (no LangChain/Vercel AI SDK), no vector DB.

**Tech Stack:** TypeScript, esbuild (bundling), vitest (unit tests), `js-yaml` (frontmatter parsing only — small, not a framework).

## Global Constraints

- No shell/network-generic tools — vault scope only (ADR 0006: tools touch the filesystem only via `VaultFS`, never raw `fs` with absolute paths).
- Every path argument from a tool call is rejected (structured error, not silent normalization) if it contains `..` or starts with `/` (ADR 0006).
- Mutating tools never write directly — they produce a pending change (diff) and suspend the loop until the user approves/rejects (design doc, Gestione errori).
- `edit_note` diff format: JSON op-list with text anchors as primary; full-file-content fallback only after an anchor-resolution error (ADR 0004).
- Conflict detection on apply: hash of file content at proposal time vs. hash at apply time; mismatch aborts the apply and returns a structured error to the model instructing it to re-read the file (ADR 0004, confirmed conversation).
- Connection settings (host, MagicDNS hostname, any future token) live in `window.localStorage` only — never in `data.json`/vault (ADR 0002).
- Chat sessions live in vault at `.agents/chats/<session-id>.json`; agent config at `.agents/config.json`; skills at `.agents/skills/*.md` (ADR 0003, ADR 0005).
- `.agents/` is always excluded from `search_notes` results and from the backlink graph.
- No token streaming in v1; tool-call progress is surfaced to the UI as discrete step events from the agent loop (confirmed conversation).
- No application-level auth on provider calls in v1 (ADR 0001) — relies on Tailscale network-level security.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `vitest.config.ts`
- Create: `src/main.ts`
- Test: `tests/main.test.ts`

**Interfaces:**
- Produces: a buildable, testable empty plugin shell. Later tasks add modules under `src/`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "obsidian-vault-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.23.0",
    "obsidian": "^1.5.7",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write `esbuild.config.mjs`**

```js
import esbuild from "esbuild";

const production = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
}).catch(() => process.exit(1));
```

- [ ] **Step 4: Write `manifest.json`**

```json
{
  "id": "obsidian-vault-agent",
  "name": "Vault Agent",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "AI agent with tool-use over your vault, backed by a remote multimodal model.",
  "author": "Luca",
  "isDesktopOnly": false
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 6: Write `src/main.ts`**

```ts
import { Plugin } from "obsidian";

export default class VaultAgentPlugin extends Plugin {
  async onload() {
    console.log("Vault Agent plugin loaded");
  }

  onunload() {
    console.log("Vault Agent plugin unloaded");
  }
}
```

- [ ] **Step 7: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("project scaffold", () => {
  it("placeholder test runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install deps and run tests**

Run: `npm install && npm test`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs manifest.json vitest.config.ts src/main.ts tests/main.test.ts
git commit -m "chore: scaffold Obsidian plugin project"
```

---

## Note on scope drift

The design doc gained a new section after this plan was started (`@path` mention in chat, lines 42-46: typing `@` opens a fuzzy-match dropdown over vault paths, subsequence match, no embeddings; selecting a file/folder injects its content as if `read_note`/`list_folder` had run). This plan includes it as Task 13 below — it depends on the same lazy path index built for `search_notes` (Task 11), so it's sequenced after that.

## Task 2: `VaultFS` interface and in-memory test fake

**Files:**
- Create: `src/tools/vault-fs.ts`
- Create: `tests/fixtures/fake-vault-fs.ts`
- Test: `tests/fixtures/fake-vault-fs.test.ts`

**Interfaces:**
- Produces: `VaultFS` interface, `FakeVaultFS` test fixture implementing it. All later tool tasks consume `VaultFS` — never `app.vault` directly.

- [ ] **Step 1: Write `src/tools/vault-fs.ts`**

```ts
export interface VaultFS {
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  modify(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(folderPath: string): Promise<{ files: string[]; folders: string[] }>;
  delete(path: string): Promise<void>;
}
```

- [ ] **Step 2: Write `tests/fixtures/fake-vault-fs.ts`**

```ts
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
```

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "./fake-vault-fs";

describe("FakeVaultFS", () => {
  it("creates and reads a file", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "hello");
    expect(await fs.read("notes/a.md")).toBe("hello");
  });

  it("lists files and subfolders directly under a folder", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "1");
    await fs.create("notes/sub/b.md", "2");
    const listing = await fs.list("notes");
    expect(listing.files).toEqual(["notes/a.md"]);
    expect(listing.folders).toEqual(["sub"]);
  });
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/fixtures/fake-vault-fs.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/vault-fs.ts tests/fixtures/fake-vault-fs.ts tests/fixtures/fake-vault-fs.test.ts
git commit -m "feat: add VaultFS interface and in-memory test fake"
```

---

## Task 3: Path guard (ADR 0006)

**Files:**
- Create: `src/tools/path-guard.ts`
- Test: `tests/tools/path-guard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertSafePath(path: string): void` — throws `PathEscapeError` on violation. Every tool in later tasks calls this first on every path argument.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assertSafePath, PathEscapeError } from "../../src/tools/path-guard";

describe("assertSafePath", () => {
  it("allows a normal vault-relative path", () => {
    expect(() => assertSafePath("notes/a.md")).not.toThrow();
  });

  it("rejects paths with ..", () => {
    expect(() => assertSafePath("../etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafePath("/etc/passwd")).toThrow(PathEscapeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tools/path-guard.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/path-guard'"

- [ ] **Step 3: Write `src/tools/path-guard.ts`**

```ts
export class PathEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes the vault: ${path}`);
    this.name = "PathEscapeError";
  }
}

export function assertSafePath(path: string): void {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new PathEscapeError(path);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tools/path-guard.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/path-guard.ts tests/tools/path-guard.test.ts
git commit -m "feat: add vault path confinement guard (ADR 0006)"
```

---

## Task 4: Provider types and message model

**Files:**
- Create: `src/provider/types.ts`
- Test: `tests/provider/types.test.ts`

**Interfaces:**
- Produces: `ChatMessage`, `ToolSchema`, `ToolCall`, `ChatResponse`, `ModelProvider` interface. Tasks 5 and 6 implement `ModelProvider`; Task 17 (agent loop) consumes it.

- [ ] **Step 1: Write `src/provider/types.ts`**

```ts
export interface ImageContentBlock {
  type: "image";
  base64: string;
  mimeType: string;
}

export interface TextContentBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  message: ChatMessage;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ModelProvider {
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ChatMessage } from "../../src/provider/types";

describe("ChatMessage", () => {
  it("supports a plain text user message", () => {
    const msg: ChatMessage = { role: "user", content: [{ type: "text", text: "hi" }] };
    expect(msg.content[0]).toEqual({ type: "text", text: "hi" });
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- tests/provider/types.test.ts`
Expected: PASS (1 test) — this task is type-only, the test just guards against accidental breaking changes to the shape.

- [ ] **Step 4: Commit**

```bash
git add src/provider/types.ts tests/provider/types.test.ts
git commit -m "feat: add provider message/tool type model"
```

---

## Task 5: `OpenAICompatProvider`

**Files:**
- Create: `src/provider/openai-compat-provider.ts`
- Test: `tests/provider/openai-compat-provider.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ToolSchema`, `ChatResponse`, `ModelProvider` from Task 4.
- Produces: `OpenAICompatProvider` class, constructed as `new OpenAICompatProvider(baseUrl: string)`, implementing `ModelProvider`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatProvider } from "../../src/provider/openai-compat-provider";

describe("OpenAICompatProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends messages and tools, parses a text response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "hello back" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      []
    );

    expect(result.message.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage.totalTokens).toBe(15);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.tailnet:11434/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("parses a tool-call response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", function: { name: "search_notes", arguments: '{"query":"foo"}' } }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "search for foo" }] }],
      [{ name: "search_notes", description: "search", parameters: {} }]
    );

    expect(result.message.toolCalls).toEqual([
      { id: "call_1", name: "search_notes", arguments: { query: "foo" } },
    ]);
  });

  it("throws on non-ok response without crashing the process", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    await expect(
      provider.chat([{ role: "user", content: [{ type: "text", text: "hi" }] }], [])
    ).rejects.toThrow(/502/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/provider/openai-compat-provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/provider/openai-compat-provider'"

- [ ] **Step 3: Write `src/provider/openai-compat-provider.ts`**

```ts
import { ChatMessage, ChatResponse, ModelProvider, ToolSchema, ContentBlock } from "./types";

function toOpenAiContent(content: ContentBlock[]): string | Array<Record<string, unknown>> {
  if (content.length === 1 && content[0].type === "text") return content[0].text;
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.base64}` } }
  );
}

export class OpenAICompatProvider implements ModelProvider {
  constructor(private baseUrl: string) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      messages: messages.map((m) => ({
        role: m.role,
        content: toOpenAiContent(m.content),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI-compatible provider returned ${res.status}`);
    }

    const data = await res.json();
    const choice = data.choices[0].message;
    const content: ContentBlock[] = choice.content ? [{ type: "text", text: choice.content }] : [];
    const toolCalls = (choice.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      message: { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) },
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/provider/openai-compat-provider.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/provider/openai-compat-provider.ts tests/provider/openai-compat-provider.test.ts
git commit -m "feat: add OpenAI-compatible provider"
```

---

## Task 6: `OllamaNativeProvider`

**Files:**
- Create: `src/provider/ollama-native-provider.ts`
- Test: `tests/provider/ollama-native-provider.test.ts`

**Interfaces:**
- Consumes: same types as Task 5.
- Produces: `OllamaNativeProvider` class, `new OllamaNativeProvider(baseUrl: string)`, implementing `ModelProvider`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaNativeProvider } from "../../src/provider/ollama-native-provider";

describe("OllamaNativeProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends images as a top-level images array and parses eval_count as usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "I see a cat" },
        prompt_eval_count: 20,
        eval_count: 8,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaNativeProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", base64: "AAA", mimeType: "image/png" }] }],
      []
    );

    expect(result.usage.totalTokens).toBe(28);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.messages[0].images).toEqual(["AAA"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/provider/ollama-native-provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/provider/ollama-native-provider'"

- [ ] **Step 3: Write `src/provider/ollama-native-provider.ts`**

```ts
import { ChatMessage, ChatResponse, ModelProvider, ToolSchema, ContentBlock } from "./types";

function splitContent(content: ContentBlock[]): { text: string; images: string[] } {
  const text = content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
  const images = content.filter((b) => b.type === "image").map((b: any) => b.base64);
  return { text, images };
}

export class OllamaNativeProvider implements ModelProvider {
  constructor(private baseUrl: string) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      messages: messages.map((m) => {
        const { text, images } = splitContent(m.content);
        return { role: m.role, content: text, ...(images.length ? { images } : {}) };
      }),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: false,
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama-native provider returned ${res.status}`);
    }

    const data = await res.json();
    const content: ContentBlock[] = data.message.content ? [{ type: "text", text: data.message.content }] : [];
    const toolCalls = (data.message.tool_calls ?? []).map((tc: any) => ({
      id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
    }));

    return {
      message: { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) },
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/provider/ollama-native-provider.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/provider/ollama-native-provider.ts tests/provider/ollama-native-provider.test.ts
git commit -m "feat: add Ollama-native provider"
```

---

## Task 7: Op-list diff (parse, apply, anchor resolution) — ADR 0004

**Files:**
- Create: `src/diff/op-list.ts`
- Test: `tests/diff/op-list.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `OpListOperation` type, `AnchorNotFoundError`, `applyOpList(content: string, operations: OpListOperation[]): string`. Task 10 (`edit_note`) consumes `applyOpList` and catches `AnchorNotFoundError` to trigger the full-content fallback.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applyOpList, AnchorNotFoundError } from "../../src/diff/op-list";

describe("applyOpList", () => {
  it("replaces text at an anchor", () => {
    const result = applyOpList("Hello world", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    expect(result).toBe("Hello there");
  });

  it("inserts after an anchor", () => {
    const result = applyOpList("Line one\nLine two", [
      { type: "insert_after", anchor: "Line one", text: "Inserted line" },
    ]);
    expect(result).toBe("Line one\nInserted line\nLine two");
  });

  it("deletes an anchored block", () => {
    const result = applyOpList("Keep this\nDelete this\nKeep that", [
      { type: "delete", anchor: "Delete this" },
    ]);
    expect(result).toBe("Keep this\nKeep that");
  });

  it("applies multiple operations in order", () => {
    const result = applyOpList("A\nB\nC", [
      { type: "replace", anchor: "B", old: "B", new: "B2" },
      { type: "insert_after", anchor: "C", text: "D" },
    ]);
    expect(result).toBe("A\nB2\nC\nD");
  });

  it("throws AnchorNotFoundError when the anchor text is not in the file", () => {
    expect(() =>
      applyOpList("Hello world", [{ type: "replace", anchor: "missing", old: "missing", new: "x" }])
    ).toThrow(AnchorNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/diff/op-list.test.ts`
Expected: FAIL with "Cannot find module '../../src/diff/op-list'"

- [ ] **Step 3: Write `src/diff/op-list.ts`**

```ts
export type OpListOperation =
  | { type: "replace"; anchor: string; old: string; new: string }
  | { type: "insert_after"; anchor: string; text: string }
  | { type: "delete"; anchor: string };

export class AnchorNotFoundError extends Error {
  constructor(anchor: string) {
    super(`Anchor not found in file: ${JSON.stringify(anchor)}`);
    this.name = "AnchorNotFoundError";
  }
}

function findAnchor(content: string, anchor: string): number {
  const index = content.indexOf(anchor);
  if (index === -1) throw new AnchorNotFoundError(anchor);
  return index;
}

export function applyOpList(content: string, operations: OpListOperation[]): string {
  let result = content;
  for (const op of operations) {
    const index = findAnchor(result, op.anchor);
    if (op.type === "replace") {
      result = result.slice(0, index) + op.new + result.slice(index + op.old.length);
    } else if (op.type === "delete") {
      const lineStart = result.lastIndexOf("\n", index) + 1;
      let lineEnd = result.indexOf("\n", index);
      lineEnd = lineEnd === -1 ? result.length : lineEnd + 1;
      result = result.slice(0, lineStart) + result.slice(lineEnd);
    } else if (op.type === "insert_after") {
      let lineEnd = result.indexOf("\n", index);
      lineEnd = lineEnd === -1 ? result.length : lineEnd;
      result = result.slice(0, lineEnd) + "\n" + op.text + result.slice(lineEnd);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/diff/op-list.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/diff/op-list.ts tests/diff/op-list.test.ts
git commit -m "feat: add op-list diff parser/applier with anchor resolution (ADR 0004)"
```

---

## Task 8: Conflict detection (snapshot hash compare) — ADR 0004

**Files:**
- Create: `src/diff/conflict.ts`
- Test: `tests/diff/conflict.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `snapshotHash(content: string): string`, `ConflictError`, `assertNoConflict(currentContent: string, snapshotHashAtProposalTime: string): void`. Task 10 (`create_note`/`edit_note` apply path) consumes both.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { snapshotHash, assertNoConflict, ConflictError } from "../../src/diff/conflict";

describe("conflict detection", () => {
  it("produces the same hash for identical content", () => {
    expect(snapshotHash("hello")).toBe(snapshotHash("hello"));
  });

  it("produces a different hash for different content", () => {
    expect(snapshotHash("hello")).not.toBe(snapshotHash("hello!"));
  });

  it("does not throw when the file is unchanged since the snapshot", () => {
    const hash = snapshotHash("original content");
    expect(() => assertNoConflict("original content", hash)).not.toThrow();
  });

  it("throws ConflictError when the file changed since the snapshot", () => {
    const hash = snapshotHash("original content");
    expect(() => assertNoConflict("someone edited this", hash)).toThrow(ConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/diff/conflict.test.ts`
Expected: FAIL with "Cannot find module '../../src/diff/conflict'"

- [ ] **Step 3: Write `src/diff/conflict.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/diff/conflict.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/diff/conflict.ts tests/diff/conflict.test.ts
git commit -m "feat: add snapshot-hash conflict detection (ADR 0004)"
```

---

## Task 9: Read-only tools — `read_note`, `read_image`, `list_folder`, `get_frontmatter`

**Files:**
- Create: `src/tools/read-note.ts`
- Create: `src/tools/read-image.ts`
- Create: `src/tools/list-folder.ts`
- Create: `src/tools/frontmatter.ts`
- Test: `tests/tools/read-note.test.ts`
- Test: `tests/tools/read-image.test.ts`
- Test: `tests/tools/list-folder.test.ts`
- Test: `tests/tools/frontmatter.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2), `assertSafePath` (Task 3).
- Produces: `readNote(fs: VaultFS, path: string): Promise<string>`, `readImage(fs: VaultFS, path: string): Promise<ImageContentBlock>` (from `src/provider/types.ts`), `listFolder(fs: VaultFS, path: string): Promise<{files: string[]; folders: string[]}>`, `getFrontmatter(fs: VaultFS, path: string): Promise<Record<string, unknown>>`. Task 11 (registry) wires these as read-only tools.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tools/read-note.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { readNote } from "../../src/tools/read-note";
import { PathEscapeError } from "../../src/tools/path-guard";

describe("readNote", () => {
  it("returns file content", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "content here");
    expect(await readNote(fs, "notes/a.md")).toBe("content here");
  });

  it("rejects an unsafe path before touching the filesystem", async () => {
    const fs = new FakeVaultFS();
    await expect(readNote(fs, "../secret.md")).rejects.toThrow(PathEscapeError);
  });
});
```

```ts
// tests/tools/read-image.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { readImage } from "../../src/tools/read-image";

describe("readImage", () => {
  it("returns a base64 image content block with mimeType from extension", async () => {
    const fs = new FakeVaultFS();
    await fs.create("attachments/diagram.png", "binary-as-base64-string");
    const block = await readImage(fs, "attachments/diagram.png");
    expect(block).toEqual({ type: "image", base64: "binary-as-base64-string", mimeType: "image/png" });
  });
});
```

```ts
// tests/tools/list-folder.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listFolder } from "../../src/tools/list-folder";

describe("listFolder", () => {
  it("lists files and folders directly under a path", async () => {
    const fs = new FakeVaultFS();
    await fs.create("Projects/a.md", "1");
    await fs.create("Projects/Sub/b.md", "2");
    expect(await listFolder(fs, "Projects")).toEqual({ files: ["Projects/a.md"], folders: ["Sub"] });
  });
});
```

```ts
// tests/tools/frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { getFrontmatter } from "../../src/tools/frontmatter";

describe("getFrontmatter", () => {
  it("parses YAML frontmatter from a note", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntitle: Hello\ntags:\n  - one\n  - two\n---\nBody text");
    expect(await getFrontmatter(fs, "notes/a.md")).toEqual({ title: "Hello", tags: ["one", "two"] });
  });

  it("returns an empty object when there is no frontmatter block", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/b.md", "Just body text");
    expect(await getFrontmatter(fs, "notes/b.md")).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tools/read-note.test.ts tests/tools/read-image.test.ts tests/tools/list-folder.test.ts tests/tools/frontmatter.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/tools/read-note.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

export async function readNote(fs: VaultFS, path: string): Promise<string> {
  assertSafePath(path);
  return fs.read(path);
}
```

- [ ] **Step 4: Write `src/tools/read-image.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { ImageContentBlock } from "../provider/types";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function readImage(fs: VaultFS, path: string): Promise<ImageContentBlock> {
  assertSafePath(path);
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) throw new Error(`Unsupported image extension: .${extension}`);
  const base64 = await fs.read(path);
  return { type: "image", base64, mimeType };
}
```

- [ ] **Step 5: Write `src/tools/list-folder.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

export async function listFolder(fs: VaultFS, path: string): Promise<{ files: string[]; folders: string[] }> {
  assertSafePath(path);
  return fs.list(path);
}
```

- [ ] **Step 6: Write `src/tools/frontmatter.ts`**

```ts
import yaml from "js-yaml";
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return { frontmatter: {}, body: content };
  const parsed = yaml.load(match[1]);
  return { frontmatter: (parsed ?? {}) as Record<string, unknown>, body: content.slice(match[0].length) };
}

export function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  return `---\n${yaml.dump(frontmatter)}---\n${body}`;
}

export async function getFrontmatter(fs: VaultFS, path: string): Promise<Record<string, unknown>> {
  assertSafePath(path);
  const content = await fs.read(path);
  return splitFrontmatter(content).frontmatter;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- tests/tools/read-note.test.ts tests/tools/read-image.test.ts tests/tools/list-folder.test.ts tests/tools/frontmatter.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Commit**

```bash
git add src/tools/read-note.ts src/tools/read-image.ts src/tools/list-folder.ts src/tools/frontmatter.ts tests/tools/read-note.test.ts tests/tools/read-image.test.ts tests/tools/list-folder.test.ts tests/tools/frontmatter.test.ts
git commit -m "feat: add read-only vault tools (read_note, read_image, list_folder, get_frontmatter)"
```

---

## Task 10: Mutating tools — `create_note`, `edit_note`, `set_frontmatter`, `manage_tags`

**Files:**
- Create: `src/tools/pending-change.ts`
- Create: `src/tools/create-note.ts`
- Create: `src/tools/edit-note.ts`
- Create: `src/tools/manage-tags.ts`
- Modify: `src/tools/frontmatter.ts` (add `proposeSetFrontmatter`)
- Test: `tests/tools/create-note.test.ts`
- Test: `tests/tools/edit-note.test.ts`
- Test: `tests/tools/manage-tags.test.ts`
- Test: `tests/tools/set-frontmatter.test.ts`

**Interfaces:**
- Consumes: `VaultFS`, `assertSafePath`, `applyOpList`/`AnchorNotFoundError` (Task 7), `snapshotHash`/`assertNoConflict`/`ConflictError` (Task 8), `splitFrontmatter`/`joinFrontmatter` (Task 9).
- Produces: `PendingChange` type (`{ path: string; newContent: string; baseSnapshotHash: string; kind: "create" | "edit" }`), `proposeCreateNote(fs, path, content): Promise<PendingChange>`, `proposeEditNote(fs, path, operations: OpListOperation[] | { fullContent: string }): Promise<PendingChange>`, `applyPendingChange(fs, change: PendingChange): Promise<void>` (throws `ConflictError` on mismatch), `proposeManageTags(fs, path, add: string[], remove: string[]): Promise<PendingChange>`. Task 11 (registry) wires these; Task 18 (UI) renders `PendingChange` for approve/reject.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tools/create-note.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeCreateNote } from "../../src/tools/create-note";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("create_note", () => {
  it("proposes a pending change without writing to the filesystem", async () => {
    const fs = new FakeVaultFS();
    const change = await proposeCreateNote(fs, "Projects/new.md", "# New note");
    expect(await fs.exists("Projects/new.md")).toBe(false);
    expect(change).toEqual({ path: "Projects/new.md", newContent: "# New note", baseSnapshotHash: expect.any(String), kind: "create" });
  });

  it("applying the pending change writes the file", async () => {
    const fs = new FakeVaultFS();
    const change = await proposeCreateNote(fs, "Projects/new.md", "# New note");
    await applyPendingChange(fs, change);
    expect(await fs.read("Projects/new.md")).toBe("# New note");
  });
});
```

```ts
// tests/tools/edit-note.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeEditNote } from "../../src/tools/edit-note";
import { applyPendingChange } from "../../src/tools/pending-change";
import { ConflictError } from "../../src/diff/conflict";

describe("edit_note", () => {
  it("proposes an op-list edit and applies it", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    expect(change.newContent).toBe("Hello there");
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("Hello there");
  });

  it("falls back to full-content replacement when the anchor is not found", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", { fullContent: "Replaced entirely" });
    expect(change.newContent).toBe("Replaced entirely");
  });

  it("rejects apply when the file changed since the proposal (conflict)", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "Hello world");
    const change = await proposeEditNote(fs, "notes/a.md", [
      { type: "replace", anchor: "world", old: "world", new: "there" },
    ]);
    await fs.modify("notes/a.md", "Someone else edited this");
    await expect(applyPendingChange(fs, change)).rejects.toThrow(ConflictError);
  });
});
```

```ts
// tests/tools/set-frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeSetFrontmatter } from "../../src/tools/frontmatter";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("set_frontmatter", () => {
  it("merges new keys into existing frontmatter, preserving the body", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntitle: Old\n---\nBody text");
    const change = await proposeSetFrontmatter(fs, "notes/a.md", { title: "New", status: "done" });
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("---\ntitle: New\nstatus: done\n---\nBody text");
  });
});
```

```ts
// tests/tools/manage-tags.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { proposeManageTags } from "../../src/tools/manage-tags";
import { applyPendingChange } from "../../src/tools/pending-change";

describe("manage_tags", () => {
  it("adds and removes tags in frontmatter", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntags:\n  - keep\n  - drop\n---\nBody");
    const change = await proposeManageTags(fs, "notes/a.md", ["new"], ["drop"]);
    await applyPendingChange(fs, change);
    expect(await fs.read("notes/a.md")).toBe("---\ntags:\n  - keep\n  - new\n---\nBody");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tools/create-note.test.ts tests/tools/edit-note.test.ts tests/tools/manage-tags.test.ts tests/tools/set-frontmatter.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/tools/pending-change.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/tools/create-note.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { PendingChange, snapshotHash } from "./pending-change";

export async function proposeCreateNote(fs: VaultFS, path: string, content: string): Promise<PendingChange> {
  assertSafePath(path);
  return { path, newContent: content, baseSnapshotHash: snapshotHash(""), kind: "create" };
}
```

- [ ] **Step 5: Write `src/tools/edit-note.ts`**

```ts
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
```

- [ ] **Step 6: Write `src/tools/manage-tags.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { PendingChange, snapshotHash } from "./pending-change";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";

export async function proposeManageTags(
  fs: VaultFS,
  path: string,
  add: string[],
  remove: string[]
): Promise<PendingChange> {
  assertSafePath(path);
  const currentContent = await fs.read(path);
  const { frontmatter, body } = splitFrontmatter(currentContent);
  const existingTags: string[] = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
  const removed = existingTags.filter((tag) => !remove.includes(tag));
  const newTags = [...removed, ...add.filter((tag) => !removed.includes(tag))];
  const newContent = joinFrontmatter({ ...frontmatter, tags: newTags }, body);
  return { path, newContent, baseSnapshotHash: snapshotHash(currentContent), kind: "edit" };
}
```

- [ ] **Step 6b: Add `proposeSetFrontmatter` to `src/tools/frontmatter.ts`**

Append to the existing file:

```ts
import { PendingChange, snapshotHash } from "./pending-change";

export async function proposeSetFrontmatter(
  fs: VaultFS,
  path: string,
  updates: Record<string, unknown>
): Promise<PendingChange> {
  assertSafePath(path);
  const currentContent = await fs.read(path);
  const { frontmatter, body } = splitFrontmatter(currentContent);
  const newContent = joinFrontmatter({ ...frontmatter, ...updates }, body);
  return { path, newContent, baseSnapshotHash: snapshotHash(currentContent), kind: "edit" };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- tests/tools/create-note.test.ts tests/tools/edit-note.test.ts tests/tools/manage-tags.test.ts tests/tools/set-frontmatter.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 8: Commit**

```bash
git add src/tools/pending-change.ts src/tools/create-note.ts src/tools/edit-note.ts src/tools/manage-tags.ts src/tools/frontmatter.ts tests/tools/create-note.test.ts tests/tools/edit-note.test.ts tests/tools/manage-tags.test.ts tests/tools/set-frontmatter.test.ts
git commit -m "feat: add mutating tools with pending-change/apply flow (ADR 0004)"
```

---

## Task 11: `search_notes` — lazy, incremental full-text + backlink index

**Files:**
- Create: `src/tools/search-index.ts`
- Create: `src/tools/search-notes.ts`
- Test: `tests/tools/search-index.test.ts`
- Test: `tests/tools/search-notes.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2).
- Produces: `SearchIndex` class with `indexFile(path, content)`, `removeFile(path)`, `search(query): SearchHit[]`, `getBacklinks(path): string[]`, `setResolvedLinks(links: Record<string, Record<string, number>>)`; `buildSearchIndex(fs: VaultFS): Promise<SearchIndex>`; `searchNotes(index: SearchIndex, query: string): SearchHit[]`. Task 12 (registry) wires `search_notes`. Task 21 (main.ts) builds the index once at load and subscribes to vault events to call `indexFile`/`removeFile` incrementally, and feeds `app.metadataCache.resolvedLinks` into `setResolvedLinks`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tools/search-index.test.ts
import { describe, it, expect } from "vitest";
import { SearchIndex } from "../../src/tools/search-index";

describe("SearchIndex", () => {
  it("finds a file by a word in its content", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "the quick brown fox");
    expect(index.search("brown")).toEqual([{ path: "notes/a.md", matchCount: 1 }]);
  });

  it("ranks files with more matching words higher", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "fox fox jumps");
    index.indexFile("notes/b.md", "fox only once");
    const hits = index.search("fox");
    expect(hits[0].path).toBe("notes/a.md");
  });

  it("excludes files under .agents/ from indexing", () => {
    const index = new SearchIndex();
    index.indexFile(".agents/chats/session1.json", "fox fox fox");
    expect(index.search("fox")).toEqual([]);
  });

  it("removeFile drops a file from future searches", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "unique-term");
    index.removeFile("notes/a.md");
    expect(index.search("unique-term")).toEqual([]);
  });

  it("returns backlinks from resolved links data", () => {
    const index = new SearchIndex();
    index.setResolvedLinks({ "notes/a.md": { "notes/b.md": 1 }, "notes/c.md": { "notes/b.md": 1 } });
    expect(index.getBacklinks("notes/b.md").sort()).toEqual(["notes/a.md", "notes/c.md"]);
  });
});
```

```ts
// tests/tools/search-notes.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSearchIndex } from "../../src/tools/search-index";
import { searchNotes } from "../../src/tools/search-notes";

describe("searchNotes", () => {
  it("builds an index from the vault and searches it", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "project plan for Q3");
    await fs.create(".agents/chats/session1.json", "project project project");
    const index = await buildSearchIndex(fs);
    expect(searchNotes(index, "project")).toEqual([{ path: "notes/a.md", matchCount: 1 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tools/search-index.test.ts tests/tools/search-notes.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/tools/search-index.ts`**

```ts
import { VaultFS } from "./vault-fs";

export interface SearchHit {
  path: string;
  matchCount: number;
}

const EXCLUDED_PREFIX = ".agents/";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class SearchIndex {
  private wordToPaths = new Map<string, Map<string, number>>();
  private resolvedLinks: Record<string, Record<string, number>> = {};

  indexFile(path: string, content: string): void {
    if (path.startsWith(EXCLUDED_PREFIX)) return;
    this.removeFile(path);
    for (const word of tokenize(content)) {
      if (!this.wordToPaths.has(word)) this.wordToPaths.set(word, new Map());
      const paths = this.wordToPaths.get(word)!;
      paths.set(path, (paths.get(path) ?? 0) + 1);
    }
  }

  removeFile(path: string): void {
    for (const paths of this.wordToPaths.values()) {
      paths.delete(path);
    }
  }

  search(query: string): SearchHit[] {
    const counts = new Map<string, number>();
    for (const word of tokenize(query)) {
      const paths = this.wordToPaths.get(word);
      if (!paths) continue;
      for (const [path, count] of paths) {
        counts.set(path, (counts.get(path) ?? 0) + count);
      }
    }
    return [...counts.entries()]
      .map(([path, matchCount]) => ({ path, matchCount }))
      .sort((a, b) => b.matchCount - a.matchCount);
  }

  setResolvedLinks(links: Record<string, Record<string, number>>): void {
    this.resolvedLinks = links;
  }

  getBacklinks(path: string): string[] {
    return Object.entries(this.resolvedLinks)
      .filter(([, targets]) => path in targets)
      .map(([source]) => source);
  }
}

export async function buildSearchIndex(fs: VaultFS): Promise<SearchIndex> {
  const index = new SearchIndex();
  async function walk(folder: string): Promise<void> {
    const { files, folders } = await fs.list(folder);
    for (const file of files) {
      index.indexFile(file, await fs.read(file));
    }
    for (const sub of folders) {
      await walk(folder === "" ? sub : `${folder}/${sub}`);
    }
  }
  await walk("");
  return index;
}
```

- [ ] **Step 4: Write `src/tools/search-notes.ts`**

```ts
import { SearchIndex, SearchHit } from "./search-index";

export function searchNotes(index: SearchIndex, query: string): SearchHit[] {
  return index.search(query);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/tools/search-index.test.ts tests/tools/search-notes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-index.ts src/tools/search-notes.ts tests/tools/search-index.test.ts tests/tools/search-notes.test.ts
git commit -m "feat: add lazy incremental search index for search_notes"
```

---

## Task 12: Tool registry — dispatch, schemas, read-only vs. mutating

**Files:**
- Create: `src/tools/registry.ts`
- Test: `tests/tools/registry.test.ts`

**Interfaces:**
- Consumes: every tool function from Tasks 9-11, `ToolSchema`/`ToolCall` (Task 4), `PendingChange` (Task 10).
- Produces: `ToolRegistry` class with `schemas(): ToolSchema[]` and `dispatch(call: ToolCall): Promise<{ kind: "result"; value: unknown } | { kind: "pending"; change: PendingChange }>`. Task 19 (agent loop) is the sole consumer.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { ToolRegistry } from "../../src/tools/registry";
import { buildSearchIndex } from "../../src/tools/search-index";

describe("ToolRegistry", () => {
  it("dispatches a read-only tool and returns its result immediately", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "hello");
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const outcome = await registry.dispatch({ id: "1", name: "read_note", arguments: { path: "notes/a.md" } });
    expect(outcome).toEqual({ kind: "result", value: "hello" });
  });

  it("dispatches a mutating tool and returns a pending change instead of writing", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const outcome = await registry.dispatch({ id: "2", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } });
    expect(outcome.kind).toBe("pending");
    expect(await fs.exists("notes/new.md")).toBe(false);
  });

  it("exposes a schema for every registered tool", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const names = registry.schemas().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([
      "search_notes", "read_note", "read_image", "list_folder",
      "get_frontmatter", "set_frontmatter", "manage_tags", "create_note", "edit_note",
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tools/registry.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/registry'"

- [ ] **Step 3: Write `src/tools/registry.ts`**

```ts
import { VaultFS } from "./vault-fs";
import { ToolCall, ToolSchema } from "../provider/types";
import { PendingChange } from "./pending-change";
import { SearchIndex } from "./search-index";
import { searchNotes } from "./search-notes";
import { readNote } from "./read-note";
import { readImage } from "./read-image";
import { listFolder } from "./list-folder";
import { getFrontmatter, proposeSetFrontmatter } from "./frontmatter";
import { proposeManageTags } from "./manage-tags";
import { proposeCreateNote } from "./create-note";
import { proposeEditNote } from "./edit-note";

export type DispatchOutcome = { kind: "result"; value: unknown } | { kind: "pending"; change: PendingChange };

const READ_ONLY_TOOLS = new Set(["search_notes", "read_note", "read_image", "list_folder", "get_frontmatter"]);

export class ToolRegistry {
  constructor(private fs: VaultFS, private index: SearchIndex) {}

  schemas(): ToolSchema[] {
    return [
      { name: "search_notes", description: "Full-text and backlink search over the vault.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "read_note", description: "Read the text content of a note.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "read_image", description: "Read an image from the vault as a multimodal content block.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "list_folder", description: "List files and subfolders directly under a folder.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "get_frontmatter", description: "Read the YAML frontmatter of a note.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "set_frontmatter", description: "Propose merging keys into a note's frontmatter (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, updates: { type: "object" } }, required: ["path", "updates"] } },
      { name: "manage_tags", description: "Propose adding/removing tags on a note (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } }, required: ["path"] } },
      { name: "create_note", description: "Propose creating a new note (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "edit_note", description: "Propose editing a note via anchored operations, or full content as fallback (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, operations: { type: "array" }, fullContent: { type: "string" } }, required: ["path"] } },
    ];
  }

  async dispatch(call: ToolCall): Promise<DispatchOutcome> {
    const args = call.arguments as any;
    if (READ_ONLY_TOOLS.has(call.name)) {
      const value = await this.runReadOnly(call.name, args);
      return { kind: "result", value };
    }
    const change = await this.runMutating(call.name, args);
    return { kind: "pending", change };
  }

  private async runReadOnly(name: string, args: any): Promise<unknown> {
    switch (name) {
      case "search_notes":
        return searchNotes(this.index, args.query);
      case "read_note":
        return readNote(this.fs, args.path);
      case "read_image":
        return readImage(this.fs, args.path);
      case "list_folder":
        return listFolder(this.fs, args.path);
      case "get_frontmatter":
        return getFrontmatter(this.fs, args.path);
      default:
        throw new Error(`Unknown read-only tool: ${name}`);
    }
  }

  private async runMutating(name: string, args: any): Promise<PendingChange> {
    switch (name) {
      case "set_frontmatter":
        return proposeSetFrontmatter(this.fs, args.path, args.updates);
      case "manage_tags":
        return proposeManageTags(this.fs, args.path, args.add ?? [], args.remove ?? []);
      case "create_note":
        return proposeCreateNote(this.fs, args.path, args.content);
      case "edit_note":
        return proposeEditNote(this.fs, args.path, args.operations ?? { fullContent: args.fullContent });
      default:
        throw new Error(`Unknown mutating tool: ${name}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tools/registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: add tool registry with read-only/mutating dispatch"
```

---

## Task 13: `@path` mention fuzzy-match (chat input)

**Files:**
- Create: `src/ui/path-mention.ts`
- Test: `tests/ui/path-mention.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2, to enumerate all paths — reuses the same walk pattern as `buildSearchIndex`, Task 11).
- Produces: `listAllPaths(fs: VaultFS): Promise<string[]>`, `fuzzyMatchPaths(paths: string[], query: string): string[]` (subsequence match, like Obsidian's quick switcher). Task 20 (UI) calls both on every keystroke after `@`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listAllPaths, fuzzyMatchPaths } from "../../src/ui/path-mention";

describe("path mention", () => {
  it("lists every file path in the vault", async () => {
    const fs = new FakeVaultFS();
    await fs.create("Projects/a.md", "1");
    await fs.create("Projects/Sub/b.md", "2");
    expect((await listAllPaths(fs)).sort()).toEqual(["Projects/Sub/b.md", "Projects/a.md"]);
  });

  it("matches paths by subsequence, case-insensitive", () => {
    const matches = fuzzyMatchPaths(["Projects/Roadmap.md", "Personal/Diary.md"], "prjrdm");
    expect(matches).toEqual(["Projects/Roadmap.md"]);
  });

  it("returns no matches when the query is not a subsequence", () => {
    expect(fuzzyMatchPaths(["Projects/Roadmap.md"], "xyz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ui/path-mention.test.ts`
Expected: FAIL with "Cannot find module '../../src/ui/path-mention'"

- [ ] **Step 3: Write `src/ui/path-mention.ts`**

```ts
import { VaultFS } from "../tools/vault-fs";

export async function listAllPaths(fs: VaultFS): Promise<string[]> {
  const paths: string[] = [];
  async function walk(folder: string): Promise<void> {
    const { files, folders } = await fs.list(folder);
    paths.push(...files);
    for (const sub of folders) {
      await walk(folder === "" ? sub : `${folder}/${sub}`);
    }
  }
  await walk("");
  return paths;
}

function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function fuzzyMatchPaths(paths: string[], query: string): string[] {
  const lowerQuery = query.toLowerCase();
  return paths.filter((path) => isSubsequence(lowerQuery, path.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ui/path-mention.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/path-mention.ts tests/ui/path-mention.test.ts
git commit -m "feat: add @-mention fuzzy path matching"
```

---

## Task 14: Storage — connection settings (localStorage) and agent config (`.agents/config.json`)

**Files:**
- Create: `src/storage/connection-settings.ts`
- Create: `src/storage/agent-config.ts`
- Test: `tests/storage/connection-settings.test.ts`
- Test: `tests/storage/agent-config.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2, for agent config only).
- Produces: `ConnectionSettings` type (`{ providerType: "openai-compat" | "ollama-native"; baseUrl: string }`), `loadConnectionSettings(storage: Storage): ConnectionSettings | null`, `saveConnectionSettings(storage: Storage, settings: ConnectionSettings): void`; `AgentConfig` type (`{ compactThresholdPercent: number }`), `loadAgentConfig(fs: VaultFS): Promise<AgentConfig>` (creates the file with defaults if missing). Task 21 (main.ts) wires `loadConnectionSettings(window.localStorage)`; Task 17 (context budget) consumes `AgentConfig`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/storage/connection-settings.test.ts
import { describe, it, expect } from "vitest";
import { loadConnectionSettings, saveConnectionSettings } from "../../src/storage/connection-settings";

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe("connection settings", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadConnectionSettings(new FakeStorage())).toBeNull();
  });

  it("round-trips through save and load", () => {
    const storage = new FakeStorage();
    saveConnectionSettings(storage, { providerType: "ollama-native", baseUrl: "http://mac.tailnet:11434" });
    expect(loadConnectionSettings(storage)).toEqual({ providerType: "ollama-native", baseUrl: "http://mac.tailnet:11434" });
  });
});
```

```ts
// tests/storage/agent-config.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { loadAgentConfig } from "../../src/storage/agent-config";

describe("agent config", () => {
  it("creates .agents/config.json with default 90% threshold if missing", async () => {
    const fs = new FakeVaultFS();
    const config = await loadAgentConfig(fs);
    expect(config).toEqual({ compactThresholdPercent: 90 });
    expect(await fs.exists(".agents/config.json")).toBe(true);
  });

  it("loads an existing config without overwriting it", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/config.json", JSON.stringify({ compactThresholdPercent: 75 }));
    expect(await loadAgentConfig(fs)).toEqual({ compactThresholdPercent: 75 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/storage/connection-settings.test.ts tests/storage/agent-config.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/storage/connection-settings.ts`**

```ts
const STORAGE_KEY = "vault-agent:connection-settings";

export interface ConnectionSettings {
  providerType: "openai-compat" | "ollama-native";
  baseUrl: string;
}

export function loadConnectionSettings(storage: Storage): ConnectionSettings | null {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveConnectionSettings(storage: Storage, settings: ConnectionSettings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
```

- [ ] **Step 4: Write `src/storage/agent-config.ts`**

```ts
import { VaultFS } from "../tools/vault-fs";

const CONFIG_PATH = ".agents/config.json";
const DEFAULT_CONFIG: AgentConfig = { compactThresholdPercent: 90 };

export interface AgentConfig {
  compactThresholdPercent: number;
}

export async function loadAgentConfig(fs: VaultFS): Promise<AgentConfig> {
  if (!(await fs.exists(CONFIG_PATH))) {
    await fs.create(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  return JSON.parse(await fs.read(CONFIG_PATH));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/storage/connection-settings.test.ts tests/storage/agent-config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/storage/connection-settings.ts src/storage/agent-config.ts tests/storage/connection-settings.test.ts tests/storage/agent-config.test.ts
git commit -m "feat: add connection settings (localStorage, ADR 0002) and agent config storage"
```

---

## Task 15: Storage — chat sessions (`.agents/chats/*.json`)

**Files:**
- Create: `src/storage/chat-sessions.ts`
- Test: `tests/storage/chat-sessions.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2), `ChatMessage` (Task 4).
- Produces: `ChatSession` type (`{ id: string; createdAt: string; messages: ChatMessage[] }`), `saveSession(fs, session): Promise<void>`, `listSessions(fs): Promise<{ id: string; createdAt: string; firstUserMessage: string }[]>`, `loadSession(fs, id): Promise<ChatSession>`. Task 18 (commands) and Task 19 (agent loop) consume all three.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { saveSession, listSessions, loadSession } from "../../src/storage/chat-sessions";

describe("chat sessions", () => {
  it("saves a session as JSON under .agents/chats/", async () => {
    const fs = new FakeVaultFS();
    await saveSession(fs, {
      id: "2026-06-20T10-00-00",
      createdAt: "2026-06-20T10:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    expect(await fs.exists(".agents/chats/2026-06-20T10-00-00.json")).toBe(true);
  });

  it("lists sessions with a preview of the first user message", async () => {
    const fs = new FakeVaultFS();
    await saveSession(fs, {
      id: "s1",
      createdAt: "2026-06-20T10:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "plan my week" }] }],
    });
    expect(await listSessions(fs)).toEqual([
      { id: "s1", createdAt: "2026-06-20T10:00:00.000Z", firstUserMessage: "plan my week" },
    ]);
  });

  it("loads a session back by id", async () => {
    const fs = new FakeVaultFS();
    const session = { id: "s1", createdAt: "2026-06-20T10:00:00.000Z", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }] };
    await saveSession(fs, session);
    expect(await loadSession(fs, "s1")).toEqual(session);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage/chat-sessions.test.ts`
Expected: FAIL with "Cannot find module '../../src/storage/chat-sessions'"

- [ ] **Step 3: Write `src/storage/chat-sessions.ts`**

```ts
import { VaultFS } from "../tools/vault-fs";
import { ChatMessage } from "../provider/types";

const SESSIONS_FOLDER = ".agents/chats";

export interface ChatSession {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
}

function pathFor(id: string): string {
  return `${SESSIONS_FOLDER}/${id}.json`;
}

export async function saveSession(fs: VaultFS, session: ChatSession): Promise<void> {
  const path = pathFor(session.id);
  const content = JSON.stringify(session, null, 2);
  if (await fs.exists(path)) {
    await fs.modify(path, content);
  } else {
    await fs.create(path, content);
  }
}

export async function loadSession(fs: VaultFS, id: string): Promise<ChatSession> {
  return JSON.parse(await fs.read(pathFor(id)));
}

export async function listSessions(fs: VaultFS): Promise<{ id: string; createdAt: string; firstUserMessage: string }[]> {
  const { files } = await fs.list(SESSIONS_FOLDER);
  const sessions = await Promise.all(
    files.map(async (file) => {
      const session: ChatSession = JSON.parse(await fs.read(file));
      const firstUser = session.messages.find((m) => m.role === "user");
      const firstText = firstUser?.content.find((b) => b.type === "text");
      return {
        id: session.id,
        createdAt: session.createdAt,
        firstUserMessage: firstText && firstText.type === "text" ? firstText.text : "",
      };
    })
  );
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/storage/chat-sessions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/storage/chat-sessions.ts tests/storage/chat-sessions.test.ts
git commit -m "feat: add chat session persistence under .agents/chats (ADR 0003)"
```

---

## Task 16: System prompt builder (base + `AGENTS.md` append)

**Files:**
- Create: `src/agent/system-prompt.ts`
- Test: `tests/agent/system-prompt.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2).
- Produces: `buildSystemPrompt(fs: VaultFS): Promise<string>`. Task 19 (agent loop) calls this once per turn (cheap: a single file read, or none if `AGENTS.md` is absent).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSystemPrompt, BASE_SYSTEM_PROMPT } from "../../src/agent/system-prompt";

describe("buildSystemPrompt", () => {
  it("returns just the base prompt when AGENTS.md is absent", async () => {
    const fs = new FakeVaultFS();
    expect(await buildSystemPrompt(fs)).toBe(BASE_SYSTEM_PROMPT);
  });

  it("appends AGENTS.md content when present", async () => {
    const fs = new FakeVaultFS();
    await fs.create("AGENTS.md", "This vault is organized by project. Archive/ is historical.");
    const prompt = await buildSystemPrompt(fs);
    expect(prompt).toBe(`${BASE_SYSTEM_PROMPT}\n\n${"This vault is organized by project. Archive/ is historical."}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/system-prompt.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/system-prompt'"

- [ ] **Step 3: Write `src/agent/system-prompt.ts`**

```ts
import { VaultFS } from "../tools/vault-fs";

export const BASE_SYSTEM_PROMPT = [
  "You are an agent operating inside an Obsidian vault.",
  "You can only act on the vault through the provided tools.",
  "Mutating tools (create_note, edit_note, set_frontmatter, manage_tags) never write directly: they always require explicit user approval before anything changes.",
  "Never request a path outside the vault.",
].join(" ");

export async function buildSystemPrompt(fs: VaultFS): Promise<string> {
  if (!(await fs.exists("AGENTS.md"))) return BASE_SYSTEM_PROMPT;
  const userInstructions = await fs.read("AGENTS.md");
  return `${BASE_SYSTEM_PROMPT}\n\n${userInstructions}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/system-prompt.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/system-prompt.ts tests/agent/system-prompt.test.ts
git commit -m "feat: add system prompt builder with AGENTS.md append"
```

---

## Task 17: Context budget tracking and compact (manual + automatic) — ADR 0005

**Files:**
- Create: `src/agent/context-budget.ts`
- Test: `tests/agent/context-budget.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ModelProvider` (Task 4), `AgentConfig` (Task 14).
- Produces: `ContextBudget` class with `recordUsage(totalTokens: number)`, `percentUsed(maxContextTokens: number): number`, `shouldAutoCompact(maxContextTokens: number, config: AgentConfig): boolean`; `compactMessages(provider: ModelProvider, messages: ChatMessage[], keepLastN: number): Promise<ChatMessage[]>` (summarizes everything except the last N messages into one system-authored summary message). Task 19 (agent loop) consumes both.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { ContextBudget, compactMessages } from "../../src/agent/context-budget";
import { ModelProvider, ChatMessage } from "../../src/provider/types";

describe("ContextBudget", () => {
  it("tracks percent of max context used from real provider usage", () => {
    const budget = new ContextBudget();
    budget.recordUsage(54000);
    expect(budget.percentUsed(60000)).toBe(90);
  });

  it("flags auto-compact once the configured threshold is reached", () => {
    const budget = new ContextBudget();
    budget.recordUsage(54000);
    expect(budget.shouldAutoCompact(60000, { compactThresholdPercent: 90 })).toBe(true);
    expect(budget.shouldAutoCompact(60000, { compactThresholdPercent: 95 })).toBe(false);
  });
});

describe("compactMessages", () => {
  it("summarizes older messages via the provider, keeping the last N intact", async () => {
    const fakeProvider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: [{ type: "text", text: "Summary: discussed project plan." }] },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    };
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "msg1" }] },
      { role: "assistant", content: [{ type: "text", text: "msg2" }] },
      { role: "user", content: [{ type: "text", text: "msg3" }] },
      { role: "assistant", content: [{ type: "text", text: "msg4" }] },
    ];
    const result = await compactMessages(fakeProvider, messages, 2);
    expect(result).toEqual([
      { role: "system", content: [{ type: "text", text: "Summary: discussed project plan." }] },
      { role: "user", content: [{ type: "text", text: "msg3" }] },
      { role: "assistant", content: [{ type: "text", text: "msg4" }] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/context-budget.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/context-budget'"

- [ ] **Step 3: Write `src/agent/context-budget.ts`**

```ts
import { ChatMessage, ModelProvider } from "../provider/types";
import { AgentConfig } from "../storage/agent-config";

export class ContextBudget {
  private lastTotalTokens = 0;

  recordUsage(totalTokens: number): void {
    this.lastTotalTokens = totalTokens;
  }

  percentUsed(maxContextTokens: number): number {
    return Math.round((this.lastTotalTokens / maxContextTokens) * 100);
  }

  shouldAutoCompact(maxContextTokens: number, config: AgentConfig): boolean {
    return this.percentUsed(maxContextTokens) >= config.compactThresholdPercent;
  }
}

export async function compactMessages(
  provider: ModelProvider,
  messages: ChatMessage[],
  keepLastN: number
): Promise<ChatMessage[]> {
  const toSummarize = messages.slice(0, Math.max(0, messages.length - keepLastN));
  const kept = messages.slice(Math.max(0, messages.length - keepLastN));
  if (toSummarize.length === 0) return messages;

  const summaryRequest: ChatMessage = {
    role: "user",
    content: [{
      type: "text",
      text: `Summarize the following conversation concisely, preserving facts and decisions:\n\n${JSON.stringify(toSummarize)}`,
    }],
  };
  const response = await provider.chat([summaryRequest], []);
  return [{ role: "system", content: response.message.content }, ...kept];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/context-budget.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/context-budget.ts tests/agent/context-budget.test.ts
git commit -m "feat: add context budget tracking and compact (ADR 0005)"
```

---

## Task 18: Built-in commands (`/resume`, `/clear`, `/compact`, `/help`) and skills (`.agents/skills/*.md`)

**Files:**
- Create: `src/agent/skills.ts`
- Create: `src/agent/commands.ts`
- Test: `tests/agent/skills.test.ts`
- Test: `tests/agent/commands.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2), `listSessions`/`loadSession` (Task 15).
- Produces: `listSkills(fs): Promise<{ name: string; content: string }[]>`, `resolveSkillInvocation(fs, name, args): Promise<string>` (throws if the skill file doesn't exist); `parseCommand(input: string): { command: string; args: string } | null`, `ParsedCommand` union for `/resume`, `/clear`, `/compact`, `/help`. Task 19 (agent loop) and Task 20 (UI) consume both modules.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/skills.test.ts
import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listSkills, resolveSkillInvocation } from "../../src/agent/skills";

describe("skills", () => {
  it("lists skill files from .agents/skills", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/skills/summarize.md", "Summarize the active note in 5 bullets.");
    expect(await listSkills(fs)).toEqual([{ name: "summarize", content: "Summarize the active note in 5 bullets." }]);
  });

  it("resolves a skill invocation by appending arguments", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/skills/summarize.md", "Summarize the active note in 5 bullets.");
    expect(await resolveSkillInvocation(fs, "summarize", "in Italian")).toBe(
      "Summarize the active note in 5 bullets.\n\nin Italian"
    );
  });

  it("throws when the skill does not exist", async () => {
    const fs = new FakeVaultFS();
    await expect(resolveSkillInvocation(fs, "missing", "")).rejects.toThrow();
  });
});
```

```ts
// tests/agent/commands.test.ts
import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/agent/commands";

describe("parseCommand", () => {
  it("parses /resume with an id argument", () => {
    expect(parseCommand("/resume s1")).toEqual({ command: "resume", args: "s1" });
  });

  it("parses /resume with no argument", () => {
    expect(parseCommand("/resume")).toEqual({ command: "resume", args: "" });
  });

  it("parses /clear, /compact, /help", () => {
    expect(parseCommand("/clear")).toEqual({ command: "clear", args: "" });
    expect(parseCommand("/compact")).toEqual({ command: "compact", args: "" });
    expect(parseCommand("/help")).toEqual({ command: "help", args: "" });
  });

  it("treats an unrecognized leading slash as a skill invocation", () => {
    expect(parseCommand("/summarize in Italian")).toEqual({ command: "summarize", args: "in Italian" });
  });

  it("returns null for plain text", () => {
    expect(parseCommand("hello there")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/agent/skills.test.ts tests/agent/commands.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/agent/skills.ts`**

```ts
import { VaultFS } from "../tools/vault-fs";

const SKILLS_FOLDER = ".agents/skills";

export async function listSkills(fs: VaultFS): Promise<{ name: string; content: string }[]> {
  const { files } = await fs.list(SKILLS_FOLDER);
  return Promise.all(
    files.map(async (file) => ({
      name: file.slice(SKILLS_FOLDER.length + 1, -".md".length),
      content: await fs.read(file),
    }))
  );
}

export async function resolveSkillInvocation(fs: VaultFS, name: string, args: string): Promise<string> {
  const path = `${SKILLS_FOLDER}/${name}.md`;
  if (!(await fs.exists(path))) throw new Error(`Unknown command or skill: /${name}`);
  const content = await fs.read(path);
  return args ? `${content}\n\n${args}` : content;
}
```

- [ ] **Step 4: Write `src/agent/commands.ts`**

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/agent/skills.test.ts tests/agent/commands.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agent/skills.ts src/agent/commands.ts tests/agent/skills.test.ts tests/agent/commands.test.ts
git commit -m "feat: add built-in commands and .agents/skills loader"
```

---

## Task 19: Agent loop — orchestration, pending-change suspend/resume, step events

**Files:**
- Create: `src/agent/loop.ts`
- Test: `tests/agent/loop.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`, `ChatMessage`, `ToolCall` (Task 4), `ToolRegistry`/`DispatchOutcome` (Task 12), `PendingChange`/`applyPendingChange` (Task 10), `ContextBudget`/`compactMessages` (Task 17), `AgentConfig` (Task 14).
- Produces: `AgentLoop` class with `onStep(handler: (event: StepEvent) => void)`, `send(userText: string): Promise<void>` (runs until a final assistant text message or a pending change suspends it), `approvePending(): Promise<void>`, `rejectPending(reason?: string): Promise<void>`, `getMessages(): ChatMessage[]`. `StepEvent` union: `{ type: "tool-call"; name: string } | { type: "tool-result"; name: string } | { type: "pending-change"; change: PendingChange } | { type: "final"; text: string } | { type: "error"; message: string }`. Task 20 (UI) is the sole consumer, subscribing to `onStep` for real-time tool-call visibility (confirmed: no token streaming, but step-by-step visibility is required).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../src/agent/loop";
import { ModelProvider, ChatResponse } from "../../src/provider/types";
import { ToolRegistry } from "../../src/tools/registry";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSearchIndex } from "../../src/tools/search-index";
import { ContextBudget } from "../../src/agent/context-budget";

function response(partial: Partial<ChatResponse["message"]>, usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 }): ChatResponse {
  return { message: { role: "assistant", content: [], ...partial }, usage };
}

describe("AgentLoop", () => {
  it("executes a read-only tool call automatically and returns the final text", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "secret plan");
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "read_note", arguments: { path: "notes/a.md" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "The plan is secret." }] }));
    const provider: ModelProvider = { chat };

    const events: string[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e.type));

    await loop.send("what's in notes/a.md?");

    expect(events).toEqual(["tool-call", "tool-result", "final"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("suspends on a mutating tool call until approved", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "Created it." }] }));
    const provider: ModelProvider = { chat };

    const events: string[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e.type));

    await loop.send("create a note");
    expect(events).toEqual(["tool-call", "pending-change"]);
    expect(await fs.exists("notes/new.md")).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);

    await loop.approvePending();
    expect(await fs.exists("notes/new.md")).toBe(true);
    expect(events).toEqual(["tool-call", "pending-change", "tool-result", "final"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("on reject, sends a refusal message back to the model and resumes", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "Understood, not creating it." }] }));
    const provider: ModelProvider = { chat };
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });

    await loop.send("create a note");
    await loop.rejectPending("not now");

    expect(await fs.exists("notes/new.md")).toBe(false);
    const lastCallMessages = chat.mock.calls[1][0];
    expect(lastCallMessages.at(-1).content[0].text).toMatch(/not now/);
  });

  it("emits an error event and does not crash when the provider throws", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const provider: ModelProvider = { chat: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const events: any[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e));

    await loop.send("hello");
    expect(events).toEqual([{ type: "error", message: "connection refused" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/loop.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/loop'"

- [ ] **Step 3: Write `src/agent/loop.ts`**

```ts
import { ChatMessage, ModelProvider, ToolCall } from "../provider/types";
import { ToolRegistry } from "../tools/registry";
import { PendingChange, applyPendingChange } from "../tools/pending-change";
import { ContextBudget } from "./context-budget";
import { AgentConfig } from "../storage/agent-config";

export type StepEvent =
  | { type: "tool-call"; name: string }
  | { type: "tool-result"; name: string }
  | { type: "pending-change"; change: PendingChange }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

interface SuspendedState {
  toolCallId: string;
  toolName: string;
  change: PendingChange;
}

export class AgentLoop {
  private messages: ChatMessage[] = [];
  private handlers: ((event: StepEvent) => void)[] = [];
  private suspended: SuspendedState | null = null;

  constructor(
    private provider: ModelProvider,
    private registry: ToolRegistry,
    private budget: ContextBudget,
    private config: AgentConfig
  ) {}

  onStep(handler: (event: StepEvent) => void): void {
    this.handlers.push(handler);
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  async send(userText: string): Promise<void> {
    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });
    await this.runUntilSuspendOrFinal();
  }

  async approvePending(): Promise<void> {
    if (!this.suspended) return;
    const { toolCallId, toolName, change } = this.suspended;
    this.suspended = null;
    await applyPendingChange(this.registry.fsForApply(), change);
    this.emit({ type: "tool-result", name: toolName });
    this.messages.push({
      role: "tool",
      toolCallId,
      content: [{ type: "text", text: `Applied. New content of ${change.path} written.` }],
    });
    await this.runUntilSuspendOrFinal();
  }

  async rejectPending(reason?: string): Promise<void> {
    if (!this.suspended) return;
    const { toolCallId } = this.suspended;
    this.suspended = null;
    const text = reason ? `Rejected by user. Reason: ${reason}` : "Rejected by user.";
    this.messages.push({ role: "tool", toolCallId, content: [{ type: "text", text }] });
    await this.runUntilSuspendOrFinal();
  }

  private emit(event: StepEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  private async runUntilSuspendOrFinal(): Promise<void> {
    while (true) {
      let response;
      try {
        response = await this.provider.chat(this.messages, this.registry.schemas());
      } catch (err: any) {
        this.emit({ type: "error", message: err.message });
        return;
      }

      this.budget.recordUsage(response.usage.totalTokens);
      this.messages.push(response.message);

      const toolCalls: ToolCall[] = response.message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const text = response.message.content.find((b) => b.type === "text");
        this.emit({ type: "final", text: text && text.type === "text" ? text.text : "" });
        return;
      }

      const call = toolCalls[0];
      this.emit({ type: "tool-call", name: call.name });
      const outcome = await this.registry.dispatch(call);

      if (outcome.kind === "pending") {
        this.suspended = { toolCallId: call.id, toolName: call.name, change: outcome.change };
        this.emit({ type: "pending-change", change: outcome.change });
        return;
      }

      this.emit({ type: "tool-result", name: call.name });
      this.messages.push({
        role: "tool",
        toolCallId: call.id,
        content: [{ type: "text", text: JSON.stringify(outcome.value) }],
      });
    }
  }
}
```

- [ ] **Step 4: Add `fsForApply()` to `ToolRegistry` (Task 12's file)**

`approvePending` needs the same `VaultFS` the registry already holds, to call `applyPendingChange`. Add this method to `src/tools/registry.ts`:

```ts
  fsForApply(): VaultFS {
    return this.fs;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/agent/loop.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agent/loop.ts src/tools/registry.ts tests/agent/loop.test.ts
git commit -m "feat: add agent orchestration loop with pending-change suspend/resume"
```

---

## Task 20: UI render helpers (pure logic) + side panel `ItemView`

**Files:**
- Create: `src/ui/render-helpers.ts`
- Create: `src/ui/side-panel-view.ts`
- Test: `tests/ui/render-helpers.test.ts`

**Interfaces:**
- Consumes: `StepEvent` (Task 19), `PendingChange` (Task 10), `AgentLoop` (Task 19), `listSessions`/`loadSession` (Task 15), `listSkills` (Task 18), `parseCommand`/`isBuiltInCommand` (Task 18), `listAllPaths`/`fuzzyMatchPaths` (Task 13).
- Produces: pure helpers `stepEventToLabel(event: StepEvent): string`, `formatDiffPreview(change: PendingChange, oldContent: string): string` (unified-style preview text, for display only — not parsed back); `VaultAgentSidePanelView` class extending Obsidian's `ItemView`, wiring the agent loop to the DOM.
- The `ItemView` itself is exercised by manual end-to-end testing per the design doc's Testing section (real Obsidian runtime, drag&drop, real provider) — only the pure helpers get unit tests here.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { stepEventToLabel, formatDiffPreview } from "../../src/ui/render-helpers";

describe("stepEventToLabel", () => {
  it("labels a tool-call event", () => {
    expect(stepEventToLabel({ type: "tool-call", name: "search_notes" })).toBe("🔧 calling search_notes...");
  });

  it("labels a tool-result event", () => {
    expect(stepEventToLabel({ type: "tool-result", name: "search_notes" })).toBe("✓ search_notes done");
  });

  it("labels a pending-change event", () => {
    expect(stepEventToLabel({ type: "pending-change", change: { path: "a.md", newContent: "x", baseSnapshotHash: "h", kind: "create" } })).toBe(
      "⏸ waiting for approval: create a.md"
    );
  });
});

describe("formatDiffPreview", () => {
  it("marks added lines for a create", () => {
    const preview = formatDiffPreview({ path: "a.md", newContent: "line one\nline two", baseSnapshotHash: "h", kind: "create" }, "");
    expect(preview).toBe("+line one\n+line two");
  });

  it("marks changed lines for an edit by diffing old vs new line by line", () => {
    const preview = formatDiffPreview(
      { path: "a.md", newContent: "kept\nchanged-new", baseSnapshotHash: "h", kind: "edit" },
      "kept\nchanged-old"
    );
    expect(preview).toBe(" kept\n-changed-old\n+changed-new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ui/render-helpers.test.ts`
Expected: FAIL with "Cannot find module '../../src/ui/render-helpers'"

- [ ] **Step 3: Write `src/ui/render-helpers.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ui/render-helpers.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write `src/ui/side-panel-view.ts`** (manual-test only — see Task 22)

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import { AgentLoop, StepEvent } from "../agent/loop";
import { VaultFS } from "../tools/vault-fs";
import { stepEventToLabel, formatDiffPreview } from "./render-helpers";
import { parseCommand, isBuiltInCommand } from "../agent/commands";
import { resolveSkillInvocation, listSkills } from "../agent/skills";
import { listSessions, loadSession, saveSession, ChatSession } from "../storage/chat-sessions";
import { compactMessages } from "../agent/context-budget";
import { listAllPaths, fuzzyMatchPaths } from "./path-mention";

export const VIEW_TYPE_VAULT_AGENT = "vault-agent-side-panel";

export class VaultAgentSidePanelView extends ItemView {
  private logEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private currentSessionId = `${Date.now()}`;

  constructor(
    leaf: WorkspaceLeaf,
    private loop: AgentLoop,
    private fs: VaultFS
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AGENT;
  }

  getDisplayText(): string {
    return "Vault Agent";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    this.logEl = container.createDiv({ cls: "vault-agent-log" });
    this.inputEl = container.createEl("input", { type: "text", placeholder: "Ask the agent or type / for commands..." });

    this.loop.onStep((event) => this.renderStepEvent(event));

    this.inputEl.addEventListener("keydown", async (evt) => {
      if (evt.key !== "Enter") return;
      const text = this.inputEl.value;
      this.inputEl.value = "";
      await this.handleInput(text);
    });
  }

  private async handleInput(text: string): Promise<void> {
    const parsed = parseCommand(text);
    if (!parsed) {
      this.logEl.createDiv({ text: `> ${text}` });
      await this.loop.send(text);
      return;
    }

    if (isBuiltInCommand(parsed.command)) {
      await this.handleBuiltInCommand(parsed.command, parsed.args);
      return;
    }

    try {
      const resolved = await resolveSkillInvocation(this.fs, parsed.command, parsed.args);
      await this.loop.send(resolved);
    } catch (err: any) {
      this.logEl.createDiv({ text: `⚠ ${err.message}` });
    }
  }

  private async handleBuiltInCommand(command: string, args: string): Promise<void> {
    if (command === "clear") {
      const messages = this.loop.getMessages();
      if (messages.length > 0) {
        await saveSession(this.fs, { id: this.currentSessionId, createdAt: new Date().toISOString(), messages });
      }
      this.currentSessionId = `${Date.now()}`;
      this.logEl.empty();
      return;
    }
    if (command === "resume") {
      if (!args) {
        const sessions = await listSessions(this.fs);
        this.logEl.createDiv({ text: sessions.map((s) => `${s.id}: ${s.firstUserMessage}`).join("\n") });
        return;
      }
      const session: ChatSession = await loadSession(this.fs, args);
      this.currentSessionId = session.id;
      this.logEl.empty();
      this.logEl.createDiv({ text: `Resumed session ${session.id}` });
      return;
    }
    if (command === "compact") {
      const compacted = await compactMessages((this.loop as any).provider, this.loop.getMessages(), 10);
      this.logEl.createDiv({ text: "Compacted older messages into a summary." });
      void compacted;
      return;
    }
    if (command === "help") {
      const skills = await listSkills(this.fs);
      this.logEl.createDiv({ text: ["/resume [id]", "/clear", "/compact", "/help", ...skills.map((s) => `/${s.name}`)].join("\n") });
      return;
    }
  }

  private renderStepEvent(event: StepEvent): void {
    if (event.type === "pending-change") {
      const block = this.logEl.createDiv({ cls: "vault-agent-pending" });
      block.createDiv({ text: stepEventToLabel(event) });
      block.createEl("pre", { text: formatDiffPreview(event.change, "") });
      const approveBtn = block.createEl("button", { text: "Approve" });
      const rejectBtn = block.createEl("button", { text: "Reject" });
      approveBtn.addEventListener("click", () => this.loop.approvePending());
      rejectBtn.addEventListener("click", () => this.loop.rejectPending());
      return;
    }
    this.logEl.createDiv({ text: stepEventToLabel(event) });
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/render-helpers.ts src/ui/side-panel-view.ts tests/ui/render-helpers.test.ts
git commit -m "feat: add side panel view and pure render helpers"
```

---

## Task 21: `ObsidianVaultFS` adapter, settings tab, and `main.ts` wiring

**Files:**
- Create: `src/storage/obsidian-vault-fs.ts`
- Create: `src/ui/settings-tab.ts`
- Modify: `src/main.ts`
- Test: `tests/storage/obsidian-vault-fs.test.ts`

**Interfaces:**
- Consumes: `VaultFS` (Task 2), Obsidian's `Vault`/`App` types, `ConnectionSettings`/`loadConnectionSettings`/`saveConnectionSettings` (Task 14), `OpenAICompatProvider`/`OllamaNativeProvider` (Tasks 5-6), `ToolRegistry` (Task 12), `buildSearchIndex` (Task 11), `AgentLoop` (Task 19), `VaultAgentSidePanelView`/`VIEW_TYPE_VAULT_AGENT` (Task 20), `loadAgentConfig` (Task 14).
- Produces: `ObsidianVaultFS` class implementing `VaultFS` over a real Obsidian `Vault`; `VaultAgentSettingTab`; the fully wired `VaultAgentPlugin.onload()`.

- [ ] **Step 1: Write the failing test**

`ObsidianVaultFS` is thin glue over Obsidian's `Vault` API; test it against a hand-rolled fake that mimics just the methods used, to confirm the adapter calls the right Obsidian methods with the right arguments — not to re-test Obsidian itself.

```ts
import { describe, it, expect, vi } from "vitest";
import { ObsidianVaultFS } from "../../src/storage/obsidian-vault-fs";

function fakeVault() {
  const file = { path: "notes/a.md" };
  return {
    getAbstractFileByPath: vi.fn((p: string) => (p === "notes/a.md" ? file : null)),
    read: vi.fn().mockResolvedValue("content"),
    create: vi.fn().mockResolvedValue(undefined),
    modify: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getAllLoadedFiles: vi.fn().mockReturnValue([{ path: "notes/a.md" }, { path: "notes/sub/b.md" }]),
  };
}

describe("ObsidianVaultFS", () => {
  it("reads a file via getAbstractFileByPath + vault.read", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.read("notes/a.md")).toBe("content");
    expect(vault.read).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/a.md" }));
  });

  it("exists returns false when getAbstractFileByPath returns null", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.exists("missing.md")).toBe(false);
  });

  it("list filters loaded files to direct children of a folder", async () => {
    const vault = fakeVault();
    const fs = new ObsidianVaultFS(vault as any);
    expect(await fs.list("notes")).toEqual({ files: ["notes/a.md"], folders: ["sub"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage/obsidian-vault-fs.test.ts`
Expected: FAIL with "Cannot find module '../../src/storage/obsidian-vault-fs'"

- [ ] **Step 3: Write `src/storage/obsidian-vault-fs.ts`**

```ts
import { Vault, TFile } from "obsidian";
import { VaultFS } from "../tools/vault-fs";

export class ObsidianVaultFS implements VaultFS {
  constructor(private vault: Vault) {}

  async read(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.vault.read(file);
  }

  async create(path: string, content: string): Promise<void> {
    await this.vault.create(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.vault.modify(file, content);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/storage/obsidian-vault-fs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write `src/ui/settings-tab.ts`**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import { ConnectionSettings, loadConnectionSettings, saveConnectionSettings } from "../storage/connection-settings";
import type VaultAgentPlugin from "../main";

export class VaultAgentSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VaultAgentPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    const current: ConnectionSettings = loadConnectionSettings(window.localStorage) ?? {
      providerType: "openai-compat",
      baseUrl: "",
    };

    new Setting(this.containerEl)
      .setName("Provider type")
      .addDropdown((drop) =>
        drop
          .addOption("openai-compat", "OpenAI-compatible")
          .addOption("ollama-native", "Ollama-native")
          .setValue(current.providerType)
          .onChange((value) => {
            current.providerType = value as ConnectionSettings["providerType"];
            saveConnectionSettings(window.localStorage, current);
          })
      );

    new Setting(this.containerEl)
      .setName("Base URL")
      .setDesc("Tailscale/MagicDNS address of the remote model server. Stored on this device only, never in the vault.")
      .addText((text) =>
        text.setValue(current.baseUrl).onChange((value) => {
          current.baseUrl = value;
          saveConnectionSettings(window.localStorage, current);
        })
      );
  }
}
```

- [ ] **Step 6: Rewrite `src/main.ts`**

```ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import { ObsidianVaultFS } from "./storage/obsidian-vault-fs";
import { loadConnectionSettings } from "./storage/connection-settings";
import { loadAgentConfig } from "./storage/agent-config";
import { OpenAICompatProvider } from "./provider/openai-compat-provider";
import { OllamaNativeProvider } from "./provider/ollama-native-provider";
import { ModelProvider } from "./provider/types";
import { buildSearchIndex } from "./tools/search-index";
import { ToolRegistry } from "./tools/registry";
import { ContextBudget } from "./agent/context-budget";
import { AgentLoop } from "./agent/loop";
import { VaultAgentSidePanelView, VIEW_TYPE_VAULT_AGENT } from "./ui/side-panel-view";
import { VaultAgentSettingTab } from "./ui/settings-tab";

export default class VaultAgentPlugin extends Plugin {
  async onload(): Promise<void> {
    const fs = new ObsidianVaultFS(this.app.vault);
    const settings = loadConnectionSettings(window.localStorage);
    if (!settings) {
      console.warn("Vault Agent: no connection settings configured yet (open plugin settings).");
      return;
    }

    const provider: ModelProvider =
      settings.providerType === "ollama-native"
        ? new OllamaNativeProvider(settings.baseUrl)
        : new OpenAICompatProvider(settings.baseUrl);

    const index = await buildSearchIndex(fs);
    const registry = new ToolRegistry(fs, index);
    const config = await loadAgentConfig(fs);
    const loop = new AgentLoop(provider, registry, new ContextBudget(), config);

    this.registerView(VIEW_TYPE_VAULT_AGENT, (leaf: WorkspaceLeaf) => new VaultAgentSidePanelView(leaf, loop, fs));
    this.addSettingTab(new VaultAgentSettingTab(this.app, this));

    this.app.vault.on("modify", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("create", async (file) => index.indexFile(file.path, await fs.read(file.path)));
    this.app.vault.on("delete", (file) => index.removeFile(file.path));
    index.setResolvedLinks(this.app.metadataCache.resolvedLinks);
    this.app.metadataCache.on("resolve", () => index.setResolvedLinks(this.app.metadataCache.resolvedLinks));
  }

  onunload(): void {}
}
```

- [ ] **Step 7: Commit**

```bash
git add src/storage/obsidian-vault-fs.ts src/ui/settings-tab.ts src/main.ts tests/storage/obsidian-vault-fs.test.ts
git commit -m "feat: wire plugin entrypoint, settings tab, and Obsidian vault adapter"
```

---

## Task 22: Manual end-to-end verification

**Files:** none (manual checklist, per the design doc's Testing section: side panel, drag&drop, and real-provider integration are not unit-testable).

- [ ] **Step 1:** `npm run build`, copy `main.js` + `manifest.json` into a test vault's `.obsidian/plugins/obsidian-vault-agent/`, enable the plugin in Obsidian, open the side panel.
- [ ] **Step 2:** Set provider type + base URL in plugin settings; confirm `window.localStorage` (DevTools → Application) holds the value and `.obsidian/plugins/obsidian-vault-agent/data.json` does **not** (ADR 0002).
- [ ] **Step 3:** Ask the agent to read an existing note (`read_note`); confirm the tool-call/tool-result steps render in real time before the final answer.
- [ ] **Step 4:** Ask the agent to create a note; confirm a pending-change diff block renders with Approve/Reject, the file is not written until Approve, and Reject sends a refusal back to the model.
- [ ] **Step 5:** Edit the same note manually in Obsidian between proposal and approval; confirm Approve surfaces a conflict instead of overwriting (ADR 0004).
- [ ] **Step 6:** Paste an image into the chat input and ask a multimodal question about it; ask the agent to `read_image` an embedded `![[img.png]]` from a note.
- [ ] **Step 7:** Type `@` in the chat input; confirm the fuzzy path dropdown appears and updates per keystroke.
- [ ] **Step 8:** Run `/clear`, then `/resume` with no args (list) and `/resume <id>` (reload); confirm `.agents/chats/*.json` files appear and `.agents/` is hidden in the file explorer.
- [ ] **Step 9:** Author a skill at `.agents/skills/test.md`, invoke `/test some args` in chat, confirm `/help` lists it.
- [ ] **Step 10:** Drive a long conversation past the configured `compactThresholdPercent` in `.agents/config.json`; confirm an automatic compact message appears in chat (not silent).
- [ ] **Step 11:** Stop the remote model server; confirm the plugin shows a connection error in chat without crashing, and recovers once the server is back.
- [ ] **Step 12:** Repeat steps 3-4 against both provider types (OpenAI-compatible and Ollama-native) on the real Tailscale-hosted server.

---

## Self-review notes

- **Spec coverage:** every bullet in the design doc's `tools/`, `agent/`, `ui/`, "System prompt, skill e comandi", and "Gestione errori" sections maps to a task above (Tasks 9-21). The `@path` mention addition is covered in Task 13/20. Testing section is covered by unit tests embedded in each task plus Task 22's manual checklist.
- **ADR coverage:** all six ADRs (0001-0006) have a corresponding implementation task: 0001 (no task needed — it's an absence, reflected in Global Constraints and Task 21 having no auth header), 0002 (Task 14), 0003 (Task 15), 0004 (Tasks 7, 8, 10), 0005 (Task 17), 0006 (Task 3, enforced inside every tool in Tasks 9-10).
- **Type consistency check:** `VaultFS` (Task 2) is the single filesystem interface used unchanged through Tasks 9-21; `PendingChange` (Task 10) is the single shape used by Task 19's loop and Task 20's renderer; `StepEvent` (Task 19) is the single shape consumed by Task 20. No renamed duplicates found.

