#!/bin/sh
# Source dentro de /usr/local/bin/agente-subir, imediatamente antes do exec claude.
# O controlador só executa systemctl; o ID validado vem do arquivo local da API.
PAINEL_RESUME_ID=
if [ -n "${PAINEL_RESUME_FILE:-}" ] && [ -f "$PAINEL_RESUME_FILE" ]; then
  IFS= read -r painel_resume_id < "$PAINEL_RESUME_FILE" || true
  rm -f -- "$PAINEL_RESUME_FILE"
  if printf '%s' "$painel_resume_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
    PAINEL_RESUME_ID=$painel_resume_id
  fi
fi
