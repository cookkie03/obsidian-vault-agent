# 0001: Nessuna autenticazione applicativa verso il provider remoto in v1

## Status
Accepted

## Context
Il modello multimodale gira su una macchina Debian, esposta in rete Tailscale (MagicDNS) dietro reverse proxy nginx. Il plugin deve chiamare quell'endpoint da Obsidian (desktop e mobile).

## Decision
Nessun layer di auth applicativa (bearer token, basic auth) nel plugin in v1. Ci si appoggia esclusivamente all'autenticazione di trasporto già fornita da Tailscale (WireGuard).

## Trade-off
Più semplice (niente token da generare, ruotare o far perdere nei settings di Obsidian, che non sono un secret store) ma il plugin si fida implicitamente del perimetro di rete: se un dispositivo entra nella tailnet, può chiamare l'endpoint senza ulteriori controlli.

## Alternatives considered
- Bearer token statico nei settings: scartato per ora, rischio di leak in chiaro superiore al beneficio dato che la rete è già privata.
