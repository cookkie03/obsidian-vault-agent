# 0004: Diff strutturato (JSON op-list con anchor testuale) come formato primario per `edit_note`

## Status
Accepted

## Context
I tool mutanti devono produrre un diff che il plugin può validare, mostrare in UI e applicare in modo sicuro (human-in-the-loop). Il modello target (Gemma via Ollama) ha supporto a function-calling poco affidabile e fa fatica con aritmetica su numeri di riga (unified diff classico).

## Decision
Formato primario: JSON op-list via function-calling, dove ogni operazione si ancora a un frammento di testo univoco nel file (`anchor`) invece che a numeri di riga. Se il parsing/applicazione fallisce (anchor non trovato), il plugin rimanda un errore strutturato al modello e gli istruisce di rigenerare la risposta usando il **fallback**: contenuto completo del nuovo file, da cui il plugin calcola il diff localmente per la UI.

## Trade-off
L'op-list con anchor è più tollerante agli errori di un modello piccolo rispetto a unified-diff, ma richiede comunque un parser/validatore custom (non uno standard esistente). Il fallback a full-content è più "a prova di errore" ma più costoso in token per file grandi — accettabile perché scatta solo dopo un fallimento.

## Alternatives considered
- Unified diff testuale: scartato come primario, troppo fragile con modelli piccoli sull'aritmetica delle righe.
- Full-content sempre: scartato come primario, spreca token su edit piccoli in note lunghe.
