# 0005: Gestione del budget di contesto con compact manuale e automatico, sempre visibile

## Status
Accepted

## Context
Il modello target ha un budget di contesto limitato (~60k token, vincolo posto per girare su hardware specifico). Conversazioni lunghe rischiano di superare il budget a metà sessione, in particolare con `/resume` di sessioni vecchie.

## Decision
- Il consumo di contesto si misura dai token reali riportati dal provider (`usage`/`eval_count` nella risposta), non da una stima locale (char/4).
- Comando manuale `/compact`: riassume via chiamata al modello i messaggi più vecchi, mantenendo intatti gli ultimi N.
- Compact **automatico** al superamento di una soglia percentuale (default 90%, configurabile in `.agents/config.json`), stesso meccanismo di `/compact` manuale.
- Il compact automatico non è mai silenzioso: il plugin mostra sempre un messaggio in chat quando scatta ("contesto al 90%, comprimo automaticamente").

## Trade-off
Il compact (manuale o automatico) consuma una chiamata aggiuntiva al provider remoto e può degradare la qualità del riassunto con un modello piccolo (Gemma) — accettato comunque perché l'alternativa (troncamento secco come in `/resume`, vedi [[0003]]) perde informazione senza nemmeno il tentativo di preservarne il senso.

## Alternatives considered
- Solo troncamento (niente riassunto): più semplice/economico, scartato per `/compact` perché l'utente vuole esplicitamente continuità di senso, non solo "tenere gli ultimi N messaggi".
- Soglia in `AGENTS.md` (frontmatter): scartata, l'utente preferisce un file di config dedicato (`.agents/config.json`) separato dal system prompt prosa.
