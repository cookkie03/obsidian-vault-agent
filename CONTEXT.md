# Glossario — Obsidian Vault Agent Plugin

- **Tool read-only**: tool eseguito immediatamente senza approvazione (`search_notes`, `read_note`, `list_folder`, `get_frontmatter`).
- **Tool mutante**: tool che non scrive subito sul filesystem ma genera un **pending change** in attesa di approvazione (`create_note`, `edit_note`, `set_frontmatter`, `manage_tags`).
- **Pending change**: diff proposto da un tool mutante, sospeso nell'agent loop finché l'utente non approva o rifiuta. Vedi [[0004]].
- **Anchor**: frammento di testo univoco nel file usato dal modello per ancorare un'operazione di diff, al posto di un numero di riga. Vedi [[0004]].
- **Op-list**: formato JSON strutturato (lista di operazioni insert/replace/delete, ciascuna con un `anchor`) che il modello produce come diff primario per `edit_note`.
- **Session**: una conversazione salvata come file `.json` in `.agents/chats/`, ripristinabile con `/resume`. Vedi [[0003]].
- **ModelProvider**: interfaccia comune (`chat(messages, tools) -> response`) implementata da `OpenAICompatProvider` e `OllamaNativeProvider`.
- **Skill**: nota in `.agents/skills/*.md` con istruzioni riusabili, invocata in chat con `/nome-skill [argomenti]`. Vedi `AGENTS.md`-append nel design doc.
- **Compact**: operazione (manuale `/compact` o automatica a soglia) che riassume via modello i messaggi più vecchi di una sessione, mantenendo intatti gli ultimi N. Vedi [[0005]].
- **`.agents/`**: cartella punto in root del vault, contiene `chats/*.json` (sessioni, vedi [[0003]]), `skills/*.md`, `config.json` (parametri non sensibili, es. `compactThresholdPercent`).
