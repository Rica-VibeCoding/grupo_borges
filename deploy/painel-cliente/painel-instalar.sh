#!/bin/sh
# Uso: painel-instalar.sh  (roda como root, com /tmp/painel.tgz e /tmp/uv presentes)
set -e
install -m 0755 /tmp/uv /usr/local/bin/uv
rm -rf /opt/painel.novo && mkdir -p /opt/painel.novo
tar -xzf /tmp/painel.tgz -C /opt/painel.novo --strip-components=1
cd /opt/painel.novo/apps/api
UV_PYTHON_DOWNLOADS=never UV_CACHE_DIR=/var/cache/uv uv sync --frozen --no-dev -q
rm -rf /opt/painel.velho; [ -d /opt/painel ] && mv /opt/painel /opt/painel.velho; mv /opt/painel.novo /opt/painel
# o venv guarda caminho absoluto: refaz no lugar final
cd /opt/painel/apps/api && rm -rf .venv && UV_PYTHON_DOWNLOADS=never UV_CACHE_DIR=/var/cache/uv uv sync --frozen --no-dev -q
/opt/painel/apps/api/.venv/bin/python -c "import fastapi, uvicorn; print('ok', fastapi.__version__)"
