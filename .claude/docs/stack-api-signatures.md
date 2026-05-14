# Assinaturas atuais — stack API do cockpit grupo_borges

> Validação 2026-05-09 contra versões pinadas em `apps/api/pyproject.toml`.
> Fonte autoritativa por item: URL ao lado.
> ✅ = bate com o código atual em `apps/api/main.py`.
> ⚠️ = diverge ou merece atenção.

---

## Resumo executivo

- **FastAPI lifespan:** `@asynccontextmanager` + `yield` é o padrão canônico — `main.py:41-55` está ✅ correto. `@app.on_event` é deprecated e não deve ser usado.
- **Middleware HTTP:** `@app.middleware("http")` continua válido em 0.115+. O Tailscale identity em `main.py:79-101` está ✅ correto.
- **sse-starlette:** `EventSourceResponse` recebe async generator direto; cada `yield` deve ser `dict` com `data`/`event`/`id`. Disconnect via `await request.is_disconnected()`.
- **libtmux 0.40+:** `find_where()` foi removido — usar `server.sessions.get(session_name='...')`. `capture_pane(escape_sequences=True, join_wrapped=True)` ✅ ambos os kwargs existem. libtmux é sync — wrap com `asyncio.to_thread`.
- **pydantic-settings:** `SettingsConfigDict(env_prefix='GB_', env_nested_delimiter='__')` é o padrão — `GB_DB__PATH` vira `db.path`.

---

## FastAPI 0.115+

### Lifespan

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup — tudo antes do yield
    app.state.db = await create_db()
    yield
    # shutdown — tudo depois do yield
    await app.state.db.close()

app = FastAPI(lifespan=lifespan)
```

Fonte: https://fastapi.tiangolo.com/advanced/events

✅ `main.py:41-55` usa exatamente este padrão (`@asynccontextmanager` + `yield` separando startup de shutdown + `app.state.db = db`).

### Middleware HTTP custom

```python
from fastapi import FastAPI, Request
from starlette.responses import JSONResponse

@app.middleware("http")
async def my_middleware(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    user = request.headers.get("Tailscale-User-Login")
    if not user:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    request.state.tailscale_user = user
    return await call_next(request)
```

Fonte: https://fastapi.tiangolo.com/reference/fastapi

✅ `main.py:79-101` — `@app.middleware("http")`, `request.client.host`, `request.headers.get(...)`, `request.url.path`, `request.state.*`, retorno early com `JSONResponse` — tudo correto.

**Ordem de execução:** `add_middleware(CORSMiddleware)` executa **antes** de `@app.middleware("http")`. O CORS responde ao preflight antes de chegar no Tailscale identity — comportamento correto para o caso de uso.

### CORSMiddleware

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://meu-app.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # allow_origin_regex="https://.*\\.vercel\\.app"  # alternativa regex
)
```

Fonte: https://fastapi.tiangolo.com/reference/middleware

✅ `main.py:66-75` — `allow_origins` com lista exata funciona em 0.115+. Para regex (ex.: qualquer preview Vercel), usar `allow_origin_regex` no lugar de `allow_origins`.

### Routers / include_router

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/{agent_id}")
async def get_agent(agent_id: str, request: Request):
    db = request.app.state.db          # acesso a app.state via request
    return await db.get_agent(agent_id)

# No main.py:
app.include_router(router, prefix="/api/agents", tags=["agents"])
```

Fonte: https://fastapi.tiangolo.com/reference/apirouter

✅ `include_router(prefix=..., tags=...)` inalterado em 0.115+. `async def` em route handlers é o padrão.

### Acessando app.state em route

```python
from fastapi import Request

@router.get("/")
async def list_agents(request: Request):
    db = request.app.state.db
    return await db.list_agents()
```

Para reutilização via `Depends()`:

```python
from typing import Annotated
from fastapi import Depends, Request

async def get_db(request: Request):
    return request.app.state.db

DBDep = Annotated[GrupoBorgesDB, Depends(get_db)]

@router.get("/")
async def list_agents(db: DBDep):
    return await db.list_agents()
```

Fonte: https://fastapi.tiangolo.com/reference/httpconnection (`state` é propriedade de `HTTPConnection`)

### Background tasks

```python
from fastapi import BackgroundTasks

@router.post("/send-keys")
async def send_keys(cmd: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_tmux_command, cmd)   # roda após response
    return {"queued": True}
```

Fonte: https://fastapi.tiangolo.com/tutorial/background-tasks

Para work async disparado dentro de handler sem precisar de response imediata, `asyncio.create_task` também funciona — mas `BackgroundTasks` é o padrão FastAPI (integrado com DI, garante cleanup).

---

## sse-starlette 2.1+

### EventSourceResponse com async generator

```python
from sse_starlette import EventSourceResponse
from fastapi import Request
import asyncio

async def event_generator(request: Request):
    while True:
        if await request.is_disconnected():
            break
        yield {
            "data": "payload",
            "event": "agent_update",   # opcional, default: "message"
            "id": "uuid-aqui",         # opcional
        }
        await asyncio.sleep(0.5)

@router.get("/stream")
async def sse_endpoint(request: Request):
    return EventSourceResponse(event_generator(request))
```

Fonte: https://github.com/sysid/sse-starlette/blob/main/README.md

`EventSourceResponse` recebe **async generator direto** — não precisa wrapping. Cada item yielded deve ser `dict`.

### Keepalive

```python
EventSourceResponse(
    generator,
    ping=15,          # segundos (default: 15). 0 = desliga
    send_timeout=30,  # timeout de cada send em segundos
)
```

Fonte: https://context7.com/sysid/sse-starlette/llms.txt

Ping automático a cada 15s — mantém conexão aberta em proxies que fecham conexões ociosas. ✅ padrão adequado para o cockpit.

### Disconnect detection

```python
# Opção A — poll no generator (mais simples)
if await request.is_disconnected():
    break

# Opção B — via CancelledError (capturar e re-raise)
try:
    yield {"data": "tick"}
except asyncio.CancelledError:
    raise  # sempre re-raise
```

Fonte: https://github.com/sysid/sse-starlette/blob/main/README.md

### Graceful shutdown (lifespan)

```python
import anyio
from sse_starlette import EventSourceResponse

async def graceful_gen(request: Request, shutdown: anyio.Event):
    try:
        while not shutdown.is_set():
            yield {"data": "tick"}
            with anyio.move_on_after(1.0):
                await shutdown.wait()
        yield {"event": "shutdown", "data": "bye"}
    except anyio.get_cancelled_exc_class():
        raise

return EventSourceResponse(
    graceful_gen(request, shutdown_event),
    shutdown_event=shutdown_event,
    shutdown_grace_period=5.0,
)
```

Fonte: https://context7.com/sysid/sse-starlette/llms.txt

### Gotchas com FastAPI 0.115

❓ Não encontrado incompatibilidade específica de versão starlette nas docs do Context7. sse-starlette depende de `starlette` (não importa a versão do FastAPI diretamente). Verificar `pip show sse-starlette` para ver starlette constraint se ocorrer conflito.

---

## libtmux 0.40+

### Server() + lookup de sessão

```python
import libtmux

server = libtmux.Server()                    # socket default
# server = libtmux.Server(socket_name='x')   # socket nomeado

# Lookup por nome (API 0.28+, substitui find_where)
session = server.sessions.get(session_name="daniel")

# Filtro com contains/startswith
sessions = server.sessions.filter(session_name__contains="borges")

# Lista todas as sessões
all_sessions = server.sessions
```

Fonte: https://context7.com/tmux-python/libtmux/llms.txt

⚠️ **`find_where()` foi removido.** API nova: `server.sessions.get(session_name=...)` com Django-style lookups (`__contains`, `__startswith`, `__regex`, etc.).

### capture_pane — assinatura exata

```python
pane = session.active_pane

# Captura visível (padrão)
lines: list[str] = pane.capture_pane()

# Com kwargs do cockpit-bridge.md
lines = pane.capture_pane(
    escape_sequences=True,    # preserva ANSI color codes ✅
    join_wrapped=True,        # rejunta linhas quebradas por largura ✅
)

# Outros kwargs disponíveis
lines = pane.capture_pane(
    start=-100,               # últimas 100 linhas do histórico
    end='-',                  # até o final
    escape_non_printable=True,
)
```

Fonte: https://context7.com/tmux-python/libtmux/llms.txt + https://github.com/tmux-python/libtmux/blob/master/docs/topics/pane_interaction.md

✅ `cockpit-bridge.md:41` — `capture_pane(escape_sequences=True, join_wrapped=True)` ambos os kwargs existem e funcionam em 0.40+. Retorna `list[str]`.

### send_keys — assinatura exata

```python
# Enviar comando (Enter por padrão)
pane.send_keys("git status")

# Sem Enter (digitar sem submeter)
pane.send_keys("git status", enter=False)
pane.enter()                             # Enter separado

# Literal (não interpreta teclas especiais tmux)
pane.send_keys("C-c", literal=True)

# Sem histórico no shell
pane.send_keys("export SECRET=x", suppress_history=True)
```

Fonte: https://context7.com/tmux-python/libtmux/llms.txt

✅ `cockpit-bridge.md:41` — `send_keys(enter=False)` correto. Assinatura: `send_keys(keys, enter=True, literal=False, suppress_history=False)`.

### Wrap async (asyncio.to_thread)

libtmux é **100% síncrono**. Para usar dentro de handler async FastAPI sem bloquear o event loop:

```python
import asyncio
import libtmux

server = libtmux.Server()

async def capture_agent_output(session_name: str) -> list[str]:
    session = await asyncio.to_thread(
        server.sessions.get, session_name=session_name
    )
    pane = session.active_pane
    return await asyncio.to_thread(
        pane.capture_pane, escape_sequences=True, join_wrapped=True
    )

async def send_agent_keys(session_name: str, cmd: str) -> None:
    session = await asyncio.to_thread(
        server.sessions.get, session_name=session_name
    )
    pane = session.active_pane
    await asyncio.to_thread(pane.send_keys, cmd)
```

Fonte: padrão `asyncio.to_thread` (Python 3.9+, docs: https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.to_thread)

Alternativa: `loop.run_in_executor(None, fn, *args)`. `asyncio.to_thread` é mais idiomático em Python 3.9+.

---

## watchfiles 0.24+

### awatch — assinatura

```python
from watchfiles import awatch, Change
import asyncio

async def watch_jsonl_files(base_path: str):
    async for changes in awatch(base_path):
        for change_type, path in changes:
            if change_type == Change.modified and path.endswith('.jsonl'):
                await process_new_lines(path)
```

Fonte: https://context7.com/samuelcolvin/watchfiles/llms.txt

Yields `set[tuple[Change, str]]`. Recursivo por padrão.

### Change enum — valores

| Constante | Valor int | Quando dispara |
|---|---|---|
| `Change.added` | 1 | Arquivo criado |
| `Change.modified` | 2 | Arquivo modificado (write/append) |
| `Change.deleted` | 3 | Arquivo removido |

Fonte: https://context7.com/samuelcolvin/watchfiles/llms.txt (`Change.added.value` → `1`)

**JSONL append:** Claude Code abre o arquivo, escreve uma linha, fecha → dispara `Change.modified`. Filtrar por `change_type == Change.modified and path.endswith('.jsonl')`.

### Filtros (watch_filter)

```python
from watchfiles import awatch, Change

def only_jsonl(change: Change, path: str) -> bool:
    return change == Change.modified and path.endswith('.jsonl')

async for changes in awatch(base_path, watch_filter=only_jsonl):
    for _, path in changes:
        await process_new_lines(path)
```

Fonte: https://github.com/samuelcolvin/watchfiles/blob/main/docs/api/filters.md

### Recursão / múltiplos paths

```python
# Múltiplos paths (passados como args posicionais)
async for changes in awatch(path1, path2, path3):
    ...

# Recursivo por padrão — pega subagents/*.jsonl automaticamente
# Para desligar recursão: só disponível via CLI (--non-recursive), não na API Python
```

Fonte: https://context7.com/samuelcolvin/watchfiles/llms.txt

⚠️ **Adicionar path em runtime não é suportado** — `awatch` recebe os paths no momento da chamada. Para o cockpit monitorar agentes que ligam/desligam dinamicamente: passar o diretório pai (`~/.claude/projects/`) e filtrar por path no callback.

### Cancelamento gracioso

```python
import asyncio
from watchfiles import awatch

async def watch_with_shutdown(path: str, stop: asyncio.Event):
    async for changes in awatch(path, stop_event=stop):
        await process_changes(changes)
    # loop termina quando stop.set() é chamado

# No lifespan shutdown:
@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    task = asyncio.create_task(watch_with_shutdown(WATCH_PATH, stop))
    yield
    stop.set()
    await task
```

Fonte: https://context7.com/samuelcolvin/watchfiles/llms.txt (`stop_event=asyncio.Event()`)

---

## pydantic-settings 2.5+

### BaseSettings + SettingsConfigDict

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GB_",
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        case_sensitive=False,
    )

    host: str = "0.0.0.0"
    port: int = 8000
    dev_bypass_auth: bool = False

settings = Settings()  # lê GB_HOST, GB_PORT, GB_DEV_BYPASS_AUTH
```

Fonte: https://context7.com/pydantic/pydantic-settings/llms.txt + https://github.com/pydantic/pydantic-settings/blob/main/docs/index.md

### Env prefix `GB_*`

`env_prefix="GB_"` aplica a **todos** os campos. Env var = `GB_` + nome do campo em uppercase. Ex: campo `dev_bypass_auth` → `GB_DEV_BYPASS_AUTH`.

### Nested + delimiter

```python
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

class DBConfig(BaseModel):
    path: str = "grupo_borges.db"
    wal: bool = True

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GB_",
        env_nested_delimiter="__",
    )
    db: DBConfig = DBConfig()

# GB_DB__PATH=/data/borges.db → settings.db.path == "/data/borges.db"
# GB_DB__WAL=false            → settings.db.wal == False
```

Fonte: https://github.com/pydantic/pydantic-settings/blob/main/docs/index.md

### secrets_dir (opcional)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        secrets_dir="/run/secrets",   # Docker secrets / Tailscale secrets
    )
    db_password: str
```

Fonte: https://github.com/pydantic/pydantic-settings/blob/main/docs/index.md

✅ Vale a pena para o cockpit: Tailscale pode expor secrets via `/var/run/secrets/` em alguns setups. Mas não obrigatório agora — `.env` basta para dev.

---

## Diff vs bootstrap atual (apps/api/main.py)

| Linha | Padrão atual no código | Padrão correto (fonte) | Ação |
|---|---|---|---|
| `main.py:41-55` | `@asynccontextmanager` + `yield` | Idêntico ao oficial | ✅ manter |
| `main.py:79-101` | `@app.middleware("http")` | Idêntico ao oficial | ✅ manter |
| `main.py:66-75` | `add_middleware(CORSMiddleware, ...)` | Idêntico ao oficial | ✅ manter |
| `main.py:111-113` | `include_router(prefix=..., tags=...)` | Idêntico ao oficial | ✅ manter |
| (a criar) `routers/stream.py` | — | `EventSourceResponse(async_gen(request))` com `yield dict` | escrever assim |
| (a criar) `tmux_driver.py` | — | `asyncio.to_thread(pane.method, ...)`, `sessions.get(session_name=...)` | escrever assim |
| (a criar) `jsonl_watcher.py` | — | `awatch(base_path, stop_event=stop, watch_filter=only_jsonl)` | escrever assim |
| (a criar) `config.py` | — | `BaseSettings` + `SettingsConfigDict(env_prefix='GB_', env_nested_delimiter='__')` | escrever assim |

---

## ❌ Anti-padrões detectados

- ❌ `@app.on_event("startup")` / `@app.on_event("shutdown")` — **deprecated** em FastAPI 0.115+. Usar `lifespan`.
- ❌ `find_where({"session_name": "x"})` — **removido** do libtmux. Usar `sessions.get(session_name="x")`.
- ❌ Chamar `pane.capture_pane()` ou `pane.send_keys()` diretamente em handler async — bloqueia o event loop. Sempre wrapping com `asyncio.to_thread`.
- ❌ Passar `data: dict` direto em `EventSourceResponse` — ele espera um **iterable/generator** que *yields* dicts, não um dict único.
- ❌ `capture_pane()` sem `escape_sequences=True` quando o output contém cores ANSI — perde informação de status visual dos agentes.
- ❌ `allow_origins=["*"]` com `allow_credentials=True` — o browser recusa (CORS spec). Usar lista explícita de origens quando credentials habilitado.
- ❌ `awatch` tentando adicionar novos paths em runtime — não é suportado. Solução: `awatch` no diretório pai.
- ❌ `env_prefix` sem `env_nested_delimiter` em config com submodelos — vars de sub-model não são lidas do ambiente.

---

## Fontes

1. https://fastapi.tiangolo.com/advanced/events — lifespan oficial
2. https://fastapi.tiangolo.com/reference/fastapi — `middleware()` signature
3. https://fastapi.tiangolo.com/reference/middleware — `CORSMiddleware` params
4. https://fastapi.tiangolo.com/tutorial/background-tasks — `BackgroundTasks`
5. https://fastapi.tiangolo.com/reference/httpconnection — `state` property
6. https://github.com/sysid/sse-starlette/blob/main/README.md — `EventSourceResponse`, disconnect, shutdown
7. https://context7.com/sysid/sse-starlette/llms.txt — ping, `send_timeout`, `shutdown_event`
8. https://context7.com/tmux-python/libtmux/llms.txt — `Server()`, `sessions.get()`, `capture_pane`, `send_keys`
9. https://github.com/tmux-python/libtmux/blob/master/docs/topics/pane_interaction.md — `capture_pane` kwargs confirmados
10. https://context7.com/samuelcolvin/watchfiles/llms.txt — `awatch`, `Change` enum, `stop_event`, filtros
11. https://github.com/samuelcolvin/watchfiles/blob/main/docs/api/filters.md — `watch_filter` callable
12. https://context7.com/pydantic/pydantic-settings/llms.txt — `BaseSettings`, `SettingsConfigDict`
13. https://github.com/pydantic/pydantic-settings/blob/main/docs/index.md — `env_nested_delimiter`, `secrets_dir`
14. https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.to_thread — wrap sync em async
