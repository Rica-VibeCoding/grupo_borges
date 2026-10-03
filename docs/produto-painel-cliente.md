# Painel do cliente — contrato do back-end

O `apps/cockpit` usa `API_BACKEND_URL` do **portão**, nunca a API da Oracle 0.
O portão autentica cada pedido e escolhe um único destino por `slug` no cadastro
local. Cada cliente roda `apps/api/client_app.py` no próprio contêiner, com uma
SQLite local só para indexar o JSONL de `/casa/claude/projects`. O código da frota
é importado: os mesmos handlers de `routers.agents`, `routers.conversas` e
`routers.tts` são montados por lista positiva. A app da frota não muda.

## Rotas públicas autorizadas

Todas as rotas abaixo começam com `/api/agents/{slug}` salvo indicação. O
consumidor é `packages/cockpit-core/src/api.ts`, o hook de stream do cockpit ou
o composer. O servidor valida a posse antes de abrir o stream, ler upload ou
executar qualquer handler. `slug` é um identificador do cadastro do portão,
não uma URL escolhida pelo usuário para o destino.

| Método | Sufixo | Consumidor |
|---|---|---|
| GET | `/{slug}` | `fetchAgent`, página no servidor |
| GET | `/{slug}/painel`, `/{slug}/pulso` | `fetchAgentPainel`, `fetchAgentPulso` |
| GET | `/{slug}/messages/stream`, `/{slug}/pane/stream` | feed e pane SSE |
| POST | `/{slug}/input`, `/{slug}/interromper` | composer, Stop, `/compact` via input |
| POST | `/{slug}/file`, `/{slug}/image`, `/{slug}/voice`, `/{slug}/transcription`, `/{slug}/transcription/live-token` | anexos, ditado e voz ao vivo |
| GET | `/{slug}/file/{filename}`; `/uploads/agents/{slug}/{filename}` | imagens do feed |
| GET | `/{slug}/conversas`, `/{slug}/conversas/operacao`, `/{slug}/conversas/{id}/leitura` | Conversas |
| POST | `/{slug}/conversas/nova`, `/{slug}/conversas/{id}/retomar`, `/{slug}/conversas/{id}/titulo`, `/{slug}/conversas/{id}/concluida`, `/{slug}/conversas/{id}/estrela` | Conversas |
| DELETE | `/{slug}/conversas/{id}` | Conversas |
| POST | `/{slug}/ligar`, `/{slug}/desligar` | botão de energia, implementado no portão |
| GET | `/{slug}/estado` | estado da unit, implementado no portão |
| POST | `/{slug}/quotas/refresh` | cota da assinatura |
| GET | `/api/tts/motores?slug=...` | seletor da voz |
| POST | `/api/tts/synth`, `/api/tts/synth/stream` | fala do agente |

`/api/agents/{slug}/fila` e `DELETE .../fila/{id}` são chamados pelo core,
mas **não existem na API da frota** neste commit-base. A fila observável vem
dos eventos `queue-operation` no stream. O executor da UI deve manter a fila
local derivada desses eventos até haver contrato de servidor para cancelamento.
O endpoint de leitura de Conversas devolve o resumo textual existente; o feed
com ferramentas vem de `messages/stream` com `session_id` da conversa.

## Sessão e posse

`POST /auth/login` recebe usuário e senha. O portão confere `scrypt` com salt
por usuário e cria sessão aleatória no SQLite local; o navegador recebe cookie
`HttpOnly; Secure; SameSite=Lax`. `GET /auth/me` devolve o papel e o slug;
`POST /auth/logout` revoga a sessão. `admin` existe no cadastro, mas a UI admin
é fase posterior. Toda requisição `/api` ou `/uploads`, inclusive SSE e TTS,
passa por sessão e posse; rotas sem slug de agente são vinculadas ao slug da
sessão. Mutação exige `Origin` igual à origem pública configurada. O portão
descarta cabeçalhos de identidade recebidos do navegador e não aceita redirects
do destino. A API do cliente só aceita o token interno fixado no contêiner.

O executor do front deve encaminhar o cookie nas chamadas server-side de
`fetchAgent`; os rewrites e route handlers do navegador já o encaminham. O
`API_BACKEND_URL` do build e do runtime deve ser o mesmo portão local.

## Controlador e rede

O controlador escuta socket Unix **no hospedeiro**, acessível somente ao grupo
do serviço do portão. Recebe `POST /v1/clients/{slug}/start|stop` e
`GET /v1/clients/{slug}/state`; carrega um mapa imutável
`slug -> (projeto Incus, instância)` e executa somente `systemctl
start|stop|is-active agente.service` via `incus exec --project ... --`, sem shell.
O portão usa um socket Unix dedicado; não recebe `/var/lib/incus/unix.socket`.
Nunca instalar o controlador dentro de contêiner.

Para cada cliente, a API escuta `127.0.0.1:8010` **dentro** do contêiner. Um
proxy device Incus em `portao` com `bind=instance`, `listen=unix:/run/cliente-api/<slug>.sock`
e `connect=tcp:127.0.0.1:8010` deve ser criado no projeto `portao` somente
depois de confirmar que o `connect` da versão instalada aponta para o destino
correto. Se esta direção não resolver um destino em outro projeto, usar dois
proxy devices: um `bind=host` no cliente, `listen=unix:/run/cliente-api-host/<slug>.sock`
e `connect=tcp:127.0.0.1:8010`; outro `bind=instance` em `portao`,
`listen=unix:/run/cliente-api/<slug>.sock` e `connect=unix:/run/cliente-api-host/<slug>.sock`.
Os sockets têm modo `0660`, donos/grupos do serviço. Nenhum IP entre projetos
é liberado. O cadastro do portão aponta para o socket do cliente, jamais para
endereço informado no pedido. O socket do controlador entra no portão por um
proxy device Unix↔Unix separado ou bind mount restrito; Incus socket não entra.

O `GET /health` do portão precisa conter `grupo_borges-api` para a verificação
existente do build do Next. SSE preserva bytes, `Content-Type: text/event-stream`
e `Cache-Control: no-cache, no-transform`, sem gzip e sem buffer.
