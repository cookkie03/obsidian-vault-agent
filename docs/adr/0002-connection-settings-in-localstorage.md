# 0002: Connection settings (host, MagicDNS, IP) in localStorage, mai nel vault

## Status
Accepted

## Context
Obsidian salva normalmente i settings di un plugin in `.obsidian/plugins/<id>/data.json`, dentro il vault. Il vault dell'utente è un repo Git sincronizzato su GitHub: qualsiasi file dentro il vault rischia di finire in un commit.

## Decision
Le impostazioni di connessione al provider remoto (host/IP, hostname MagicDNS, eventuali credenziali future) sono salvate in `window.localStorage`, non in `data.json`/nel vault. Sono quindi per-dispositivo by design, non sincronizzate tra device.

## Trade-off
Ogni dispositivo (Mac, iPhone) richiede una configurazione separata — accettabile perché ogni device ha comunque un percorso di rete proprio. In cambio, zero rischio strutturale di leak via Git, indipendente dall'igiene del `.gitignore` dell'utente.

## Alternatives considered
- `data.json` + `.gitignore` manuale: scartata come unica difesa, usata solo come rete di sicurezza secondaria (vedi anche [[0003]] per la cronologia chat, dove invece si è scelto di accettare il rischio nel vault).
