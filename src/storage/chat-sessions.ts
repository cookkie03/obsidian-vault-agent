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
