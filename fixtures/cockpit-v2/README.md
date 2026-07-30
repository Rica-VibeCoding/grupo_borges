# Contrato de paridade — Cockpit v2

Passo 1 da ordem aprovada em `docs/cockpit-v2-fusao.md`: **baseline antes de tudo.**
Sem transcript congelado, "o painel novo ficou melhor" é opinião, e "não perdeu
nenhum evento" é fé.

Gravado em 2026-07-30 do painel em produção, consumindo o mesmo endpoint SSE que o
front consome. **Nada foi commitado no `apps/web`** — a instrumentação é de fora, o
cockpit no ar não foi tocado.

## O que tem aqui

| Caminho | Vai pro git? | O que é |
|---|---|---|
| `familias/` | ✅ sim (77 KB) | um exemplar **redigido** por família de payload, 52 famílias |
| `familias/_indice.json` | ✅ sim | quantas vezes cada família aparece nos transcripts reais |
| `transcripts/` | ❌ **gitignored** | os SSE crus, 22 MB — conversa real da frota |
| `*.py` | ✅ sim | os instrumentos, pra regravar quando quiser |

**Por que os crus não entram:** 22 MB de conversa integral do Rica com a frota —
processo judicial, dados de cliente, credenciais citadas de passagem. O contrato de
paridade precisa da **estrutura** (chaves, tipos, aninhamento, ordem), não do texto.
Então o texto vira placeholder do mesmo tamanho e a forma fica intacta.

A redação passa por auditoria automática contra sete padrões (bot token, email, CPF,
chave `sk_`/`ghp_`, `senha:`, IP público, id opaco de alta entropia). A primeira
rodada **vazou um `file_id` do Telegram** — daí a heurística `_opaca()` em
`redigir-familias.py`. Rodar a auditoria de novo a cada regravação.

## Como regravar

```bash
# 1. grava os SSE crus (back precisa estar de pé em :8000)
python3 fixtures/cockpit-v2/gravar-transcripts.py pavan daniel tara hiro vinicius

# 2. inventaria as famílias (contagens, sem conteúdo)
python3 fixtures/cockpit-v2/inventario-familias.py

# 3. gera as fixtures redigidas
python3 fixtures/cockpit-v2/redigir-familias.py
```

O default continua escolhendo o primeiro exemplar observado. Para
`bloco__thinking`, esse primeiro evento é degenerado (`thinking: ""`), embora
exista um exemplar com texto entre as 804 ocorrências. A regravação validada do
representante usa:

```bash
python3 fixtures/cockpit-v2/redigir-familias.py --preferir-thinking-com-conteudo
```

A flag só troca o exemplar dessa família; não altera contagens nem escolhe
eventos para satisfazer teste. Ela também preserva a quantidade de linhas com
marcadores redigidos, sem gravar o raciocínio real.

## O contrato do endpoint

`GET /api/agents/{slug}/messages/stream?sessionId=&limit=&since_id=`

Protocolo: `replay-start` → N × `message` → `replay-end` → live, com `heartbeat` a
cada 15 s, mais `subagent`, `ask_user` e `error`. Cursor público é `task_events.id`
(`replay-end.last_id`), e o `Last-Event-ID` do `EventSource` é honrado no reconnect.

Forma canônica de um `message`:

```
id · kind · uuid · parent_uuid · session_id · is_sidechain · user_type
timestamp · created_at · agent_id · message{role, content} · tool_use_result
```

## O que a medição revelou (números do baseline)

- **A minha sessão despeja 15,9 MB em 3.080 eventos no replay inicial.** O servidor
  gasta **202 ms** montando isso — o custo é todo no cliente. É aqui que o celular
  morre, e é o alvo do item 1 do gate.
- **82% dos blocos são ferramenta, não conversa:** 1.500 `tool_use` + 1.499
  `tool_result`, contra 330 `text` e 804 `thinking`. O chat da frota **não é
  `user/assistant`** — isso é evidência empírica para o spike do `assistant-ui`
  (era exatamente o argumento eliminatório do `sol` na fusão).
- **23 tools distintas** e **24 formas diferentes de `tool_use_result`**. Cada forma
  é um caso de renderer. Bash domina com 738 chamadas.
- **Casos de borda que quebram renderer ingênuo, achados sem procurar:**
  199 mensagens com `content: null` e 87 com `content` string em vez de lista.
  Estão em `familias/borda__*.json`.
- `isImage` aparece em 5 formas de resultado de Bash, e `isBase64` em leitura de
  recurso MCP — imagem em `tool_result` é real, não hipótese.
- `structuredPatch` vem pronto no resultado de `Edit`/`Write` (77 ocorrências) — o
  diff viewer não precisa calcular diff, só renderizar.

## Como isso vira gate

O item 5 do "Comportamento observável" (paridade semântica) se verifica assim: para
os mesmos eventos gravados, painel antigo e novo produzem **o mesmo agrupamento, a
mesma ordem e o mesmo conjunto de itens**. As 52 famílias são a lista de casos que o
`convertMessage` e o classificador têm de cobrir — e as duas de borda são as que
merecem teste primeiro, porque são as que ninguém escreve de propósito.
