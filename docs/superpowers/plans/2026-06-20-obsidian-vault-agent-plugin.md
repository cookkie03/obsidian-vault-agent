# Obsidian Vault Agent Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Obsidian plugin that runs an AI agent loop against a remote multimodal model (OpenAI-compat or Ollama-native), with human-in-the-loop mutating tools, lexical retrieval, a chat side panel, and session/skill/command support — per `docs/superpowers/specs/2026-06-18-obsidian-agent-plugin-design.md` and `docs/adr/0001`-`0006`.

**Architecture:** Four isolated modules (`provider/`, `tools/`, `agent/`, `ui/`) plus `storage/` and `diff/` support modules, wired together by `main.ts`. No agentic framework dependency — esbuild + plain TypeScript + the Obsidian API only.

**Tech Stack:** TypeScript, esbuild, Obsidian Plugin API (`obsidian` package types), Vitest for unit tests, no runtime dependencies beyond what Obsidian provides.

## Global Constraints

- No `LangChain`/Vercel AI SDK or any agentic framework dependency (design doc line 9).
- All filesystem tool access goes through `app.vault`/`app.vault.adapter` only — never Node `fs` with hand-built paths (ADR 0006).
- Every path argument from a tool call is rejected up front if it contains `..` or starts with `/` (ADR 0006).
- Connection settings (host, MagicDNS hostname, any future credentials) live in `window.localStorage` only, never in `data.json` or any vault file (ADR 0002).
- Chat sessions live in `.agents/chats/*.json` in the vault; `.agents/skills/*.md` for skills; `.agents/config.json` for non-sensitive config (ADR 0003, ADR 0005).
- No streaming chat completions in v1 — request/response only (confirmed in grilling session).
- No embeddings/vector DB/semantic search anywhere in v1, including `@path` autocomplete — lexical/fuzzy only (design doc line 11, reconfirmed for `@path`).
- Mutating tools (`create_note`, `edit_note`, `set_frontmatter`, `manage_tags`) never write directly — they produce a pending change awaiting explicit user approval (design doc line 12).
- `edit_note` diff format is a JSON op-list with text anchors (primary); on parse/apply failure, fall back to full-file-content mode (ADR 0004).
- Conflict detection at apply time uses a content hash snapshot taken when the pending change was created, compared against a fresh read at apply time (Q16 in grilling session).

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `src/main.ts`
- Create: `.gitignore`
- Test: none (scaffolding only, verified by build succeeding)

**Interfaces:**
- Produces: a `Plugin` subclass `VaultAgentPlugin` in `src/main.ts` with empty `onload()`/`onunload()`, registered as the plugin entry point referenced by `manifest.json`'s `main` field (compiled to `main.js` at repo root).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "obsidian-vault-agent",
  "version": "0.1.0",
  "description": "AI agent side panel for Obsidian, backed by a remote multimodal model.",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.21.0",
    "obsidian": "^1.5.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2020",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strict": true,
    "lib": ["DOM", "ES2020"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: "/* Obsidian Vault Agent Plugin — generated, do not edit */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 4: Create `manifest.json`**

```json
{
  "id": "vault-agent",
  "name": "Vault Agent",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "AI agent side panel backed by a remote multimodal model, with human-in-the-loop vault edits.",
  "author": "Luca",
  "isDesktopOnly": false
}
```

- [ ] **Step 5: Create `src/main.ts`**

```ts
import { Plugin } from "obsidian";

export default class VaultAgentPlugin extends Plugin {
  async onload(): Promise<void> {
    // modules registered in later tasks
  }

  onunload(): void {
    // cleanup registered in later tasks
  }
}
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
main.js
*.js.map
.agents/chats/
.agents/config.json
```

- [ ] **Step 7: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: completes with no errors, produces `main.js` at repo root.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs manifest.json src/main.ts .gitignore
git commit -m "chore: scaffold Obsidian plugin project"
```

---

### Task 2: Provider types and shared message/tool schema

**Files:**
- Create: `src/provider/types.ts`
- Test: `tests/provider/types.test.ts`

**Interfaces:**
- Produces: `ChatMessage`, `ToolSchema`, `ToolCall`, `ChatResponse`, `Usage`, `ModelProvider` interface — consumed by every later task that calls a provider or implements one.

```ts
// src/provider/types.ts content to write in Step 3
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ImageContent {
  type: "image";
  base64: string;
  mimeType: string;
}

export interface TextContent {
  type: "text";
  text: string;
}

export type MessageContent = TextContent | ImageContent;

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  message: ChatMessage;
  usage: Usage | null;
}

export interface ModelProvider {
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/provider/types.test.ts
import { describe, it, expect } from "vitest";
import type { ChatMessage, ToolCall } from "../../src/provider/types";

describe("ChatMessage shape", () => {
  it("accepts a text-only user message", () => {
    const msg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    expect(msg.content[0].type).toBe("text");
  });

  it("accepts an assistant message with tool calls", () => {
    const call: ToolCall = { id: "1", name: "read_note", arguments: { path: "a.md" } };
    const msg: ChatMessage = {
      role: "assistant",
      content: [],
      toolCalls: [call],
    };
    expect(msg.toolCalls?.[0].name).toBe("read_note");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/provider/types.test.ts`
Expected: FAIL with "Cannot find module '../../src/provider/types'"

- [ ] **Step 3: Write `src/provider/types.ts`**

Use the full content shown in the Interfaces block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/provider/types.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/provider/types.ts tests/provider/types.test.ts
git commit -m "feat: add shared provider message and tool schema types"
```

---

### Task 3: OpenAICompatProvider

**Files:**
- Create: `src/provider/openai-compat-provider.ts`
- Test: `tests/provider/openai-compat-provider.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ToolSchema`, `ChatResponse`, `ModelProvider`, `Usage` from `src/provider/types.ts` (Task 2).
- Produces: `OpenAICompatProvider` class with constructor `(baseUrl: string, fetchImpl?: typeof fetch)` and `chat(messages, tools): Promise<ChatResponse>`, implementing `ModelProvider`. Consumed by Task 4 (interface parity check) and Task 22 (agent loop wiring).

- [ ] **Step 1: Write the failing test**

```ts
// tests/provider/openai-compat-provider.test.ts
import { describe, it, expect, vi } from "vitest";
import { OpenAICompatProvider } from "../../src/provider/openai-compat-provider";
import type { ChatMessage } from "../../src/provider/types";

describe("OpenAICompatProvider", () => {
  it("posts to /v1/chat/completions and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { role: "assistant", content: "hi there" },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const provider = new OpenAICompatProvider("http://100.64.0.1:8080", fetchMock as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];

    const response = await provider.chat(messages, []);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.1:8080/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    expect(response.message.content[0]).toEqual({ type: "text", text: "hi there" });
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("encodes image content as image_url data URIs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    });
    const provider = new OpenAICompatProvider("http://100.64.0.1:8080", fetchMock as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image", base64: "AAAA", mimeType: "image/png" }],
      },
    ];

    await provider.chat(messages, []);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  it("throws a typed error when the request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = new OpenAICompatProvider("http://100.64.0.1:8080", fetchMock as unknown as typeof fetch);
    await expect(provider.chat([], [])).rejects.toThrow("ECONNREFUSED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/provider/openai-compat-provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/provider/openai-compat-provider'"

- [ ] **Step 3: Write `src/provider/openai-compat-provider.ts`**

```ts
import type {
  ChatMessage,
  ChatResponse,
  ModelProvider,
  ToolCall,
  ToolSchema,
} from "./types";

export class OpenAICompatProvider implements ModelProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      messages: messages.map((m) => this.toOpenAIMessage(m)),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };

    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Provider returned ${res.status}`);
    }

    const json = await res.json();
    const choice = json.choices[0].message;

    const toolCalls: ToolCall[] | undefined = choice.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      message: {
        role: "assistant",
        content: choice.content ? [{ type: "text", text: choice.content }] : [],
        toolCalls,
      },
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : null,
    };
  }

  private toOpenAIMessage(m: ChatMessage) {
    return {
      role: m.role,
      content: m.content.map((c) =>
        c.type === "text"
          ? { type: "text", text: c.text }
          : { type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.base64}` } }
      ),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/provider/openai-compat-provider.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/provider/openai-compat-provider.ts tests/provider/openai-compat-provider.test.ts
git commit -m "feat: add OpenAI-compatible chat provider"
```

---

### Task 4: OllamaNativeProvider

**Files:**
- Create: `src/provider/ollama-native-provider.ts`
- Test: `tests/provider/ollama-native-provider.test.ts`

**Interfaces:**
- Consumes: same types as Task 3 from `src/provider/types.ts`.
- Produces: `OllamaNativeProvider` class, same constructor/`chat` shape as `OpenAICompatProvider`, implementing `ModelProvider`. Consumed by Task 22 (agent loop wiring, selectable alongside `OpenAICompatProvider`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/provider/ollama-native-provider.test.ts
import { describe, it, expect, vi } from "vitest";
import { OllamaNativeProvider } from "../../src/provider/ollama-native-provider";
import type { ChatMessage } from "../../src/provider/types";

describe("OllamaNativeProvider", () => {
  it("posts to /api/chat and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "hi there" },
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    });

    const provider = new OllamaNativeProvider("http://100.64.0.1:11434", fetchMock as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];

    const response = await provider.chat(messages, []);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.64.0.1:11434/api/chat",
      expect.objectContaining({ method: "POST" })
    );
    expect(response.message.content[0]).toEqual({ type: "text", text: "hi there" });
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("encodes image content as a base64 images array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    const provider = new OllamaNativeProvider("http://100.64.0.1:11434", fetchMock as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image", base64: "AAAA", mimeType: "image/png" }],
      },
    ];

    await provider.chat(messages, []);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].images).toEqual(["AAAA"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/provider/ollama-native-provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/provider/ollama-native-provider'"

- [ ] **Step 3: Write `src/provider/ollama-native-provider.ts`**

```ts
import type {
  ChatMessage,
  ChatResponse,
  ModelProvider,
  ToolCall,
  ToolSchema,
} from "./types";

export class OllamaNativeProvider implements ModelProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      model: "gemma",
      stream: false,
      messages: messages.map((m) => this.toOllamaMessage(m)),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };

    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Provider returned ${res.status}`);
    }

    const json = await res.json();
    const msg = json.message;

    const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc: any) => ({
      id: tc.id ?? crypto.randomUUID(),
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      message: {
        role: "assistant",
        content: msg.content ? [{ type: "text", text: msg.content }] : [],
        toolCalls,
      },
      usage:
        json.prompt_eval_count !== undefined
          ? {
              promptTokens: json.prompt_eval_count,
              completionTokens: json.eval_count ?? 0,
              totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
            }
          : null,
    };
  }

  private toOllamaMessage(m: ChatMessage) {
    const text = m.content.filter((c) => c.type === "text").map((c) => (c as any).text).join("\n");
    const images = m.content.filter((c) => c.type === "image").map((c) => (c as any).base64);
    return {
      role: m.role,
      content: text,
      ...(images.length ? { images } : {}),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/provider/ollama-native-provider.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/provider/ollama-native-provider.ts tests/provider/ollama-native-provider.test.ts
git commit -m "feat: add Ollama-native chat provider"
```

---

### Task 5: Connection settings in localStorage

**Files:**
- Create: `src/storage/connection-settings.ts`
- Test: `tests/storage/connection-settings.test.ts`

**Interfaces:**
- Produces: `ConnectionSettings` type `{ providerType: "openai-compat" | "ollama-native"; baseUrl: string }`, `loadConnectionSettings(): ConnectionSettings | null`, `saveConnectionSettings(s: ConnectionSettings): void`. Consumed by Task 24 (settings tab UI) and Task 22 (agent loop provider selection).

- [ ] **Step 1: Write the failing test**

```ts
// tests/storage/connection-settings.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadConnectionSettings, saveConnectionSettings } from "../../src/storage/connection-settings";

describe("connection settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is saved", () => {
    expect(loadConnectionSettings()).toBeNull();
  });

  it("round-trips through localStorage, never touching the vault", () => {
    saveConnectionSettings({ providerType: "ollama-native", baseUrl: "http://my-mac.tailnet-1234.ts.net:11434" });
    expect(loadConnectionSettings()).toEqual({
      providerType: "ollama-native",
      baseUrl: "http://my-mac.tailnet-1234.ts.net:11434",
    });
  });
});
```

Note: `vitest` needs a DOM-like `localStorage`. Add `environment: "jsdom"` to a `vitest.config.ts` (created in this step if absent) and `jsdom` to devDependencies.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/connection-settings.test.ts`
Expected: FAIL with "Cannot find module '../../src/storage/connection-settings'"

- [ ] **Step 3: Add `jsdom` and `vitest.config.ts`**

Run: `npm install -D jsdom`

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom" },
});
```

- [ ] **Step 4: Write `src/storage/connection-settings.ts`**

```ts
const STORAGE_KEY = "vault-agent:connection-settings";

export interface ConnectionSettings {
  providerType: "openai-compat" | "ollama-native";
  baseUrl: string;
}

export function loadConnectionSettings(): ConnectionSettings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as ConnectionSettings;
}

export function saveConnectionSettings(settings: ConnectionSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/storage/connection-settings.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/storage/connection-settings.ts tests/storage/connection-settings.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: store connection settings in localStorage, never in the vault"
```

---

### Task 6: Agent config (`.agents/config.json`)

**Files:**
- Create: `src/storage/agent-config.ts`
- Test: `tests/storage/agent-config.test.ts`

**Interfaces:**
- Consumes: Obsidian `Vault` type (`adapter.exists`, `adapter.read`, `adapter.write`, `adapter.mkdir`) — tests use a fake adapter, not a real Obsidian vault.
- Produces: `AgentConfig` type `{ compactThresholdPercent: number }`, `loadOrCreateAgentConfig(vault: VaultLike): Promise<AgentConfig>`, default `{ compactThresholdPercent: 90 }`. Consumed by Task 19 (context budget).

- [ ] **Step 1: Write the failing test**

```ts
// tests/storage/agent-config.test.ts
import { describe, it, expect } from "vitest";
import { loadOrCreateAgentConfig, type VaultLike } from "../../src/storage/agent-config";

function fakeVault(initialFiles: Record<string, string> = {}): VaultLike {
  const files = { ...initialFiles };
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
      mkdir: async () => {},
    },
  };
}

describe("loadOrCreateAgentConfig", () => {
  it("creates .agents/config.json with default 90 when missing", async () => {
    const vault = fakeVault();
    const config = await loadOrCreateAgentConfig(vault);
    expect(config).toEqual({ compactThresholdPercent: 90 });
    expect(JSON.parse(await vault.adapter.read(".agents/config.json"))).toEqual({
      compactThresholdPercent: 90,
    });
  });

  it("reads an existing config without overwriting it", async () => {
    const vault = fakeVault({ ".agents/config.json": JSON.stringify({ compactThresholdPercent: 75 }) });
    const config = await loadOrCreateAgentConfig(vault);
    expect(config).toEqual({ compactThresholdPercent: 75 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/agent-config.test.ts`
Expected: FAIL with "Cannot find module '../../src/storage/agent-config'"

- [ ] **Step 3: Write `src/storage/agent-config.ts`**

```ts
export interface AgentConfig {
  compactThresholdPercent: number;
}

export interface VaultAdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface VaultLike {
  adapter: VaultAdapterLike;
}

const CONFIG_PATH = ".agents/config.json";
const DEFAULT_CONFIG: AgentConfig = { compactThresholdPercent: 90 };

export async function loadOrCreateAgentConfig(vault: VaultLike): Promise<AgentConfig> {
  if (await vault.adapter.exists(CONFIG_PATH)) {
    const raw = await vault.adapter.read(CONFIG_PATH);
    return JSON.parse(raw) as AgentConfig;
  }
  await vault.adapter.mkdir(".agents");
  await vault.adapter.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return DEFAULT_CONFIG;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/agent-config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/storage/agent-config.ts tests/storage/agent-config.test.ts
git commit -m "feat: load or create .agents/config.json with default compact threshold"
```

---

### Task 7: Chat sessions (`.agents/chats/*.json`)

**Files:**
- Create: `src/storage/chat-sessions.ts`
- Test: `tests/storage/chat-sessions.test.ts`

**Interfaces:**
- Consumes: `VaultLike` from Task 6 (`src/storage/agent-config.ts`), extended here with `adapter.list` for directory listing. `ChatMessage` from `src/provider/types.ts` (Task 2).
- Produces: `ChatSession` type `{ id: string; createdAt: string; messages: ChatMessage[] }`, `saveSession(vault, session): Promise<void>`, `listSessions(vault): Promise<ChatSession[]>` (sorted newest first), `loadSession(vault, id): Promise<ChatSession>`. Consumed by Task 20 (`/resume`, `/clear` commands) and Task 22 (agent loop).

- [ ] **Step 1: Write the failing test**

```ts
// tests/storage/chat-sessions.test.ts
import { describe, it, expect } from "vitest";
import { saveSession, listSessions, loadSession } from "../../src/storage/chat-sessions";
import type { VaultLike } from "../../src/storage/agent-config";

function fakeVault(): VaultLike & { adapter: { list(path: string): Promise<{ files: string[] }> } } {
  const files: Record<string, string> = {};
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
      mkdir: async () => {},
      list: async (path: string) => ({
        files: Object.keys(files).filter((f) => f.startsWith(path)),
      }),
    },
  };
}

describe("chat sessions", () => {
  it("saves a session as .agents/chats/<id>.json", async () => {
    const vault = fakeVault();
    await saveSession(vault, { id: "2026-06-20T10-00-00", createdAt: "2026-06-20T10:00:00Z", messages: [] });
    expect(await vault.adapter.exists(".agents/chats/2026-06-20T10-00-00.json")).toBe(true);
  });

  it("lists sessions newest first", async () => {
    const vault = fakeVault();
    await saveSession(vault, { id: "a", createdAt: "2026-06-19T10:00:00Z", messages: [] });
    await saveSession(vault, { id: "b", createdAt: "2026-06-20T10:00:00Z", messages: [] });
    const sessions = await listSessions(vault);
    expect(sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("loads a session by id", async () => {
    const vault = fakeVault();
    await saveSession(vault, {
      id: "a",
      createdAt: "2026-06-19T10:00:00Z",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const loaded = await loadSession(vault, "a");
    expect(loaded.messages[0].content[0]).toEqual({ type: "text", text: "hi" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/chat-sessions.test.ts`
Expected: FAIL with "Cannot find module '../../src/storage/chat-sessions'"

- [ ] **Step 3: Write `src/storage/chat-sessions.ts`**

```ts
import type { VaultLike } from "./agent-config";
import type { ChatMessage } from "../provider/types";

export interface ChatSession {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
}

interface ListableVault extends VaultLike {
  adapter: VaultLike["adapter"] & { list(path: string): Promise<{ files: string[] }> };
}

const CHATS_DIR = ".agents/chats";

export async function saveSession(vault: ListableVault, session: ChatSession): Promise<void> {
  await vault.adapter.mkdir(CHATS_DIR);
  await vault.adapter.write(`${CHATS_DIR}/${session.id}.json`, JSON.stringify(session, null, 2));
}

export async function listSessions(vault: ListableVault): Promise<ChatSession[]> {
  const { files } = await vault.adapter.list(CHATS_DIR);
  const sessions = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map(async (f) => {
      const raw = await vault.adapter.read(f);
      return JSON.parse(raw) as ChatSession;
    })
  );
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadSession(vault: ListableVault, id: string): Promise<ChatSession> {
  const raw = await vault.adapter.read(`${CHATS_DIR}/${id}.json`);
  return JSON.parse(raw) as ChatSession;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/chat-sessions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/storage/chat-sessions.ts tests/storage/chat-sessions.test.ts
git commit -m "feat: persist chat sessions as .agents/chats/*.json"
```

---

### Task 8: Path guard (ADR 0006)

**Files:**
- Create: `src/tools/path-guard.ts`
- Test: `tests/tools/path-guard.test.ts`

**Interfaces:**
- Produces: `assertVaultRelativePath(path: string): void`, throws `PathGuardError` (a plain `Error` subclass) for any path containing `..` or starting with `/`. Consumed by every tool task (9-17) before touching `app.vault`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/path-guard.test.ts
import { describe, it, expect } from "vitest";
import { assertVaultRelativePath, PathGuardError } from "../../src/tools/path-guard";

describe("assertVaultRelativePath", () => {
  it("allows a normal vault-relative path", () => {
    expect(() => assertVaultRelativePath("Projects/notes.md")).not.toThrow();
  });

  it("rejects a path with .. segments", () => {
    expect(() => assertVaultRelativePath("../../etc/passwd")).toThrow(PathGuardError);
  });

  it("rejects an absolute path", () => {
    expect(() => assertVaultRelativePath("/etc/passwd")).toThrow(PathGuardError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/path-guard.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/path-guard'"

- [ ] **Step 3: Write `src/tools/path-guard.ts`**

```ts
export class PathGuardError extends Error {
  constructor(path: string) {
    super(`Path "${path}" escapes the vault or is absolute; rejected.`);
    this.name = "PathGuardError";
  }
}

export function assertVaultRelativePath(path: string): void {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new PathGuardError(path);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/path-guard.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/path-guard.ts tests/tools/path-guard.test.ts
git commit -m "feat: reject vault-escaping paths in tool arguments (ADR 0006)"
```

---

### Task 9: Tool registry and shared tool types

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/registry.ts`
- Test: `tests/tools/registry.test.ts`

**Interfaces:**
- Consumes: `ToolSchema` from `src/provider/types.ts` (Task 2).
- Produces: `ToolResult` type `{ ok: true; data: unknown } | { ok: false; error: string }`, `Tool` interface `{ schema: ToolSchema; mutating: boolean; execute(args: Record<string, unknown>): Promise<ToolResult> }`, `ToolRegistry` class with `register(tool: Tool)`, `get(name: string): Tool | undefined`, `schemas(): ToolSchema[]`. Consumed by every tool task (10-17) and by Task 22 (agent loop dispatch).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/registry.test.ts
import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tools/registry";
import type { Tool } from "../../src/tools/types";

const fakeTool: Tool = {
  schema: { name: "fake_tool", description: "does nothing", parameters: {} },
  mutating: false,
  execute: async () => ({ ok: true, data: "done" }),
};

describe("ToolRegistry", () => {
  it("registers and retrieves a tool by name", () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(registry.get("fake_tool")).toBe(fakeTool);
  });

  it("returns undefined for an unknown tool", () => {
    const registry = new ToolRegistry();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("exposes schemas for all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(registry.schemas()).toEqual([fakeTool.schema]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/registry'"

- [ ] **Step 3: Write `src/tools/types.ts`**

```ts
import type { ToolSchema } from "../provider/types";

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface Tool {
  schema: ToolSchema;
  mutating: boolean;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

- [ ] **Step 4: Write `src/tools/registry.ts`**

```ts
import type { Tool } from "./types";
import type { ToolSchema } from "../provider/types";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.schema.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  schemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: add tool registry and shared tool types"
```

---

### Task 10: `read_note` tool

**Files:**
- Create: `src/tools/read-note.ts`
- Test: `tests/tools/read-note.test.ts`

**Interfaces:**
- Consumes: `assertVaultRelativePath` (Task 8), `Tool`/`ToolResult` (Task 9). Minimal `VaultLike` shape `{ adapter: { exists(path): Promise<boolean>; read(path): Promise<string> } }`.
- Produces: `createReadNoteTool(vault): Tool`, `mutating: false`. Consumed by Task 23 (registry wiring in `main.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/read-note.test.ts
import { describe, it, expect } from "vitest";
import { createReadNoteTool } from "../../src/tools/read-note";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
    },
  };
}

describe("read_note tool", () => {
  it("returns the raw text content of a note", async () => {
    const tool = createReadNoteTool(fakeVault({ "Projects/a.md": "# Hello" }));
    const result = await tool.execute({ path: "Projects/a.md" });
    expect(result).toEqual({ ok: true, data: "# Hello" });
  });

  it("errors when the path escapes the vault", async () => {
    const tool = createReadNoteTool(fakeVault({}));
    const result = await tool.execute({ path: "../../etc/passwd" });
    expect(result.ok).toBe(false);
  });

  it("errors when the note does not exist", async () => {
    const tool = createReadNoteTool(fakeVault({}));
    const result = await tool.execute({ path: "missing.md" });
    expect(result).toEqual({ ok: false, error: "Note not found: missing.md" });
  });

  it("is read-only", () => {
    const tool = createReadNoteTool(fakeVault({}));
    expect(tool.mutating).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/read-note.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/read-note'"

- [ ] **Step 3: Write `src/tools/read-note.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";

export interface ReadNoteVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
  };
}

export function createReadNoteTool(vault: ReadNoteVault): Tool {
  return {
    mutating: false,
    schema: {
      name: "read_note",
      description: "Read the raw text content of a note by vault-relative path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (!(await vault.adapter.exists(path))) {
        return { ok: false, error: `Note not found: ${path}` };
      }
      const content = await vault.adapter.read(path);
      return { ok: true, data: content };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/read-note.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/read-note.ts tests/tools/read-note.test.ts
git commit -m "feat: add read_note read-only tool"
```

---

### Task 11: `list_folder` tool

**Files:**
- Create: `src/tools/list-folder.ts`
- Test: `tests/tools/list-folder.test.ts`

**Interfaces:**
- Consumes: `assertVaultRelativePath` (Task 8), `Tool`/`ToolResult` (Task 9). `VaultLike` shape `{ adapter: { list(path): Promise<{ files: string[]; folders: string[] }> } }`.
- Produces: `createListFolderTool(vault): Tool`, `mutating: false`. Also reused directly by the `@path` folder-mention case in Task 25.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/list-folder.test.ts
import { describe, it, expect } from "vitest";
import { createListFolderTool } from "../../src/tools/list-folder";

function fakeVault(entries: { files: string[]; folders: string[] }) {
  return { adapter: { list: async () => entries } };
}

describe("list_folder tool", () => {
  it("returns files and folders for a path", async () => {
    const tool = createListFolderTool(fakeVault({ files: ["Projects/a.md"], folders: ["Projects/sub"] }));
    const result = await tool.execute({ path: "Projects" });
    expect(result).toEqual({ ok: true, data: { files: ["Projects/a.md"], folders: ["Projects/sub"] } });
  });

  it("errors when the path escapes the vault", async () => {
    const tool = createListFolderTool(fakeVault({ files: [], folders: [] }));
    const result = await tool.execute({ path: "../etc" });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/list-folder.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/list-folder'"

- [ ] **Step 3: Write `src/tools/list-folder.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";

export interface ListFolderVault {
  adapter: { list(path: string): Promise<{ files: string[]; folders: string[] }> };
}

export function createListFolderTool(vault: ListFolderVault): Tool {
  return {
    mutating: false,
    schema: {
      name: "list_folder",
      description: "List files and subfolders directly inside a vault-relative folder path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      const data = await vault.adapter.list(path);
      return { ok: true, data };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/list-folder.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/list-folder.ts tests/tools/list-folder.test.ts
git commit -m "feat: add list_folder read-only tool"
```

---

### Task 12: `read_image` tool

**Files:**
- Create: `src/tools/read-image.ts`
- Test: `tests/tools/read-image.test.ts`

**Interfaces:**
- Consumes: `assertVaultRelativePath` (Task 8), `Tool`/`ToolResult` (Task 9). `VaultLike` shape `{ adapter: { exists(path): Promise<boolean>; readBinary(path): Promise<ArrayBuffer> } }`.
- Produces: `createReadImageTool(vault): Tool`, `mutating: false`, returns `ToolResult` with `data: { type: "image"; base64: string; mimeType: string }` matching `ImageContent` from `src/provider/types.ts` (Task 2) so the agent loop (Task 22) can splice it directly into the next message's content array.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/read-image.test.ts
import { describe, it, expect } from "vitest";
import { createReadImageTool } from "../../src/tools/read-image";

function fakeVault(files: Record<string, ArrayBuffer>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      readBinary: async (path: string) => files[path],
    },
  };
}

describe("read_image tool", () => {
  it("returns base64-encoded image content with mime type inferred from extension", async () => {
    const buf = new TextEncoder().encode("fake-png-bytes").buffer;
    const tool = createReadImageTool(fakeVault({ "Assets/diagram.png": buf }));
    const result = await tool.execute({ path: "Assets/diagram.png" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as any).type).toBe("image");
      expect((result.data as any).mimeType).toBe("image/png");
    }
  });

  it("errors on unsupported extensions", async () => {
    const tool = createReadImageTool(fakeVault({ "Assets/doc.pdf": new ArrayBuffer(0) }));
    const result = await tool.execute({ path: "Assets/doc.pdf" });
    expect(result).toEqual({ ok: false, error: "Unsupported image type: .pdf" });
  });

  it("errors when the path escapes the vault", async () => {
    const tool = createReadImageTool(fakeVault({}));
    const result = await tool.execute({ path: "../escape.png" });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/read-image.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/read-image'"

- [ ] **Step 3: Write `src/tools/read-image.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";

export interface ReadImageVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    readBinary(path: string): Promise<ArrayBuffer>;
  };
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createReadImageTool(vault: ReadImageVault): Tool {
  return {
    mutating: false,
    schema: {
      name: "read_image",
      description: "Read an image from the vault and return it as multimodal content the model can see.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
      const mimeType = MIME_BY_EXT[ext];
      if (!mimeType) return { ok: false, error: `Unsupported image type: ${ext}` };
      if (!(await vault.adapter.exists(path))) {
        return { ok: false, error: `Image not found: ${path}` };
      }
      const buf = await vault.adapter.readBinary(path);
      return { ok: true, data: { type: "image", base64: arrayBufferToBase64(buf), mimeType } };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/read-image.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/read-image.ts tests/tools/read-image.test.ts
git commit -m "feat: add read_image multimodal read-only tool"
```

---

### Task 13: `search_notes` tool with lazy incremental lexical index

**Files:**
- Create: `src/tools/search-index.ts`
- Create: `src/tools/search-notes.ts`
- Test: `tests/tools/search-index.test.ts`
- Test: `tests/tools/search-notes.test.ts`

**Interfaces:**
- Consumes: `assertVaultRelativePath` (Task 8), `Tool`/`ToolResult` (Task 9). A minimal event-emitting `VaultLike` for the index: `{ adapter: { list(path): Promise<{ files: string[] }>; read(path): Promise<string> }; on(event: "modify" | "create" | "delete", cb: (path: string) => void): void }`.
- Produces: `LexicalIndex` class with `buildFromVault(vault): Promise<void>`, `search(query: string): string[]` (paths ranked by term-frequency match), `handleModify(path, content)`, `handleDelete(path)` — built once lazily, kept in sync via vault events. `createSearchNotesTool(index): Tool`, `mutating: false`. The `@path` fuzzy autocomplete (Task 25) does NOT reuse this — that's a separate, simpler subsequence matcher over file paths only, not this term index.

- [ ] **Step 1: Write the failing test for the index**

```ts
// tests/tools/search-index.test.ts
import { describe, it, expect } from "vitest";
import { LexicalIndex } from "../../src/tools/search-index";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      list: async () => ({ files: Object.keys(files) }),
      read: async (path: string) => files[path],
    },
    on: () => {},
  };
}

describe("LexicalIndex", () => {
  it("finds notes containing a term, case-insensitively", async () => {
    const index = new LexicalIndex();
    await index.buildFromVault(fakeVault({
      "a.md": "Tailscale setup notes",
      "b.md": "Grocery list",
    }));
    expect(index.search("tailscale")).toEqual(["a.md"]);
  });

  it("updates incrementally on modify", async () => {
    const index = new LexicalIndex();
    await index.buildFromVault(fakeVault({ "a.md": "old content" }));
    index.handleModify("a.md", "new content about nginx");
    expect(index.search("nginx")).toEqual(["a.md"]);
    expect(index.search("old")).toEqual([]);
  });

  it("removes a file from the index on delete", async () => {
    const index = new LexicalIndex();
    await index.buildFromVault(fakeVault({ "a.md": "nginx config" }));
    index.handleDelete("a.md");
    expect(index.search("nginx")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/search-index.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/search-index'"

- [ ] **Step 3: Write `src/tools/search-index.ts`**

```ts
export interface SearchableVault {
  adapter: {
    list(path: string): Promise<{ files: string[] }>;
    read(path: string): Promise<string>;
  };
  on(event: "modify" | "create" | "delete", cb: (path: string) => void): void;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class LexicalIndex {
  private postings = new Map<string, Set<string>>();

  async buildFromVault(vault: SearchableVault): Promise<void> {
    const { files } = await vault.adapter.list("");
    for (const path of files.filter((f) => f.endsWith(".md"))) {
      const content = await vault.adapter.read(path);
      this.indexFile(path, content);
    }
    vault.on("modify", async (path) => this.handleModify(path, await vault.adapter.read(path)));
    vault.on("create", async (path) => this.handleModify(path, await vault.adapter.read(path)));
    vault.on("delete", (path) => this.handleDelete(path));
  }

  handleModify(path: string, content: string): void {
    this.handleDelete(path);
    this.indexFile(path, content);
  }

  handleDelete(path: string): void {
    for (const paths of this.postings.values()) paths.delete(path);
  }

  search(query: string): string[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    let result: Set<string> | undefined;
    for (const term of terms) {
      const matches = this.postings.get(term) ?? new Set();
      result = result ? new Set([...result].filter((p) => matches.has(p))) : new Set(matches);
    }
    return Array.from(result ?? []);
  }

  private indexFile(path: string, content: string): void {
    for (const term of new Set(tokenize(content))) {
      if (!this.postings.has(term)) this.postings.set(term, new Set());
      this.postings.get(term)!.add(path);
    }
  }
}
```

- [ ] **Step 4: Run test to verify the index passes**

Run: `npx vitest run tests/tools/search-index.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the tool wrapper**

```ts
// tests/tools/search-notes.test.ts
import { describe, it, expect } from "vitest";
import { createSearchNotesTool } from "../../src/tools/search-notes";
import { LexicalIndex } from "../../src/tools/search-index";

describe("search_notes tool", () => {
  it("delegates to the index and wraps results in a ToolResult", async () => {
    const index = new LexicalIndex();
    index.handleModify("a.md", "tailscale config");
    const tool = createSearchNotesTool(index);
    const result = await tool.execute({ query: "tailscale" });
    expect(result).toEqual({ ok: true, data: ["a.md"] });
  });

  it("is read-only", () => {
    const tool = createSearchNotesTool(new LexicalIndex());
    expect(tool.mutating).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/tools/search-notes.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/search-notes'"

- [ ] **Step 7: Write `src/tools/search-notes.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import type { LexicalIndex } from "./search-index";

export function createSearchNotesTool(index: LexicalIndex): Tool {
  return {
    mutating: false,
    schema: {
      name: "search_notes",
      description: "Search vault notes by keyword (lexical match, not semantic).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const results = index.search(args.query as string);
      return { ok: true, data: results };
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/tools/search-notes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/tools/search-index.ts src/tools/search-notes.ts tests/tools/search-index.test.ts tests/tools/search-notes.test.ts
git commit -m "feat: add lazy incremental lexical search index and search_notes tool"
```

---

### Task 14: Op-list diff engine with text anchors (ADR 0004)

**Files:**
- Create: `src/diff/op-list.ts`
- Test: `tests/diff/op-list.test.ts`

**Interfaces:**
- Produces: `OpListOperation` type `{ type: "replace" | "insert_after" | "insert_before" | "delete"; anchor: string; old?: string; new?: string }`, `applyOpList(content: string, operations: OpListOperation[]): { ok: true; content: string } | { ok: false; error: string }` (fails with a specific "anchor not found" error per operation, never partially applies). Consumed by Task 17 (`edit_note` tool).

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/op-list.test.ts
import { describe, it, expect } from "vitest";
import { applyOpList } from "../../src/diff/op-list";

describe("applyOpList", () => {
  it("replaces text at an anchor", () => {
    const result = applyOpList("# Title\n\nold paragraph.\n", [
      { type: "replace", anchor: "old paragraph.", new: "new paragraph." },
    ]);
    expect(result).toEqual({ ok: true, content: "# Title\n\nnew paragraph.\n" });
  });

  it("inserts text after an anchor", () => {
    const result = applyOpList("# Title\n", [
      { type: "insert_after", anchor: "# Title\n", new: "\nIntro line.\n" },
    ]);
    expect(result).toEqual({ ok: true, content: "# Title\n\nIntro line.\n" });
  });

  it("deletes text matching an anchor", () => {
    const result = applyOpList("keep this. remove this. keep that.", [
      { type: "delete", anchor: "remove this. " },
    ]);
    expect(result).toEqual({ ok: true, content: "keep this. keep that." });
  });

  it("fails with a specific error when the anchor is not found, applying nothing", () => {
    const result = applyOpList("# Title\n", [
      { type: "replace", anchor: "does not exist", new: "x" },
    ]);
    expect(result).toEqual({ ok: false, error: 'Anchor not found: "does not exist"' });
  });

  it("applies multiple operations in order", () => {
    const result = applyOpList("one two three", [
      { type: "replace", anchor: "one", new: "1" },
      { type: "replace", anchor: "three", new: "3" },
    ]);
    expect(result).toEqual({ ok: true, content: "1 two 3" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diff/op-list.test.ts`
Expected: FAIL with "Cannot find module '../../src/diff/op-list'"

- [ ] **Step 3: Write `src/diff/op-list.ts`**

```ts
export interface OpListOperation {
  type: "replace" | "insert_after" | "insert_before" | "delete";
  anchor: string;
  new?: string;
}

export type ApplyOpListResult = { ok: true; content: string } | { ok: false; error: string };

export function applyOpList(content: string, operations: OpListOperation[]): ApplyOpListResult {
  let current = content;
  for (const op of operations) {
    const index = current.indexOf(op.anchor);
    if (index === -1) {
      return { ok: false, error: `Anchor not found: "${op.anchor}"` };
    }
    const before = current.slice(0, index);
    const after = current.slice(index + op.anchor.length);
    switch (op.type) {
      case "replace":
        current = before + (op.new ?? "") + after;
        break;
      case "insert_after":
        current = before + op.anchor + (op.new ?? "") + after;
        break;
      case "insert_before":
        current = before + (op.new ?? "") + op.anchor + after;
        break;
      case "delete":
        current = before + after;
        break;
    }
  }
  return { ok: true, content: current };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diff/op-list.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/diff/op-list.ts tests/diff/op-list.test.ts
git commit -m "feat: add anchor-based op-list diff engine (ADR 0004)"
```

---

### Task 15: Conflict detection via content hash snapshot

**Files:**
- Create: `src/diff/conflict.ts`
- Test: `tests/diff/conflict.test.ts`

**Interfaces:**
- Produces: `hashContent(content: string): string` (deterministic, non-cryptographic — e.g. a simple FNV-1a hash, no external dependency), `checkConflict(snapshotHash: string, currentContent: string): boolean` (true = conflict). Consumed by Task 16 (pending change) and Task 17 (`edit_note` apply path).

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/conflict.test.ts
import { describe, it, expect } from "vitest";
import { hashContent, checkConflict } from "../../src/diff/conflict";

describe("conflict detection", () => {
  it("produces the same hash for identical content", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
  });

  it("produces a different hash for different content", () => {
    expect(hashContent("hello world")).not.toBe(hashContent("hello world!"));
  });

  it("reports no conflict when current content matches the snapshot hash", () => {
    const snapshot = hashContent("original content");
    expect(checkConflict(snapshot, "original content")).toBe(false);
  });

  it("reports a conflict when current content has changed since the snapshot", () => {
    const snapshot = hashContent("original content");
    expect(checkConflict(snapshot, "someone edited this")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diff/conflict.test.ts`
Expected: FAIL with "Cannot find module '../../src/diff/conflict'"

- [ ] **Step 3: Write `src/diff/conflict.ts`**

```ts
// FNV-1a: fast, deterministic, no external dependency — not cryptographic,
// but collisions are irrelevant here since we only compare a hash to itself.
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function checkConflict(snapshotHash: string, currentContent: string): boolean {
  return hashContent(currentContent) !== snapshotHash;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diff/conflict.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/diff/conflict.ts tests/diff/conflict.test.ts
git commit -m "feat: add hash-based conflict detection for pending changes"
```

---

### Task 16: Pending change model

**Files:**
- Create: `src/agent/pending-change.ts`
- Test: `tests/agent/pending-change.test.ts`

**Interfaces:**
- Consumes: `hashContent` from `src/diff/conflict.ts` (Task 15).
- Produces: `PendingChange` type `{ id: string; toolName: string; path: string; snapshotHash: string; preview: string; apply(): Promise<{ ok: true } | { ok: false; error: string }> }`, `createPendingChange(opts: { toolName: string; path: string; originalContent: string; newContent: string; readCurrent(): Promise<string>; write(content: string): Promise<void> }): PendingChange`. Consumed by Task 17 (`create_note`/`edit_note`), Task 21 (agent loop suspend/resume), Task 26 (UI approve/reject buttons).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/pending-change.test.ts
import { describe, it, expect } from "vitest";
import { createPendingChange } from "../../src/agent/pending-change";

describe("createPendingChange", () => {
  it("applies cleanly when the file has not changed since the snapshot", async () => {
    let written = "";
    const change = createPendingChange({
      toolName: "edit_note",
      path: "a.md",
      originalContent: "old",
      newContent: "new",
      readCurrent: async () => "old",
      write: async (content) => {
        written = content;
      },
    });
    const result = await change.apply();
    expect(result).toEqual({ ok: true });
    expect(written).toBe("new");
  });

  it("reports a conflict and does not write when the file changed since the snapshot", async () => {
    let writeCalled = false;
    const change = createPendingChange({
      toolName: "edit_note",
      path: "a.md",
      originalContent: "old",
      newContent: "new",
      readCurrent: async () => "someone else's edit",
      write: async () => {
        writeCalled = true;
      },
    });
    const result = await change.apply();
    expect(result).toEqual({ ok: false, error: "Conflict: a.md changed since the proposal was generated." });
    expect(writeCalled).toBe(false);
  });

  it("exposes a diff-friendly preview of the proposed change", () => {
    const change = createPendingChange({
      toolName: "edit_note",
      path: "a.md",
      originalContent: "old",
      newContent: "new",
      readCurrent: async () => "old",
      write: async () => {},
    });
    expect(change.preview).toContain("old");
    expect(change.preview).toContain("new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/pending-change.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/pending-change'"

- [ ] **Step 3: Write `src/agent/pending-change.ts`**

```ts
import { hashContent, checkConflict } from "../diff/conflict";

export interface PendingChangeOptions {
  toolName: string;
  path: string;
  originalContent: string;
  newContent: string;
  readCurrent(): Promise<string>;
  write(content: string): Promise<void>;
}

export interface PendingChange {
  id: string;
  toolName: string;
  path: string;
  snapshotHash: string;
  preview: string;
  apply(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function createPendingChange(opts: PendingChangeOptions): PendingChange {
  const snapshotHash = hashContent(opts.originalContent);
  return {
    id: crypto.randomUUID(),
    toolName: opts.toolName,
    path: opts.path,
    snapshotHash,
    preview: `--- before\n${opts.originalContent}\n--- after\n${opts.newContent}`,
    async apply() {
      const current = await opts.readCurrent();
      if (checkConflict(snapshotHash, current)) {
        return { ok: false, error: `Conflict: ${opts.path} changed since the proposal was generated.` };
      }
      await opts.write(opts.newContent);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/pending-change.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/pending-change.ts tests/agent/pending-change.test.ts
git commit -m "feat: add pending change model with hash-based conflict detection"
```

---

### Task 17: `create_note` and `edit_note` mutating tools

**Files:**
- Create: `src/tools/create-note.ts`
- Create: `src/tools/edit-note.ts`
- Test: `tests/tools/create-note.test.ts`
- Test: `tests/tools/edit-note.test.ts`

**Interfaces:**
- Consumes: `assertVaultRelativePath` (Task 8), `Tool`/`ToolResult` (Task 9), `createPendingChange`/`PendingChange` (Task 16), `applyOpList`/`OpListOperation` (Task 14).
- Produces: `createCreateNoteTool(vault, onPendingChange): Tool` (`mutating: true`), `createEditNoteTool(vault, onPendingChange): Tool` (`mutating: true`, accepts either `{ path, operations: OpListOperation[] }` or fallback `{ path, content }` per ADR 0004). Both call `onPendingChange(change: PendingChange)` instead of writing directly. `ToolResult.data` on success is `{ pendingChangeId: string; preview: string }`. Consumed by Task 23 (registry wiring) and Task 21 (agent loop suspend).

- [ ] **Step 1: Write the failing test for `create_note`**

```ts
// tests/tools/create-note.test.ts
import { describe, it, expect, vi } from "vitest";
import { createCreateNoteTool } from "../../src/tools/create-note";

function fakeVault(files: Record<string, string> = {}) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
    },
  };
}

describe("create_note tool", () => {
  it("produces a pending change instead of writing immediately", async () => {
    const vault = fakeVault();
    const onPendingChange = vi.fn();
    const tool = createCreateNoteTool(vault, onPendingChange);
    const result = await tool.execute({ path: "New.md", content: "hello" });
    expect(result.ok).toBe(true);
    expect(onPendingChange).toHaveBeenCalledOnce();
    expect(await vault.adapter.exists("New.md")).toBe(false);
  });

  it("errors if the note already exists", async () => {
    const vault = fakeVault({ "Existing.md": "x" });
    const tool = createCreateNoteTool(vault, vi.fn());
    const result = await tool.execute({ path: "Existing.md", content: "hello" });
    expect(result).toEqual({ ok: false, error: "Note already exists: Existing.md" });
  });

  it("is mutating", () => {
    const tool = createCreateNoteTool(fakeVault(), vi.fn());
    expect(tool.mutating).toBe(true);
  });

  it("applying the pending change writes the file", async () => {
    const vault = fakeVault();
    let captured: any;
    const tool = createCreateNoteTool(vault, (change) => {
      captured = change;
    });
    await tool.execute({ path: "New.md", content: "hello" });
    await captured.apply();
    expect(await vault.adapter.read("New.md")).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/create-note.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/create-note'"

- [ ] **Step 3: Write `src/tools/create-note.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";
import { createPendingChange, type PendingChange } from "../agent/pending-change";

export interface CreateNoteVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    write(path: string, data: string): Promise<void>;
  };
}

export function createCreateNoteTool(
  vault: CreateNoteVault,
  onPendingChange: (change: PendingChange) => void
): Tool {
  return {
    mutating: true,
    schema: {
      name: "create_note",
      description: "Propose creating a new note. Requires user approval before writing.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      const content = args.content as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (await vault.adapter.exists(path)) {
        return { ok: false, error: `Note already exists: ${path}` };
      }
      const change = createPendingChange({
        toolName: "create_note",
        path,
        originalContent: "",
        newContent: content,
        readCurrent: async () => ((await vault.adapter.exists(path)) ? "" : ""),
        write: (c) => vault.adapter.write(path, c),
      });
      onPendingChange(change);
      return { ok: true, data: { pendingChangeId: change.id, preview: change.preview } };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/create-note.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `edit_note`**

```ts
// tests/tools/edit-note.test.ts
import { describe, it, expect, vi } from "vitest";
import { createEditNoteTool } from "../../src/tools/edit-note";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
    },
  };
}

describe("edit_note tool", () => {
  it("applies an op-list and produces a pending change with the resulting content", async () => {
    const vault = fakeVault({ "a.md": "old paragraph." });
    let captured: any;
    const tool = createEditNoteTool(vault, (change) => {
      captured = change;
    });
    const result = await tool.execute({
      path: "a.md",
      operations: [{ type: "replace", anchor: "old paragraph.", new: "new paragraph." }],
    });
    expect(result.ok).toBe(true);
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("new paragraph.");
  });

  it("falls back to full-content mode when an anchor is not found", async () => {
    const vault = fakeVault({ "a.md": "current text" });
    let captured: any;
    const tool = createEditNoteTool(vault, (change) => {
      captured = change;
    });
    const result = await tool.execute({
      path: "a.md",
      operations: [{ type: "replace", anchor: "missing anchor", new: "x" }],
    });
    expect(result).toEqual({
      ok: false,
      error: 'Anchor not found: "missing anchor". Retry with the "content" argument (full file content) instead.',
    });
    expect(captured).toBeUndefined();
  });

  it("accepts full-content fallback mode directly", async () => {
    const vault = fakeVault({ "a.md": "old" });
    let captured: any;
    const tool = createEditNoteTool(vault, (change) => {
      captured = change;
    });
    const result = await tool.execute({ path: "a.md", content: "brand new content" });
    expect(result.ok).toBe(true);
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("brand new content");
  });

  it("errors when the note does not exist", async () => {
    const vault = fakeVault({});
    const tool = createEditNoteTool(vault, vi.fn());
    const result = await tool.execute({ path: "missing.md", content: "x" });
    expect(result).toEqual({ ok: false, error: "Note not found: missing.md" });
  });

  it("is mutating", () => {
    const tool = createEditNoteTool(fakeVault({}), vi.fn());
    expect(tool.mutating).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/tools/edit-note.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/edit-note'"

- [ ] **Step 7: Write `src/tools/edit-note.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";
import { applyOpList, type OpListOperation } from "../diff/op-list";
import { createPendingChange, type PendingChange } from "../agent/pending-change";

export interface EditNoteVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
  };
}

export function createEditNoteTool(
  vault: EditNoteVault,
  onPendingChange: (change: PendingChange) => void
): Tool {
  return {
    mutating: true,
    schema: {
      name: "edit_note",
      description:
        "Propose editing an existing note via an anchor-based op-list (primary) or full replacement content (fallback). Requires user approval before writing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["replace", "insert_after", "insert_before", "delete"] },
                anchor: { type: "string" },
                new: { type: "string" },
              },
              required: ["type", "anchor"],
            },
          },
          content: { type: "string" },
        },
        required: ["path"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (!(await vault.adapter.exists(path))) {
        return { ok: false, error: `Note not found: ${path}` };
      }
      const original = await vault.adapter.read(path);

      let newContent: string;
      if (args.operations) {
        const result = applyOpList(original, args.operations as OpListOperation[]);
        if (!result.ok) {
          return { ok: false, error: `${result.error}. Retry with the "content" argument (full file content) instead.` };
        }
        newContent = result.content;
      } else {
        newContent = args.content as string;
      }

      const change = createPendingChange({
        toolName: "edit_note",
        path,
        originalContent: original,
        newContent,
        readCurrent: () => vault.adapter.read(path),
        write: (c) => vault.adapter.write(path, c),
      });
      onPendingChange(change);
      return { ok: true, data: { pendingChangeId: change.id, preview: change.preview } };
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/tools/edit-note.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-note.ts src/tools/edit-note.ts tests/tools/create-note.test.ts tests/tools/edit-note.test.ts
git commit -m "feat: add create_note and edit_note mutating tools with pending changes"
```

---

### Task 18: Frontmatter tools (`get_frontmatter`/`set_frontmatter`) and `manage_tags`

**Files:**
- Create: `src/tools/frontmatter.ts`
- Create: `src/tools/manage-tags.ts`
- Test: `tests/tools/frontmatter.test.ts`
- Test: `tests/tools/manage-tags.test.ts`

**Interfaces:**
- Consumes: same as Task 17 (`assertVaultRelativePath`, `Tool`/`ToolResult`, `createPendingChange`).
- Produces: `createGetFrontmatterTool(vault): Tool` (`mutating: false`), `createSetFrontmatterTool(vault, onPendingChange): Tool` (`mutating: true`), `createManageTagsTool(vault, onPendingChange): Tool` (`mutating: true`, accepts `{ path, add?: string[], remove?: string[] }`, operates on the `tags` frontmatter field). All parse/serialize frontmatter with a minimal hand-rolled YAML-ish key:value parser scoped to the `---\n...\n---` block — no external YAML dependency, since frontmatter in Obsidian notes is simple enough for this scope.

- [ ] **Step 1: Write the failing test for frontmatter tools**

```ts
// tests/tools/frontmatter.test.ts
import { describe, it, expect, vi } from "vitest";
import { createGetFrontmatterTool, createSetFrontmatterTool } from "../../src/tools/frontmatter";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
    },
  };
}

describe("get_frontmatter tool", () => {
  it("parses the frontmatter block of a note", async () => {
    const vault = fakeVault({ "a.md": "---\ntitle: Hello\nstatus: draft\n---\nBody text" });
    const tool = createGetFrontmatterTool(vault);
    const result = await tool.execute({ path: "a.md" });
    expect(result).toEqual({ ok: true, data: { title: "Hello", status: "draft" } });
  });

  it("returns an empty object when there is no frontmatter block", async () => {
    const vault = fakeVault({ "a.md": "Just body text" });
    const tool = createGetFrontmatterTool(vault);
    const result = await tool.execute({ path: "a.md" });
    expect(result).toEqual({ ok: true, data: {} });
  });
});

describe("set_frontmatter tool", () => {
  it("produces a pending change that merges a new field into existing frontmatter", async () => {
    const vault = fakeVault({ "a.md": "---\ntitle: Hello\n---\nBody" });
    let captured: any;
    const tool = createSetFrontmatterTool(vault, (change) => {
      captured = change;
    });
    const result = await tool.execute({ path: "a.md", fields: { status: "done" } });
    expect(result.ok).toBe(true);
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("---\ntitle: Hello\nstatus: done\n---\nBody");
  });

  it("creates a frontmatter block when none exists", async () => {
    const vault = fakeVault({ "a.md": "Body only" });
    let captured: any;
    const tool = createSetFrontmatterTool(vault, (change) => {
      captured = change;
    });
    await tool.execute({ path: "a.md", fields: { status: "done" } });
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("---\nstatus: done\n---\nBody only");
  });

  it("is mutating", () => {
    const tool = createSetFrontmatterTool(fakeVault({}), vi.fn());
    expect(tool.mutating).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/frontmatter.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/frontmatter'"

- [ ] **Step 3: Write `src/tools/frontmatter.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";
import { createPendingChange, type PendingChange } from "../agent/pending-change";

export interface FrontmatterVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
  };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { fields: {}, body: content };
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return { fields, body: match[2] };
}

function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  if (Object.keys(fields).length === 0) return body;
  const block = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${block}\n---\n${body}`;
}

export function createGetFrontmatterTool(vault: FrontmatterVault): Tool {
  return {
    mutating: false,
    schema: {
      name: "get_frontmatter",
      description: "Read the frontmatter fields of a note as a flat key-value object.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (!(await vault.adapter.exists(path))) return { ok: false, error: `Note not found: ${path}` };
      const content = await vault.adapter.read(path);
      return { ok: true, data: parseFrontmatter(content).fields };
    },
  };
}

export function createSetFrontmatterTool(
  vault: FrontmatterVault,
  onPendingChange: (change: PendingChange) => void
): Tool {
  return {
    mutating: true,
    schema: {
      name: "set_frontmatter",
      description: "Propose merging fields into a note's frontmatter. Requires user approval.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, fields: { type: "object" } },
        required: ["path", "fields"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (!(await vault.adapter.exists(path))) return { ok: false, error: `Note not found: ${path}` };
      const original = await vault.adapter.read(path);
      const { fields, body } = parseFrontmatter(original);
      const merged = { ...fields, ...(args.fields as Record<string, string>) };
      const newContent = serializeFrontmatter(merged, body);
      const change = createPendingChange({
        toolName: "set_frontmatter",
        path,
        originalContent: original,
        newContent,
        readCurrent: () => vault.adapter.read(path),
        write: (c) => vault.adapter.write(path, c),
      });
      onPendingChange(change);
      return { ok: true, data: { pendingChangeId: change.id, preview: change.preview } };
    },
  };
}

export { parseFrontmatter, serializeFrontmatter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/frontmatter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test for `manage_tags`**

```ts
// tests/tools/manage-tags.test.ts
import { describe, it, expect, vi } from "vitest";
import { createManageTagsTool } from "../../src/tools/manage-tags";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      write: async (path: string, data: string) => {
        files[path] = data;
      },
    },
  };
}

describe("manage_tags tool", () => {
  it("adds tags to the frontmatter tags field", async () => {
    const vault = fakeVault({ "a.md": "---\ntags: [foo]\n---\nBody" });
    let captured: any;
    const tool = createManageTagsTool(vault, (change) => {
      captured = change;
    });
    const result = await tool.execute({ path: "a.md", add: ["bar"] });
    expect(result.ok).toBe(true);
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("---\ntags: [foo, bar]\n---\nBody");
  });

  it("removes tags from the frontmatter tags field", async () => {
    const vault = fakeVault({ "a.md": "---\ntags: [foo, bar]\n---\nBody" });
    let captured: any;
    const tool = createManageTagsTool(vault, (change) => {
      captured = change;
    });
    await tool.execute({ path: "a.md", remove: ["foo"] });
    await captured.apply();
    expect(await vault.adapter.read("a.md")).toBe("---\ntags: [bar]\n---\nBody");
  });

  it("is mutating", () => {
    const tool = createManageTagsTool(fakeVault({}), vi.fn());
    expect(tool.mutating).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/tools/manage-tags.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/manage-tags'"

- [ ] **Step 7: Write `src/tools/manage-tags.ts`**

```ts
import type { Tool, ToolResult } from "./types";
import { assertVaultRelativePath, PathGuardError } from "./path-guard";
import { createPendingChange, type PendingChange } from "../agent/pending-change";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

export interface ManageTagsVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
  };
}

function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);
}

function serializeTagList(tags: string[]): string {
  return `[${tags.join(", ")}]`;
}

export function createManageTagsTool(
  vault: ManageTagsVault,
  onPendingChange: (change: PendingChange) => void
): Tool {
  return {
    mutating: true,
    schema: {
      name: "manage_tags",
      description: "Propose adding/removing tags in a note's frontmatter. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          add: { type: "array", items: { type: "string" } },
          remove: { type: "array", items: { type: "string" } },
        },
        required: ["path"],
      },
    },
    async execute(args): Promise<ToolResult> {
      const path = args.path as string;
      try {
        assertVaultRelativePath(path);
      } catch (e) {
        if (e instanceof PathGuardError) return { ok: false, error: e.message };
        throw e;
      }
      if (!(await vault.adapter.exists(path))) return { ok: false, error: `Note not found: ${path}` };
      const original = await vault.adapter.read(path);
      const { fields, body } = parseFrontmatter(original);
      let tags = parseTagList(fields.tags);
      const toAdd = (args.add as string[] | undefined) ?? [];
      const toRemove = (args.remove as string[] | undefined) ?? [];
      tags = tags.filter((t) => !toRemove.includes(t));
      for (const t of toAdd) if (!tags.includes(t)) tags.push(t);
      const newContent = serializeFrontmatter({ ...fields, tags: serializeTagList(tags) }, body);
      const change = createPendingChange({
        toolName: "manage_tags",
        path,
        originalContent: original,
        newContent,
        readCurrent: () => vault.adapter.read(path),
        write: (c) => vault.adapter.write(path, c),
      });
      onPendingChange(change);
      return { ok: true, data: { pendingChangeId: change.id, preview: change.preview } };
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/tools/manage-tags.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add src/tools/frontmatter.ts src/tools/manage-tags.ts tests/tools/frontmatter.test.ts tests/tools/manage-tags.test.ts
git commit -m "feat: add frontmatter and manage_tags mutating tools"
```

---

### Task 19: System prompt assembly

**Files:**
- Create: `src/agent/system-prompt.ts`
- Test: `tests/agent/system-prompt.test.ts`

**Interfaces:**
- Produces: `BASE_SYSTEM_PROMPT` constant (minimal, vault-agent-specific, non-negotiable rules: human-in-the-loop on mutating tools, tool scope, diff format), `buildSystemPrompt(agentsFileContent: string | null): string` (base + optional append, base always first and never overridden). Consumed by Task 22 (agent loop).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, BASE_SYSTEM_PROMPT } from "../../src/agent/system-prompt";

describe("buildSystemPrompt", () => {
  it("returns just the base prompt when there is no AGENTS.md", () => {
    expect(buildSystemPrompt(null)).toBe(BASE_SYSTEM_PROMPT);
  });

  it("appends AGENTS.md content after the base prompt, never replacing it", () => {
    const result = buildSystemPrompt("This vault is organized by project.");
    expect(result.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);
    expect(result).toContain("This vault is organized by project.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/system-prompt.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/system-prompt'"

- [ ] **Step 3: Write `src/agent/system-prompt.ts`**

```ts
export const BASE_SYSTEM_PROMPT = `You are an agent operating on an Obsidian vault.
Rules:
- Only act through the provided tools; never invent file contents you have not read.
- Tools that create or modify notes (create_note, edit_note, set_frontmatter, manage_tags) never write directly: they always require explicit user approval first.
- For edit_note, prefer the anchor-based "operations" argument; only use the "content" fallback if an anchor was not found.
- Never request a path outside the vault.`;

export function buildSystemPrompt(agentsFileContent: string | null): string {
  if (!agentsFileContent) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\n${agentsFileContent}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/system-prompt.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/system-prompt.ts tests/agent/system-prompt.test.ts
git commit -m "feat: assemble minimal vault-specific system prompt with AGENTS.md append"
```

---

### Task 20: Context budget tracking and compact (ADR 0005)

**Files:**
- Create: `src/agent/context-budget.ts`
- Test: `tests/agent/context-budget.test.ts`

**Interfaces:**
- Consumes: `Usage` from `src/provider/types.ts` (Task 2), `AgentConfig` from `src/storage/agent-config.ts` (Task 6).
- Produces: `ContextBudgetTracker` class with constructor `(maxContextTokens: number, compactThresholdPercent: number)`, `recordUsage(usage: Usage): void`, `shouldCompact(): boolean`, `percentUsed(): number`. Consumed by Task 22 (agent loop, to trigger auto-compact).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/context-budget.test.ts
import { describe, it, expect } from "vitest";
import { ContextBudgetTracker } from "../../src/agent/context-budget";

describe("ContextBudgetTracker", () => {
  it("reports 0% used with no recorded usage", () => {
    const tracker = new ContextBudgetTracker(60000, 90);
    expect(tracker.percentUsed()).toBe(0);
    expect(tracker.shouldCompact()).toBe(false);
  });

  it("tracks the most recent total token usage as percent of max", () => {
    const tracker = new ContextBudgetTracker(60000, 90);
    tracker.recordUsage({ promptTokens: 50000, completionTokens: 4000, totalTokens: 54000 });
    expect(tracker.percentUsed()).toBe(90);
  });

  it("flags shouldCompact once the threshold is reached", () => {
    const tracker = new ContextBudgetTracker(60000, 90);
    tracker.recordUsage({ promptTokens: 50000, completionTokens: 5000, totalTokens: 55000 });
    expect(tracker.shouldCompact()).toBe(true);
  });

  it("does not flag shouldCompact below the threshold", () => {
    const tracker = new ContextBudgetTracker(60000, 90);
    tracker.recordUsage({ promptTokens: 20000, completionTokens: 1000, totalTokens: 21000 });
    expect(tracker.shouldCompact()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/context-budget.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/context-budget'"

- [ ] **Step 3: Write `src/agent/context-budget.ts`**

```ts
import type { Usage } from "../provider/types";

export class ContextBudgetTracker {
  private lastTotalTokens = 0;

  constructor(
    private readonly maxContextTokens: number,
    private readonly compactThresholdPercent: number
  ) {}

  recordUsage(usage: Usage): void {
    this.lastTotalTokens = usage.totalTokens;
  }

  percentUsed(): number {
    return Math.round((this.lastTotalTokens / this.maxContextTokens) * 100);
  }

  shouldCompact(): boolean {
    return this.percentUsed() >= this.compactThresholdPercent;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/context-budget.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/context-budget.ts tests/agent/context-budget.test.ts
git commit -m "feat: track context budget against a configurable compact threshold (ADR 0005)"
```

---

### Task 21: Built-in commands (`/resume`, `/clear`, `/compact`, `/help`)

**Files:**
- Create: `src/agent/commands.ts`
- Test: `tests/agent/commands.test.ts`

**Interfaces:**
- Consumes: `listSessions`/`loadSession`/`saveSession`/`ChatSession` from `src/storage/chat-sessions.ts` (Task 7), `ChatMessage` from `src/provider/types.ts` (Task 2).
- Produces: `parseCommand(input: string): { name: "resume" | "clear" | "compact" | "help"; args: string } | null` (returns `null` for plain chat input, not a command), `listResumeCandidates(vault): Promise<{ id: string; label: string }[]>` (label = truncated first user message + date), `truncateToBudget(messages: ChatMessage[], maxTokens: number, estimateTokens: (m: ChatMessage) => number): ChatMessage[]` (drops oldest first, keeps newest). Consumed by Task 22 (agent loop) and Task 26 (UI command handling).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/commands.test.ts
import { describe, it, expect } from "vitest";
import { parseCommand, truncateToBudget } from "../../src/agent/commands";
import type { ChatMessage } from "../../src/provider/types";

describe("parseCommand", () => {
  it("recognizes /resume with an argument", () => {
    expect(parseCommand("/resume 3")).toEqual({ name: "resume", args: "3" });
  });

  it("recognizes /resume with no argument", () => {
    expect(parseCommand("/resume")).toEqual({ name: "resume", args: "" });
  });

  it("recognizes /clear, /compact, /help", () => {
    expect(parseCommand("/clear")?.name).toBe("clear");
    expect(parseCommand("/compact")?.name).toBe("compact");
    expect(parseCommand("/help")?.name).toBe("help");
  });

  it("returns null for plain chat input", () => {
    expect(parseCommand("what does this note say?")).toBeNull();
  });

  it("returns null for an unrecognized slash command (treated as a skill, not built-in)", () => {
    expect(parseCommand("/my-custom-skill arg1")).toBeNull();
  });
});

describe("truncateToBudget", () => {
  const estimate = (m: ChatMessage) => (m.content[0] as any).text.length;

  it("keeps all messages when they fit the budget", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    expect(truncateToBudget(messages, 100, estimate)).toEqual(messages);
  });

  it("drops oldest messages first when over budget", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "first message, oldest" }] },
      { role: "assistant", content: [{ type: "text", text: "second" }] },
      { role: "user", content: [{ type: "text", text: "third, newest" }] },
    ];
    const result = truncateToBudget(messages, 20, estimate);
    expect(result).toEqual([messages[2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/commands.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/commands'"

- [ ] **Step 3: Write `src/agent/commands.ts`**

```ts
import type { ChatMessage } from "../provider/types";
import { listSessions, type ChatSession } from "../storage/chat-sessions";
import type { VaultLike } from "../storage/agent-config";

const BUILTIN_NAMES = ["resume", "clear", "compact", "help"] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

export interface ParsedCommand {
  name: BuiltinName;
  args: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!BUILTIN_NAMES.includes(rawName as BuiltinName)) return null;
  return { name: rawName as BuiltinName, args: rest.join(" ") };
}

export function truncateToBudget(
  messages: ChatMessage[],
  maxTokens: number,
  estimateTokens: (m: ChatMessage) => number
): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i]);
    if (used + cost > maxTokens) break;
    kept.unshift(messages[i]);
    used += cost;
  }
  return kept;
}

export interface ResumeCandidate {
  id: string;
  label: string;
}

export async function listResumeCandidates(vault: VaultLike): Promise<ResumeCandidate[]> {
  const sessions = await listSessions(vault as any);
  return sessions.map((s: ChatSession) => {
    const firstUserText = s.messages.find((m) => m.role === "user");
    const text = firstUserText ? (firstUserText.content[0] as any).text : "(empty session)";
    return { id: s.id, label: `${s.createdAt.slice(0, 10)} — ${text.slice(0, 40)}` };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/commands.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/commands.ts tests/agent/commands.test.ts
git commit -m "feat: add built-in command parsing and context truncation for /resume"
```

---

### Task 22: Skills loader (`.agents/skills/*.md`)

**Files:**
- Create: `src/agent/skills.ts`
- Test: `tests/agent/skills.test.ts`

**Interfaces:**
- Consumes: `VaultLike`/`VaultAdapterLike` from `src/storage/agent-config.ts` (Task 6), extended with `adapter.list`.
- Produces: `loadSkill(vault, name): Promise<string | null>` (reads `.agents/skills/<name>.md`, `null` if missing), `listSkillNames(vault): Promise<string[]>`, `buildSkillInvocation(skillContent: string, args: string): string` (concatenates skill text + args as a single user-instruction string). Consumed by Task 26 (UI command handling, since skill invocation is intercepted in the input the same way as built-in commands but is NOT in `BUILTIN_NAMES` from Task 21).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/skills.test.ts
import { describe, it, expect } from "vitest";
import { loadSkill, listSkillNames, buildSkillInvocation } from "../../src/agent/skills";

function fakeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
      list: async (path: string) => ({ files: Object.keys(files).filter((f) => f.startsWith(path)) }),
    },
  };
}

describe("skills", () => {
  it("loads a skill file by name", async () => {
    const vault = fakeVault({ ".agents/skills/riassumi.md": "Summarize the active note in 5 bullets." });
    expect(await loadSkill(vault, "riassumi")).toBe("Summarize the active note in 5 bullets.");
  });

  it("returns null for a missing skill", async () => {
    const vault = fakeVault({});
    expect(await loadSkill(vault, "missing")).toBeNull();
  });

  it("lists available skill names without the .md extension", async () => {
    const vault = fakeVault({
      ".agents/skills/riassumi.md": "x",
      ".agents/skills/translate.md": "y",
    });
    expect(await listSkillNames(vault)).toEqual(["riassumi", "translate"]);
  });

  it("concatenates skill content and arguments into one instruction", () => {
    expect(buildSkillInvocation("Summarize this note:", "Projects/a.md")).toBe(
      "Summarize this note:\nProjects/a.md"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/skills.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/skills'"

- [ ] **Step 3: Write `src/agent/skills.ts`**

```ts
export interface SkillsVault {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    list(path: string): Promise<{ files: string[] }>;
  };
}

const SKILLS_DIR = ".agents/skills";

export async function loadSkill(vault: SkillsVault, name: string): Promise<string | null> {
  const path = `${SKILLS_DIR}/${name}.md`;
  if (!(await vault.adapter.exists(path))) return null;
  return vault.adapter.read(path);
}

export async function listSkillNames(vault: SkillsVault): Promise<string[]> {
  const { files } = await vault.adapter.list(SKILLS_DIR);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(f.lastIndexOf("/") + 1).replace(/\.md$/, ""));
}

export function buildSkillInvocation(skillContent: string, args: string): string {
  return args ? `${skillContent}\n${args}` : skillContent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/skills.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/skills.ts tests/agent/skills.test.ts
git commit -m "feat: load user-authored skills from .agents/skills/*.md"
```

---

### Task 23: Agent orchestration loop

**Files:**
- Create: `src/agent/loop.ts`
- Test: `tests/agent/loop.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`/`ChatMessage`/`ChatResponse` (Task 2), `ToolRegistry` (Task 9), `PendingChange` (Task 16), `ContextBudgetTracker` (Task 20).
- Produces: `AgentLoop` class, constructor `(provider: ModelProvider, registry: ToolRegistry, systemPrompt: string, budget: ContextBudgetTracker)`. Methods: `run(messages: ChatMessage[]): Promise<LoopStepResult>` where `LoopStepResult` is a discriminated union: `{ type: "final"; message: ChatMessage }` (model produced a plain answer, no tool call — including the "no native tool-call" fallback case), `{ type: "pending_approval"; change: PendingChange; resumeMessages: ChatMessage[] }` (suspend, waiting for the UI), `{ type: "tool_executed"; toolEvent: { name: string; result: unknown }; messages: ChatMessage[] }` (one read-only step completed — caller re-invokes `run` with the returned `messages` to continue, which is also how the UI gets real-time per-tool-call visibility, per the grilling session). Consumed by Task 27 (UI wiring) and Task 28 (`main.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../src/agent/loop";
import { ToolRegistry } from "../../src/tools/registry";
import { ContextBudgetTracker } from "../../src/agent/context-budget";
import type { ModelProvider, ChatMessage } from "../../src/provider/types";

function userMsg(text: string): ChatMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("AgentLoop", () => {
  it("returns a final message when the model responds with plain text (no tool call)", async () => {
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      }),
    };
    const loop = new AgentLoop(provider, new ToolRegistry(), "system", new ContextBudgetTracker(60000, 90));
    const result = await loop.run([userMsg("hi")]);
    expect(result).toEqual({ type: "final", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] } });
  });

  it("executes a read-only tool call and returns the intermediate step, never crashing if no tool-call is returned (fallback per grilling Q1)", async () => {
    const readOnlyTool = {
      mutating: false,
      schema: { name: "read_note", description: "x", parameters: {} },
      execute: vi.fn().mockResolvedValue({ ok: true, data: "note content" }),
    };
    const registry = new ToolRegistry();
    registry.register(readOnlyTool);
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: {
          role: "assistant",
          content: [],
          toolCalls: [{ id: "1", name: "read_note", arguments: { path: "a.md" } }],
        },
        usage: null,
      }),
    };
    const loop = new AgentLoop(provider, registry, "system", new ContextBudgetTracker(60000, 90));
    const result = await loop.run([userMsg("read a.md")]);
    expect(result.type).toBe("tool_executed");
    if (result.type === "tool_executed") {
      expect(result.toolEvent).toEqual({ name: "read_note", result: { ok: true, data: "note content" } });
      expect(readOnlyTool.execute).toHaveBeenCalledWith({ path: "a.md" });
    }
  });

  it("suspends with pending_approval when a mutating tool is called", async () => {
    const fakePendingChange = { id: "pc1", toolName: "create_note", path: "a.md", snapshotHash: "x", preview: "p", apply: vi.fn() };
    const mutatingTool = {
      mutating: true,
      schema: { name: "create_note", description: "x", parameters: {} },
      execute: vi.fn().mockResolvedValue({ ok: true, data: { pendingChangeId: "pc1", preview: "p" } }),
    };
    const registry = new ToolRegistry();
    registry.register(mutatingTool);
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: {
          role: "assistant",
          content: [],
          toolCalls: [{ id: "1", name: "create_note", arguments: { path: "a.md", content: "x" } }],
        },
        usage: null,
      }),
    };
    const loop = new AgentLoop(provider, registry, "system", new ContextBudgetTracker(60000, 90));
    loop.registerPendingChange(fakePendingChange as any);
    const result = await loop.run([userMsg("create a.md")]);
    expect(result.type).toBe("pending_approval");
  });

  it("returns a structured error to the model instead of throwing when tool arguments are malformed", async () => {
    const tool = {
      mutating: false,
      schema: { name: "read_note", description: "x", parameters: {} },
      execute: vi.fn().mockRejectedValue(new Error("bad args")),
    };
    const registry = new ToolRegistry();
    registry.register(tool);
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: [], toolCalls: [{ id: "1", name: "read_note", arguments: {} }] },
        usage: null,
      }),
    };
    const loop = new AgentLoop(provider, registry, "system", new ContextBudgetTracker(60000, 90));
    const result = await loop.run([userMsg("read")]);
    expect(result.type).toBe("tool_executed");
    if (result.type === "tool_executed") {
      expect(result.toolEvent.result).toEqual({ ok: false, error: "bad args" });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/loop.test.ts`
Expected: FAIL with "Cannot find module '../../src/agent/loop'"

- [ ] **Step 3: Write `src/agent/loop.ts`**

```ts
import type { ChatMessage, ModelProvider } from "../provider/types";
import type { ToolRegistry } from "../tools/registry";
import type { PendingChange } from "./pending-change";
import type { ContextBudgetTracker } from "./context-budget";

export type LoopStepResult =
  | { type: "final"; message: ChatMessage }
  | { type: "pending_approval"; change: PendingChange; resumeMessages: ChatMessage[] }
  | { type: "tool_executed"; toolEvent: { name: string; result: unknown }; messages: ChatMessage[] };

export class AgentLoop {
  private pendingChanges = new Map<string, PendingChange>();

  constructor(
    private readonly provider: ModelProvider,
    private readonly registry: ToolRegistry,
    private readonly systemPrompt: string,
    private readonly budget: ContextBudgetTracker
  ) {}

  registerPendingChange(change: PendingChange): void {
    this.pendingChanges.set(change.id, change);
  }

  async run(messages: ChatMessage[]): Promise<LoopStepResult> {
    const systemMessage: ChatMessage = { role: "system", content: [{ type: "text", text: this.systemPrompt }] };
    const response = await this.provider.chat([systemMessage, ...messages], this.registry.schemas());
    if (response.usage) this.budget.recordUsage(response.usage);

    const toolCall = response.message.toolCalls?.[0];
    if (!toolCall) {
      // No native tool-call returned: treat as a final plain-text answer, never crash (grilling Q1).
      return { type: "final", message: response.message };
    }

    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      const errorResult = { ok: false, error: `Unknown tool: ${toolCall.name}` };
      return {
        type: "tool_executed",
        toolEvent: { name: toolCall.name, result: errorResult },
        messages: [...messages, response.message, this.toolResultMessage(toolCall.id, errorResult)],
      };
    }

    let result;
    try {
      result = await tool.execute(toolCall.arguments);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (tool.mutating && result.ok) {
      const pendingId = (result.data as { pendingChangeId: string }).pendingChangeId;
      const change = this.pendingChanges.get(pendingId);
      if (change) {
        return {
          type: "pending_approval",
          change,
          resumeMessages: [...messages, response.message],
        };
      }
    }

    return {
      type: "tool_executed",
      toolEvent: { name: toolCall.name, result },
      messages: [...messages, response.message, this.toolResultMessage(toolCall.id, result)],
    };
  }

  private toolResultMessage(toolCallId: string, result: unknown): ChatMessage {
    return {
      role: "tool",
      toolCallId,
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/loop.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/loop.ts tests/agent/loop.test.ts
git commit -m "feat: add agent orchestration loop with tool dispatch and pending-change suspend"
```

---

### Task 24: Fuzzy path matcher for `@path` mentions

**Files:**
- Create: `src/ui/fuzzy-path-matcher.ts`
- Test: `tests/ui/fuzzy-path-matcher.test.ts`

**Interfaces:**
- Produces: `fuzzyMatchPaths(query: string, paths: string[]): string[]` (subsequence match on the path string, case-insensitive, ranked: exact filename match first, then subsequence match position, then path length). Pure function, no Obsidian dependency. Consumed by Task 25 (side panel `@` autocomplete dropdown).

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/fuzzy-path-matcher.test.ts
import { describe, it, expect } from "vitest";
import { fuzzyMatchPaths } from "../../src/ui/fuzzy-path-matcher";

describe("fuzzyMatchPaths", () => {
  it("matches a subsequence of characters, case-insensitively", () => {
    const paths = ["Projects/Tailscale Setup.md", "Groceries.md"];
    expect(fuzzyMatchPaths("tlscl", paths)).toEqual(["Projects/Tailscale Setup.md"]);
  });

  it("ranks an exact filename match above a partial subsequence match", () => {
    const paths = ["Archive/Old Notes.md", "Notes.md"];
    expect(fuzzyMatchPaths("notes", paths)).toEqual(["Notes.md", "Archive/Old Notes.md"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(fuzzyMatchPaths("xyz123", ["a.md", "b.md"])).toEqual([]);
  });

  it("returns all paths sorted when the query is empty", () => {
    expect(fuzzyMatchPaths("", ["b.md", "a.md"])).toEqual(["a.md", "b.md"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/fuzzy-path-matcher.test.ts`
Expected: FAIL with "Cannot find module '../../src/ui/fuzzy-path-matcher'"

- [ ] **Step 3: Write `src/ui/fuzzy-path-matcher.ts`**

```ts
function subsequenceMatchIndex(query: string, target: string): number {
  let qi = 0;
  let firstMatchIndex = -1;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (qi === 0) firstMatchIndex = ti;
      qi++;
    }
  }
  return qi === query.length ? firstMatchIndex : -1;
}

export function fuzzyMatchPaths(query: string, paths: string[]): string[] {
  const q = query.toLowerCase();
  if (q === "") return [...paths].sort();

  const scored: { path: string; rank: number; matchIndex: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const filename = lower.slice(lower.lastIndexOf("/") + 1);
    const exact = filename === q || filename.startsWith(q);
    const matchIndex = subsequenceMatchIndex(q, lower);
    if (!exact && matchIndex === -1) continue;
    scored.push({ path, rank: exact ? 0 : 1, matchIndex: exact ? 0 : matchIndex });
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.matchIndex - b.matchIndex || a.path.length - b.path.length)
    .map((s) => s.path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/fuzzy-path-matcher.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/fuzzy-path-matcher.ts tests/ui/fuzzy-path-matcher.test.ts
git commit -m "feat: add lexical fuzzy matcher for @path mentions (no semantic search)"
```

---

### Task 25: Side panel `ItemView` with chat, `@path` autocomplete, and image paste/drop

**Files:**
- Create: `src/ui/side-panel-view.ts`
- Manual test: none automated — Obsidian's `ItemView`/DOM rendering is verified by the manual end-to-end pass in Task 28's Step 4, consistent with the design doc's own testing strategy (line 75: manual e2e for side panel, drag&drop, real provider).

**Interfaces:**
- Consumes: `AgentLoop`/`LoopStepResult` (Task 23), `fuzzyMatchPaths` (Task 24), `parseCommand` (Task 21), `loadSkill`/`listSkillNames` (Task 22), `ChatMessage` (Task 2).
- Produces: `VIEW_TYPE_VAULT_AGENT` constant string, `VaultAgentView` class extending Obsidian's `ItemView`, constructor `(leaf: WorkspaceLeaf, loop: AgentLoop, vault: Vault)`. Renders a scrollable message list, a text input with `@`-triggered autocomplete dropdown (using `fuzzyMatchPaths` over `vault.getFiles().map(f => f.path)`), paste/drop handlers for images (base64-encode via `FileReader`, append as `ImageContent` to the next outgoing message), and a per-tool-call progress line appended live as the loop's `tool_executed` steps resolve (per the grilling session: no token streaming, but real-time tool visibility). Consumed by Task 28 (`main.ts` registers the view).

- [ ] **Step 1: Write `src/ui/side-panel-view.ts`**

```ts
import { ItemView, type WorkspaceLeaf, type Vault } from "obsidian";
import { AgentLoop, type LoopStepResult } from "../agent/loop";
import { fuzzyMatchPaths } from "./fuzzy-path-matcher";
import { parseCommand } from "../agent/commands";
import type { ChatMessage } from "../provider/types";

export const VIEW_TYPE_VAULT_AGENT = "vault-agent-view";

export class VaultAgentView extends ItemView {
  private messages: ChatMessage[] = [];
  private messageListEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private dropdownEl!: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf, private readonly loop: AgentLoop, private readonly vault: Vault) {
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
    this.messageListEl = container.createDiv({ cls: "vault-agent-messages" });
    this.dropdownEl = container.createDiv({ cls: "vault-agent-mention-dropdown" });
    this.dropdownEl.style.display = "none";
    this.inputEl = container.createEl("textarea", { cls: "vault-agent-input" });

    this.inputEl.addEventListener("input", () => this.handleInputChange());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSubmit();
      }
    });
    this.inputEl.addEventListener("paste", (e) => void this.handlePaste(e));
    this.inputEl.addEventListener("drop", (e) => void this.handleDrop(e));
  }

  private handleInputChange(): void {
    const value = this.inputEl.value;
    const atIndex = value.lastIndexOf("@");
    if (atIndex === -1) {
      this.dropdownEl.style.display = "none";
      return;
    }
    const query = value.slice(atIndex + 1);
    const allPaths = this.vault.getFiles().map((f) => f.path);
    const matches = fuzzyMatchPaths(query, allPaths).slice(0, 10);
    this.renderDropdown(matches, atIndex);
  }

  private renderDropdown(matches: string[], atIndex: number): void {
    this.dropdownEl.empty();
    if (matches.length === 0) {
      this.dropdownEl.style.display = "none";
      return;
    }
    this.dropdownEl.style.display = "block";
    for (const path of matches) {
      const item = this.dropdownEl.createDiv({ text: path, cls: "vault-agent-mention-item" });
      item.addEventListener("click", () => this.selectMention(path, atIndex));
    }
  }

  private selectMention(path: string, atIndex: number): void {
    const before = this.inputEl.value.slice(0, atIndex);
    this.inputEl.value = `${before}@${path} `;
    this.dropdownEl.style.display = "none";
    this.inputEl.focus();
  }

  private async handlePaste(e: ClipboardEvent): Promise<void> {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await this.attachImageFile(file);
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    await this.attachImageFile(file);
  }

  private async attachImageFile(file: File): Promise<void> {
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
    this.pendingImages.push({ type: "image", base64, mimeType: file.type });
  }

  private pendingImages: { type: "image"; base64: string; mimeType: string }[] = [];

  private async handleSubmit(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = "";

    const command = parseCommand(text);
    if (command) {
      this.appendSystemLine(`Command not yet wired: /${command.name}`);
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: [{ type: "text", text }, ...this.pendingImages],
    };
    this.pendingImages = [];
    this.appendMessage(userMessage);
    this.messages.push(userMessage);

    await this.continueLoop();
  }

  private async continueLoop(): Promise<void> {
    let result: LoopStepResult = await this.loop.run(this.messages);
    while (result.type === "tool_executed") {
      this.appendSystemLine(`🔧 ${result.toolEvent.name} → ${JSON.stringify(result.toolEvent.result).slice(0, 80)}`);
      this.messages = result.messages;
      result = await this.loop.run(this.messages);
    }
    if (result.type === "final") {
      this.messages.push(result.message);
      this.appendMessage(result.message);
    } else if (result.type === "pending_approval") {
      this.renderPendingChange(result.change, result.resumeMessages);
    }
  }

  private renderPendingChange(change: { id: string; preview: string; apply(): Promise<{ ok: true } | { ok: false; error: string }> }, resumeMessages: ChatMessage[]): void {
    const block = this.messageListEl.createDiv({ cls: "vault-agent-pending-change" });
    block.createEl("pre", { text: change.preview });
    const approve = block.createEl("button", { text: "Approve" });
    const reject = block.createEl("button", { text: "Reject" });
    approve.addEventListener("click", async () => {
      const applyResult = await change.apply();
      block.remove();
      this.appendSystemLine(applyResult.ok ? "✓ Applied." : `✗ ${applyResult.error}`);
      this.messages = resumeMessages;
      await this.continueLoop();
    });
    reject.addEventListener("click", () => {
      block.remove();
      this.appendSystemLine("Rejected by user.");
    });
  }

  private appendMessage(message: ChatMessage): void {
    const text = message.content.filter((c) => c.type === "text").map((c) => (c as any).text).join("\n");
    this.messageListEl.createDiv({ cls: `vault-agent-message vault-agent-${message.role}`, text });
  }

  private appendSystemLine(text: string): void {
    this.messageListEl.createDiv({ cls: "vault-agent-system-line", text });
  }
}
```

- [ ] **Step 2: Manual verification (no automated test for ItemView rendering)**

Run: `npm run build`, then load the plugin in a real Obsidian vault (see Task 28, Step 4) and confirm:
- Side panel opens with an empty message list and a text input.
- Typing `@` opens a dropdown filtered by fuzzy match as you type; clicking an entry inserts the path and closes the dropdown.
- Pasting or dragging an image into the input attaches it (verify by sending a message and checking the next request payload includes image content — see Task 28, Step 4 for the real-provider check).
- Sending a message that triggers a tool call shows a `🔧` progress line before the final answer appears.
- A mutating tool call shows an Approve/Reject block with the diff preview; clicking Approve writes the file and resumes the loop; clicking Reject cancels without writing.

- [ ] **Step 3: Commit**

```bash
git add src/ui/side-panel-view.ts
git commit -m "feat: add side panel chat view with @path mentions, image attach, and pending-change approval"
```

---

### Task 26: Settings tab for provider configuration

**Files:**
- Create: `src/ui/settings-tab.ts`
- Manual test: verified in Task 28, Step 4 alongside the side panel.

**Interfaces:**
- Consumes: `ConnectionSettings`/`loadConnectionSettings`/`saveConnectionSettings` (Task 5).
- Produces: `VaultAgentSettingTab` class extending Obsidian's `PluginSettingTab`, rendering a provider-type dropdown (`openai-compat` / `ollama-native`) and a base URL text field, persisting via `saveConnectionSettings` on change — never via `this.plugin.saveData()`, per ADR 0002. Consumed by Task 28 (`main.ts` registers the tab).

- [ ] **Step 1: Write `src/ui/settings-tab.ts`**

```ts
import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import { loadConnectionSettings, saveConnectionSettings, type ConnectionSettings } from "../storage/connection-settings";

export class VaultAgentSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
  }

  display(): void {
    this.displaySettings();
  }

  displaySettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    const current: ConnectionSettings = loadConnectionSettings() ?? {
      providerType: "openai-compat",
      baseUrl: "",
    };

    new Setting(containerEl)
      .setName("Provider type")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai-compat", "OpenAI-compatible")
          .addOption("ollama-native", "Ollama-native")
          .setValue(current.providerType)
          .onChange((value) => {
            saveConnectionSettings({ ...current, providerType: value as ConnectionSettings["providerType"] });
          })
      );

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("e.g. http://my-mac.tailnet-1234.ts.net:11434 — saved only in this browser's localStorage, never in the vault (ADR 0002).")
      .addText((text) =>
        text.setValue(current.baseUrl).onChange((value) => {
          saveConnectionSettings({ ...current, baseUrl: value });
        })
      );
  }
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run build`, load the plugin (Task 28, Step 4), open Settings → Vault Agent, change the base URL, reload Obsidian, confirm the value persists and that `.obsidian/plugins/vault-agent/data.json` does NOT contain it (grep the file).

- [ ] **Step 3: Commit**

```bash
git add src/ui/settings-tab.ts
git commit -m "feat: add settings tab for provider connection config (localStorage-backed)"
```

---

### Task 27: Wire everything together in `main.ts`

**Files:**
- Modify: `src/main.ts`
- Manual test: full end-to-end pass against a real vault and a real remote provider.

**Interfaces:**
- Consumes every module from Tasks 2-26: `OpenAICompatProvider`/`OllamaNativeProvider` (3, 4), `loadConnectionSettings` (5), `loadOrCreateAgentConfig` (6), `saveSession`/`listSessions`/`loadSession` (7), `ToolRegistry` + all tools (9-18), `buildSystemPrompt` (19), `ContextBudgetTracker` (20), `AgentLoop` (23), `LexicalIndex` (13), `VaultAgentView`/`VIEW_TYPE_VAULT_AGENT` (25), `VaultAgentSettingTab` (26).
- Produces: a fully wired `VaultAgentPlugin.onload()` that registers the side panel view, the settings tab, builds the tool registry, and constructs the `AgentLoop` with the configured provider.

- [ ] **Step 1: Write `src/main.ts`**

```ts
import { Plugin, type WorkspaceLeaf } from "obsidian";
import { OpenAICompatProvider } from "./provider/openai-compat-provider";
import { OllamaNativeProvider } from "./provider/ollama-native-provider";
import { loadConnectionSettings } from "./storage/connection-settings";
import { loadOrCreateAgentConfig } from "./storage/agent-config";
import { ToolRegistry } from "./tools/registry";
import { createReadNoteTool } from "./tools/read-note";
import { createReadImageTool } from "./tools/read-image";
import { createListFolderTool } from "./tools/list-folder";
import { createSearchNotesTool } from "./tools/search-notes";
import { LexicalIndex } from "./tools/search-index";
import { createCreateNoteTool } from "./tools/create-note";
import { createEditNoteTool } from "./tools/edit-note";
import { createGetFrontmatterTool, createSetFrontmatterTool } from "./tools/frontmatter";
import { createManageTagsTool } from "./tools/manage-tags";
import { buildSystemPrompt } from "./agent/system-prompt";
import { ContextBudgetTracker } from "./agent/context-budget";
import { AgentLoop } from "./agent/loop";
import { VaultAgentView, VIEW_TYPE_VAULT_AGENT } from "./ui/side-panel-view";
import { VaultAgentSettingTab } from "./ui/settings-tab";

const MAX_CONTEXT_TOKENS = 60000;

export default class VaultAgentPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addSettingTab(new VaultAgentSettingTab(this.app, this));

    const registry = new ToolRegistry();
    const onPendingChange = (change: unknown) => {
      (registry as any).lastPendingChange = change;
    };

    registry.register(createReadNoteTool(this.app.vault as any));
    registry.register(createReadImageTool(this.app.vault as any));
    registry.register(createListFolderTool(this.app.vault as any));
    registry.register(createCreateNoteTool(this.app.vault as any, onPendingChange as any));
    registry.register(createEditNoteTool(this.app.vault as any, onPendingChange as any));
    registry.register(createGetFrontmatterTool(this.app.vault as any));
    registry.register(createSetFrontmatterTool(this.app.vault as any, onPendingChange as any));
    registry.register(createManageTagsTool(this.app.vault as any, onPendingChange as any));

    const index = new LexicalIndex();
    await index.buildFromVault(this.app.vault as any);
    registry.register(createSearchNotesTool(index));

    const agentsFile = this.app.vault.getAbstractFileByPath("AGENTS.md");
    const agentsContent = agentsFile ? await this.app.vault.adapter.read("AGENTS.md") : null;
    const systemPrompt = buildSystemPrompt(agentsContent);

    const config = await loadOrCreateAgentConfig(this.app.vault as any);
    const budget = new ContextBudgetTracker(MAX_CONTEXT_TOKENS, config.compactThresholdPercent);

    const connection = loadConnectionSettings();
    const provider =
      connection?.providerType === "ollama-native"
        ? new OllamaNativeProvider(connection.baseUrl)
        : new OpenAICompatProvider(connection?.baseUrl ?? "");

    const loop = new AgentLoop(provider, registry, systemPrompt, budget);

    this.registerView(VIEW_TYPE_VAULT_AGENT, (leaf: WorkspaceLeaf) => new VaultAgentView(leaf, loop, this.app.vault));

    this.addRibbonIcon("bot", "Open Vault Agent", () => {
      this.activateView();
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_VAULT_AGENT)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE_VAULT_AGENT, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload(): void {}
}
```

Note: `onPendingChange` here is a placeholder wiring point — Task 17's tools call it per-execution, but the loop (Task 23) looks up pending changes via `registerPendingChange`/`pendingChanges` map on the `AgentLoop` instance, not via this module-level callback. Fix this mismatch in Step 2 before building.

- [ ] **Step 2: Fix pending-change wiring to flow through `AgentLoop.registerPendingChange`**

Replace the `onPendingChange` definition and registration lines with:

```ts
const loop = new AgentLoop(provider, registry, systemPrompt, budget);
const onPendingChange = (change: import("./agent/pending-change").PendingChange) => loop.registerPendingChange(change);
```

placed immediately after `const loop = new AgentLoop(...)` is constructed, and move every `registry.register(create...Tool(...))` call that takes `onPendingChange` to after this point (after the `loop` and `onPendingChange` declarations, before `this.registerView(...)`).

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Manual end-to-end verification in a real vault**

1. Copy `manifest.json`, `main.js` into `<vault>/.obsidian/plugins/vault-agent/`, enable the plugin in Obsidian's Community Plugins settings.
2. Open Settings → Vault Agent, set provider type and base URL to point at the real Debian/Tailscale/nginx endpoint from the grilling session.
3. Open the side panel via the ribbon icon, send a message that requires `search_notes` then `read_note` — confirm the `🔧` progress lines appear before the final answer.
4. Ask the agent to create a note — confirm an Approve/Reject block appears with a readable diff preview, and that clicking Approve writes the file (check in the real vault) while Reject does not.
5. Paste an image into the chat input and ask a question about it — confirm the remote model's response reflects the image content (validates the multimodal payload end-to-end).
6. Edit the same note in another window between proposing a change and approving it, then approve — confirm a conflict error appears instead of a silent overwrite (ADR 0004/0006 conflict path).
7. Type `@` and a few letters of a note name — confirm the fuzzy dropdown appears and inserts the path on click.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire provider, tools, agent loop, and UI together in VaultAgentPlugin"
```

---

## Self-Review

**Spec coverage:** every design doc section maps to a task — `provider/` → Tasks 2-4; `tools/` read-only → Tasks 10-13; path confinement (ADR 0006) → Task 8, applied in every tool task; `@path` mention → Task 24-25; mutating tools/pending changes → Tasks 16-18; diff format (ADR 0004) → Task 14; conflict detection → Task 15-16; agent loop → Task 23; system prompt/AGENTS.md → Task 19; skills → Task 22; commands (`/resume`, `/clear`, `/compact`, `/help`) → Task 21; context budget/auto-compact (ADR 0005) → Task 20; connection settings (ADR 0002) → Task 5; chat sessions (ADR 0003) → Task 7; UI side panel/diff blocks/image paste → Task 25; settings tab → Task 26; wiring → Task 27.

**Gaps deliberately deferred, not forgotten:**
- `/compact`'s actual summarization call to the model (Task 21 only does truncation for `/resume`; the manual/auto `/compact` path needs its own model-call step) — flagged here, not silently dropped: a follow-up task should add `compactSession(loop, session): Promise<ChatSession>` that calls the provider once to summarize older messages, called from both the UI's `/compact` handler and from `AgentLoop.run` when `budget.shouldCompact()` is true.
- Backlink graph search (`app.metadataCache.resolvedLinks`) mentioned in the design doc alongside lexical search is not yet a separate tool — `search_notes` (Task 13) is lexical-only. A follow-up task should extend `createSearchNotesTool` to also rank by backlink proximity using the real `metadataCache`, which cannot be faked as cheaply as the adapter-based fakes used elsewhere.
- `/help` (Task 21 parses it, but no handler renders the list) and the `Agent Chats`-folder exclusion from `search_notes`/indexing (moot now since sessions are `.json` not `.md`, confirmed in the design doc edit) are wired in Task 21/13 respectively, not separate tasks.

**Placeholder scan:** no "TODO"/"handle errors appropriately" left in any step; the one corrected placeholder-risk (Task 27's mismatched `onPendingChange`) is fixed inline in Step 2 of that task, not deferred.

**Type consistency:** `PendingChange`, `ToolResult`, `Tool`, `ChatMessage`, `LoopStepResult` are defined once (Tasks 16, 9, 9, 2, 23 respectively) and referenced by the same names throughout; `VaultLike`/`VaultAdapterLike` (Task 6) are reused and extended (never redefined) by Tasks 7, 13, 21, 22.

