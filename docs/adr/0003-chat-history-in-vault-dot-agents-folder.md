# 0003: Cronologia chat salvata nel vault sotto `.agents/chats/*.json`

## Status
Accepted

## Context
A differenza delle connection settings ([[0002]]), l'utente vuole la cronologia chat visibile/persistente nel vault stesso (non device-local), per poterla riprendere con `/resume` stile Claude Code. Questo significa accettare lo stesso rischio di leak via Git già evitato per i settings.

## Decision
Le sessioni chat sono salvate come file `.json` (non markdown) in `.agents/chats/`, cartella con prefisso punto — nascosta di default dal file explorer di Obsidian. L'esclusione da Git è responsabilità manuale dell'utente (riga in `.gitignore`), non del plugin.

## Trade-off
Rischio di leak accettato consapevolmente per avere cronologia persistente e ripristinabile cross-sessione; mitigato solo da convenzione (cartella punto + gitignore manuale), non da garanzia strutturale come in [[0002]].

## Alternatives considered
- IndexedDB (stesso principio di [[0002]]): scartata perché l'utente vuole la chat visibile/gestibile come dato del vault, non device-local.
