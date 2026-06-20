# 0006: Confinamento al vault tramite solo `app.vault` API, mai `fs` diretto

## Status
Accepted

## Context
Nessun tool ha un controllo esplicito che impedisca path fuori dal vault. Un modello (per errore o per contenuto malevolo letto da una nota) potrebbe richiedere un path come `../../etc/passwd` o un path assoluto.

## Decision
Tutti i tool che toccano il filesystem (`read_note`, `read_image`, `list_folder`, `create_note`, `edit_note`, `get_frontmatter`/`set_frontmatter`, `manage_tags`) usano esclusivamente `app.vault`/`app.vault.adapter` di Obsidian, mai il modulo `fs` di Node con path assoluti concatenati a mano — l'API vault opera per costruzione su path vault-relative e non può indirizzare file fuori dal vault. Come difesa aggiuntiva, ogni path in ingresso da una tool-call viene rifiutato a priori (errore strutturato, non normalizzazione silenziosa) se contiene `..` o inizia con `/`.

## Trade-off
Nessuna perdita di funzionalità per lo scope v1 (mai serviva accesso fuori vault); aggiunge un controllo esplicito a runtime su ogni chiamata tool, costo trascurabile.

## Alternatives considered
- Normalizzazione silenziosa del path (clamp dentro al vault): scartata, preferibile un errore esplicito rimandato al modello piuttosto che correggere silenziosamente un'intenzione sospetta.
