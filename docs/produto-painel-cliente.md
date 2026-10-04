# Painel do cliente — contrato do back-end

O `apps/cockpit` usa `API_BACKEND_URL` do **portão**, nunca a API da Oracle 0.
O portão autentica cada pedido e escolhe um único destino por `slug` no cadastro
local. Cada cliente roda `apps/api/client_app.py` no próprio contêiner, com uma
SQLite local só para indexar o JSONL de `/casa/claude/projects`. O código da frota
é importado: os mesmos handlers de `routers.agents`, `routers.conversas` e
`routers.tts` são montados por lista positiva. A app da frota não muda.
O indexador guarda offsets em `/casa/painel/api.offsets.json`, retoma o que
falta no boot e deduplica linhas após queda entre banco e checkpoint.

## Rotas públicas autorizadas

Os sufixos `/{slug}...` abaixo recebem prefixo `/api/agents`; rotas que começam
com `/api` ou `/uploads` estão completas. O
consumidor é `packages/cockpit-core/src/api.ts`, o hook de stream do cockpit ou
o composer. O servidor valida a posse antes de abrir o stream, ler upload ou
executar qualquer handler. `slug` é um identificador do cadastro do portão,
não uma URL escolhida pelo usuário para o destino.

| Método | Sufixo | Consumidor |
|---|---|---|
| GET | `/{slug}` | `fetchAgent`, página no servidor; inclui `pane_excerpt` e `pane_session_started_at` da sessão viva |
| GET | `/{slug}/painel`, `/{slug}/pulso` | `fetchAgentPainel`, `fetchAgentPulso` |
| GET | `/{slug}/events` | SSE de estado da frota de um |
| GET | `/{slug}/messages/stream`, `/{slug}/pane/stream` | feed e pane SSE |
| POST | `/{slug}/input`, `/{slug}/interromper`, `/{slug}/destrava` | composer, Stop, Destravar, `/compact` via input |
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

`/api/agents/{slug}/fila` e `DELETE .../fila/{id}` constam no core,
mas **não existem na API da frota** neste commit-base. A fila nativa do Claude
vem dos eventos `queue-operation` no stream; a fila do composer é local. O
executor da UI usa esses dois sinais. Cancelamento individual da fila nativa
não está disponível pela API e deve ficar desabilitado na tela do cliente.
O endpoint de leitura de Conversas devolve o resumo textual existente; o feed
com ferramentas vem de `messages/stream` com `session_id` da conversa.

## Estado ao vivo e troca na tela

`GET /api/agents/{slug}/events` devolve `text/event-stream`. O evento `state`
tem `data` JSON com esta forma:

```json
{
  "agent": {"slug": "teste", "lifecycle_status": "trabalhando", "lifecycle_updated_at": 1791000000, "pane_excerpt": "Opus 4.8 - 00:03:12 - [████░░░░░░] 40%", "pane_session_started_at": 1790999808},
  "painel": {"vida": {"sessao": true, "processo": true}, "contexto": {"pct": 40, "tokens": {"total": 80000}, "updated_at": 1791000000, "stale": false}},
  "status": "trabalhando",
  "generated_at": 1791000000
}
```

`agent` é o mesmo recorte de `GET /{slug}`, inclusive campos de lifecycle;
`painel` contém **só** `vida` e `contexto`, com todos os campos normais desses
dois objetos de `GET /painel`. `status` usa a regra do backend para presença +
lifecycle. O primeiro `state` sai ao conectar; os demais saem quando o JSONL é
indexado, uma mutação da API termina ou a reconciliação detecta mudança externa.
Há ping SSE a cada 15 s e reconciliação a cada 30 s para tmux/controlador e
statusline, que não passam pelo watcher. Reconnect recebe novo retrato completo;
não há cursor nem replay. O portão valida sessão e posse antes de abrir o SSE.

**Tela — estado empurrado (feito):** `apps/cockpit/app/api/agents/[slug]/events/route.ts`
repassa o SSE com `repassaSse` (o rewrite genérico passaria pelo
`compress: true` do Next e seguraria eventos pequenos). Em
`lib/usa-frota-do-cliente.ts` o timer de 5 s saiu: um `EventSource` ouve
`state`, `leEstado` (`lib/frota-do-cliente.ts`) confere a forma e a frota de
um é montada com `agent`, `painel.vida`/`painel.contexto` e o `status` do
servidor, que vence a cópia local de `derive_agent_status`. A cópia sobra
para o SSR (só `GET /{slug}`) e para o `/painel` que Ligar/Desligar publicam
antes do próximo `state`. Queda de rede é religada pelo próprio navegador;
resposta recusada (401, 403, 502) fecha o `EventSource`, e aí o `/auth/me`
decide: 401 vai ao `/entrar`, `trocar_senha` ao `/senha`, sessão boa religa
com espera de 1 s dobrando até 30 s (`esperaParaReligar`). Aba escondida
fecha a conexão; voltar abre outra, que chega com retrato completo. O
`pedeReleituraDaFrota` não tem mais ouvinte no modo cliente: as mutações da
API já empurram `state`.

**Tela — statusline da gaveta (feito):** `GET /{slug}` e cada `state.agent`
trazem `pane_excerpt` e `pane_session_started_at`; `agenteDoCliente` os
repassa e a `Statusline` da gaveta volta a mostrar modelo e tempo de sessão
como na frota. O `?? null` fica só para back mais velho (`undefined` no
relógio vira `NaN:NaN`).
O script de statusline do contêiner imprime modelo e duração no formato que
`parseModelFromPane` reconhece. `pane_session_started_at` é a âncora da duração
ativa reportada pelo Claude Code, não uma data de criação do arquivo JSONL.
O JSON oficial fornece `model.id`, `model.display_name`, `session_id` e
`cost.total_duration_ms`; este último soma tempo ativo entre retomadas e
exclui o período parado, conforme a [documentação do Claude Code](https://code.claude.com/docs/en/statusline).
O `display_name` pode vir só como `Opus`; o script extrai a versão de
`model.id` quando necessário.

## Anexos duráveis

Somente `client_app` usa `PAINEL_UPLOADS_DIR` (padrão
`/casa/painel/uploads`). Imagens e arquivos ficam em
`<PAINEL_UPLOADS_DIR>/agents/<slug>/`; os dois endpoints de leitura autorizados
usam a mesma raiz. A frota conserva `apps/api/uploads/agents/`.

## Sessão e posse

`POST /auth/login` recebe usuário e senha. O portão confere `scrypt` com salt
por usuário e cria sessão aleatória no SQLite local; o navegador recebe cookie
`HttpOnly; Secure; SameSite=Lax`. O SQLite do portão é a fonte dos usuários,
incluindo hash e `trocar_senha`; `config["users"]` só insere usuários ainda
ausentes. Regravar a config ou reinstalar o código não restaura senha antiga.
`GET /auth/me` devolve `username`, `role`, `slug` e `trocar_senha: bool`;
`POST /auth/logout` revoga a sessão. `admin` existe no cadastro, mas a UI admin
é fase posterior.

`POST /auth/senha` recebe `{"atual": str, "nova": str}` e exige `Origin` igual
à origem pública. Devolve `204` e mantém a sessão atual após gravar novo hash
scrypt, zerar `trocar_senha` e revogar todas as outras sessões do usuário.
Senha atual errada devolve `401`; nova com menos de 8 caracteres ou igual à
atual devolve `422`. Cinco tentativas erradas de senha atual, somadas às de
login, bloqueiam o usuário por 15 min. Enquanto `trocar_senha` é true, qualquer
rota do portão com essa sessão devolve `403 {"detail":"trocar_senha"}`, exceto
`/auth/me`, `/auth/senha`, `/auth/logout` e `/health`. Novos clientes e os
clientes existentes na migração começam com troca obrigatória. Senha esquecida
é redefinida localmente pelo Rica, sem recuperação por e-mail; o comando está
no [roteiro de deploy](produto-painel-cliente-deploy.md).

**Tela da senha:** `/senha` (`app/senha/page.tsx`, só no modo cliente; na
frota é 404). Com `trocar_senha` true, login (`destinoDoLogin`), raiz
(`destinoDa`) e chat (`exigeSessao`) levam a ela, que mostra só "Crie sua
senha" — senha recebida, nova e confirmação — com o Sair embaixo; trocou, vai
ao chat por navegação cheia. Sem troca pendente, "Trocar senha" no pé da
gaveta (`SairDoPainel`) abre a mesma tela, que troca, avisa que as outras
sessões caíram e oferece "Voltar ao chat". O POST sai do navegador, como o
login, por causa do `Origin`. A tela barra antes do envio o que o portão
recusaria (menos de 8, igual à atual) e a confirmação diferente; 401, 422,
429, 403 e queda viram frases próprias em `components/entrar/senha.ts`. Um
401 primeiro consulta `/auth/me`: sessão expirada vai ao `/entrar` em vez de
culpar a senha atual. Um 403 `trocar_senha` no meio do uso é pego pelo
`/events` fechado (acima).

Toda
requisição `/api` ou `/uploads`, inclusive SSE e TTS,
passa por sessão e posse; rotas sem slug de agente são vinculadas ao slug da
sessão. Mutação exige `Origin` igual à origem pública configurada. O portão
descarta cabeçalhos de identidade recebidos do navegador e não aceita redirects
do destino. A API do cliente só aceita o token interno fixado no contêiner.

O executor do front deve encaminhar o cookie nas chamadas server-side de
`fetchAgent`; os rewrites e route handlers do navegador já o encaminham. O
`API_BACKEND_URL` do build e do runtime deve ser o mesmo portão local.

## Controlador e rede

O controlador escuta socket Unix **no hospedeiro**, acessível somente aos
proxy devices com token. Recebe `POST /v1/clients/{slug}/start|stop` e
`GET /v1/clients/{slug}/state`; carrega um mapa imutável
`slug -> (projeto Incus, instância)` e executa somente `systemctl
start|stop|is-active agente.service` via `incus --force-local exec ... --project ... --`, sem shell.
O portão usa token mestre; cada API cliente recebe token do controlador limitado
ao próprio slug para a troca de conversa. Nenhum recebe `/var/lib/incus/unix.socket`.
Nunca instalar o controlador dentro de contêiner.

Para cada cliente, a API escuta `127.0.0.1:8010` **dentro** do contêiner.
Dois proxy devices formam o caminho entre projetos: um `bind=host` no cliente,
`listen=unix:/run/cliente-api-host/<slug>.sock` e
`connect=tcp:127.0.0.1:8010`; outro `bind=instance` em `portao`,
`listen=unix:/run/cliente-api/<slug>.sock` e `connect=unix:/run/cliente-api-host/<slug>.sock`.
Os sockets têm modo `0660`, donos/grupos do serviço. Nenhum IP entre projetos
é liberado. O cadastro do portão aponta para o socket do cliente, jamais para
endereço informado no pedido. O socket do controlador entra no portão por um
proxy device Unix↔Unix separado e outro entra no cliente, com token limitado;
Incus socket não entra. Incus documenta `bind=host|instance` e Unix↔TCP em
<https://linuxcontainers.org/incus/docs/main/reference/devices_proxy/>.

O `GET /health` do portão precisa conter `grupo_borges-api` para a verificação
existente do build do Next. SSE preserva bytes, `Content-Type: text/event-stream`
e `Cache-Control: no-cache, no-transform`, sem gzip e sem buffer.

As duas rotas de gancho (`POST .../conversas/estacionar`,
`GET .../conversas/{id}/briefing`) existem só na API interna e aceitam apenas
o token do gancho ou o token interno; o portão não as repassa.

Aplicação na Oracle 1: [roteiro e arquivos](produto-painel-cliente-deploy.md).
