#!/usr/bin/env bash
# Copia l'app della segnaletica nella cartella /staff/ del sito ufficiale (repository skyracedelmaglio).
# Uso: tools/pubblica-sul-sito.sh [percorso del repository del sito]   (predefinito: ../skyracedelmaglio)
# Poi nel repository del sito: git add -A staff && git commit && git push
set -euo pipefail
QUI="$(cd "$(dirname "$0")/.." && pwd)"
SITO="${1:-$QUI/../skyracedelmaglio}"
DEST="$SITO/staff"
[ -d "$SITO/.git" ] || { echo "Repository del sito non trovato in $SITO" >&2; exit 1; }
# solo i file dell'app: niente regole Firestore, strumenti o README del repository di sviluppo
FILE=(index.html report.html sw.js manifest.webmanifest firebase-config.js css js data img vendor)
rm -rf "$DEST"
mkdir -p "$DEST"
for f in "${FILE[@]}"; do cp -R "$QUI/$f" "$DEST/"; done
cat > "$DEST/LEGGIMI.md" <<'TESTO'
# Accesso staff · Segnaletica e presidi SRM 2026

Copia dell'app sviluppata nel repository `fringuello79/SRMsegnaletica`.
Non modificare questi file qui: modifica l'originale e ricopia con `tools/pubblica-sul-sito.sh`.
L'accesso richiede il nome e il codice della squadra; i dati stanno su Firebase (progetto `srm-segnaletica`).
TESTO
echo "Copiato in $DEST"
