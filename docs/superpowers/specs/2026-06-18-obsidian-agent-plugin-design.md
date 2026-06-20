# Obsidian Vault Agent Plugin — Design

## Obiettivo

Plugin Obsidian ultra-lightweight che fornisce un agente AI operativo sul vault (reasoning + tool-use + multimodale), ispirato a Obsidian Copilot e ai coding/cowork agent moderni, ma senza framework agentici esterni pesanti. L'inferenza avviene su un modello remoto (es. Gemma multimodale) hostato su un'altra macchina della rete (es. via Tailscale), tipicamente dietro Ollama o un server OpenAI-compatibile.

## Scope v1

- Plugin TypeScript puro per Obsidian, build con esbuild, nessuna dipendenza da framework agentici (no LangChain/Vercel AI SDK).
- Tool scope limitato al vault: nessun accesso shell o di rete generico.
- Retrieval lessicale (full-text + grafo di backlink), niente embedding/vector DB in v1.
- Modifiche al vault sempre human-in-the-loop: diff proposto, approvazione esplicita prima di scrivere.
- Input multimodale: immagini già presenti/embedded nelle note (`![[img.png]]`) o allegate in chat, inviate al modello multimodale. Audio non incluso in v1 (architettura predisposta per fase 2).
- Provider remoto configurabile: OpenAI-compatible (`/v1/chat/completions`) come default, adapter Ollama-native (`/api/chat`) come alternativa. Tool-calling tramite function-calling nativo del modello/provider.

## Architettura

Quattro moduli interni, isolati per responsabilità:

### `provider/`
Interfaccia comune `ModelProvider` (metodi: `chat(messages, tools) -> response`, eventualmente streaming). Due implementazioni:
- `OpenAICompatProvider`: chiama `/v1/chat/completions` con campo `tools`; immagini passate come content block `image_url` (data URI base64).
- `OllamaNativeProvider`: chiama `/api/chat`; immagini passate come campo `images` (array base64).

Host/porta/provider scelti nei plugin settings (es. URL Tailscale della macchina che hosta il modello).

### `tools/`
Registry di tool con schema JSON per function-calling:
- `search_notes` — full-text + ricerca su backlink/grafo
- `read_note` — solo testo; eventuali `![[img]]` embedded restano riferimenti testuali, non vengono inlineate
- `read_image` — read-only, richiamato esplicitamente dal modello per "vedere" un'immagine del vault (path → content block multimodale)
- `create_note` (mutante → genera pending diff)
- `edit_note` (mutante → genera pending diff, formato op-list con anchor testuale; fallback a full-content su errore di parsing/applicazione)
- `list_folder`
- `get_frontmatter` / `set_frontmatter` (mutante)
- `manage_tags` (mutante)

Tool read-only eseguiti immediatamente; tool mutanti restituiscono un diff testuale senza scrivere sul filesystem.

Tutti i tool filesystem operano solo via `app.vault`/`app.vault.adapter` (mai `fs` diretto) e rifiutano a priori path con `..` o che iniziano per `/`.

### `@path` mention in chat
Digitando `@` nell'input della chat si apre una dropdown con fuzzy-match lessicale (subsequence match, stile quick-switcher di Obsidian) sui path del vault, aggiornata ad ogni keystroke. Nessuna ricerca semantica/embeddings. Alla selezione:
- se è un file → il contenuto viene ingerito nel messaggio come se fosse il risultato di `read_note` (stesso trattamento delle immagini embedded: niente inlining automatico di immagini referenziate nel file citato).
- se è una cartella → il contenuto viene ingerito come se fosse il risultato di `list_folder`.

### `agent/`
Loop di orchestrazione:
1. Costruisce messages (system prompt + history + tool schemas) e chiama il provider.
2. Se la risposta richiede tool read-only → esegue subito, rimanda il risultato al modello, continua il loop.
3. Se richiede tool mutante → crea un "pending change" (diff) e **sospende** il loop in attesa di approvazione utente.
4. Su approve → esegue il tool via `app.vault` API, rilegge lo stato risultante, rimanda l'esito al modello, riprende il loop.
5. Su reject → rimanda al modello un messaggio di rifiuto (con motivo opzionale dell'utente).

### `ui/`
`ItemView` laterale (side panel), stile Copilot:
- Cronologia chat persistente per sessione.
- Input testo con drag&drop/paste immagini e riferimento automatico alle immagini embedded nella nota attiva.
- Blocchi diff inline con bottoni Approve/Reject per ogni pending change, mostrati direttamente nel flusso della conversazione.

## Flusso dati (sintesi)

Utente → side panel → agent loop → provider (remoto) → [tool call?] → tool registry → (read: esegue e ritorna; mutante: genera diff e attende) → UI mostra diff → utente approva/rifiuta → agent applica/rifiuta → provider continua → risposta finale in chat.

## Gestione errori

- Provider non raggiungibile (timeout/connessione): messaggio di errore in chat, opzione di retry, nessun crash del plugin.
- Tool call con argomenti malformati: errore strutturato rimandato al modello per autocorrezione, non eccezione silenziosa.
- Conflitto di scrittura: se il contenuto del file cambia tra generazione del diff e approvazione, il plugin rilegge il file al momento dell'apply; se diverso dal diff originale, segnala conflitto e annulla l'apply invece di sovrascrivere.

## Testing

- Unit test sui tool (create/edit/diff/search/frontmatter/tags) contro un vault di fixture isolato (cartella temporanea), mai contro il vault reale.
- Unit test sul loop agent con provider mockato (risposte HTTP fisse): tool call → risultato → tool call → risposta finale; più i casi di errore (provider down, tool malformato, conflitto di scrittura).
- Test manuale end-to-end nel vault reale per side panel, drag&drop immagini, e integrazione con il provider remoto reale (OpenAI-compat e Ollama-native).

## System prompt, skill e comandi

- System prompt base minimale, specifico al ruolo "agente del vault", hardcoded nel plugin (regole non negoziabili: human-in-the-loop sui mutanti, scope tool, formato diff).
- Append opzionale dal contenuto di `AGENTS.md` in root del vault, se esiste — istruzioni di contesto personali dell'utente, non può sovrascrivere le regole base.
- Skill custom: note in `.agents/skills/*.md`, testo libero. Invocate in chat con `/nome-skill [argomenti]`, intercettate dal plugin (non tool-call LLM) e iniettate come istruzione utente nel messaggio successivo. Creazione/editing manuale dell'utente in v1, nessun tool per crearle.
- Comandi built-in intercettati lato plugin: `/resume [id]` (lista o riprende una sessione da `.agents/chats/`, troncando dal fondo se non entra nel budget di contesto), `/clear` (salva la sessione corrente non vuota e ne apre una nuova), `/compact` (riassume via modello i messaggi più vecchi, mantenendo gli ultimi N), `/help` (lista skill + comandi disponibili).
- Gestione budget di contesto: token reali da `usage`/`eval_count` del provider; compact automatico al superamento soglia (default 90%, configurabile in `.agents/config.json`), sempre annunciato in chat, mai silenzioso.

## Fuori scope v1 (futuro)

- Retrieval semantico (embeddings + vector index leggero).
- Input/output audio.
- Tool di rete (fetch URL, ricerca web) e tool shell.
- Modalità autonoma senza approvazione umana.
