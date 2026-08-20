# A fila do servidor — contrato entre os dois lados

Complementa a §10 de `docs/cockpit-v2-composer.md`, que desenhou a forma do item.
Aqui ficam as **rotas** e o que cada lado promete. A fixture ao lado
(`espelho-do-painel.json`) é o teste de contrato: os dois lados leem o mesmo
arquivo, ninguém espera o outro subir.

**Estado em 20/08:** o lado do painel está pronto — `fila-types.ts`,
`fila-do-servidor.ts`, `api.ts` e a máquina de envio já tratando o 202. O lado do
servidor **não existe**: nenhuma rota abaixo responde ainda, e enquanto não
responder o código novo do painel fica inerte (ninguém devolve `enfileirada`).

## Por que Codex-first

O Claude Code tem fila nativa: texto colado num pane ocupado vira
`queue-operation`/`enqueue` no JSONL e o CLI entrega quando o turno acaba.
Medido em 20/08: 1.267 `enqueue` em ~3,5 dias, **nenhum da Tara**. Construir
fila de servidor para o Claude Code seria reimplementar por cima de uma que já
funciona — e criar o segundo lugar onde a mensagem pode estar.

O Codex não tem. `telecodex_client.send_prompt` bate em `/control/prompt`, que
responde 409 `shared_turn_in_flight` com turno em voo, e o erro sobe por
`_spawn_codex_agent_turn` (`agents.py:2829`). **É ali que a fila intercepta.**

A drenagem amarra em `codex.turn.completed`, que já chega em
`routers/codex_events.py:188` e `:247`.

## Rotas

### `GET /api/agents/{slug}/fila`

```json
{ "itens": [ /* ItemDaFilaDoServidor, forma da §10 */ ] }
```

Devolve **todos** os itens da sessão, incluindo `entregue` e `cancelada` — quem
filtra é o painel (`espelhaFila`), porque só ele sabe o instante em que está
desenhando. Ordem não importa: a posição é derivada do `id` v7.

Rota própria por sessão, não campo do snapshot da frota (decisão de 20/08): o
snapshot é lido pela frota inteira a cada poll, e a fila só interessa a quem
está com a sessão aberta.

### `DELETE /api/agents/{slug}/fila/{id}`

```json
{ "cancelada": true, "item": { /* o item, agora em estado cancelada */ } }
```

- **409 `item_ja_drenando`** quando o item já saiu de `pendente`. Entre o desenho
  da tela e o toque, o servidor pode ter começado a drenar; cancelar o que já
  está a caminho seria prometer o que não dá para cumprir.
- Devolve o item para que o painel ponha o texto de volta no campo. **Não existe
  descarte** — cancelar e editar são o mesmo gesto.

### `POST /api/agents/{slug}/input` — a parte em aberto

Precisa aceitar `client_request_id` de fora (hoje o UUID nasce dentro de
`postAgentInput` e ninguém mais o vê) e, com turno Codex em voo, enfileirar em
vez de levantar 409.

> ⚠️ **A restrição que decide o formato da resposta.** Uma resposta de "entrou na
> fila" **não pode** ser um 200 com campos diferentes. `lib/usa-envio.ts` faz
> duas coisas com o retorno do `/input`:
>
> - `:152` — **lança** se não houver `event_boundary_id` válido;
> - `:370` — trata `tmux_delivered: false` como ausência de prova e leva a
>   máquina para `nao-confirmado`, que é vermelho na tela do Rica.
>
> Ou seja: enfileirar e devolver `{ enfileirada: true, item }` num 200/202, sem
> mais nada, pinta a fila de erro. O sucesso precisa de discriminante que a
> máquina de seis fases reconheça **antes** dessas duas guardas.

**Decidido em 20/08 (Pavan): 202.** "Aceito e enfileirado" é semanticamente o
que aconteceu; 409 diz conflito, e não há conflito nenhum — o texto foi
guardado. A alternativa (manter 409 e o painel consultar `GET .../fila`) fica
registrada só para não ser reproposta: dava mais ida de rede e deixava a fila do
Codex com cara diferente da do Claude Code na tela.

```json
{
  "enfileirada": true,
  "tmux_delivered": false,
  "sent_at": 1755710000,
  "event_boundary_id": 918273,
  "item_da_fila": { /* ItemDaFilaDoServidor */ }
}
```

`event_boundary_id` é **obrigatório no 202**, e não é enfeite: é ele que deixa o
eco da drenagem — que chega minutos depois, quando o TeleCodex finalmente
entrega — ser reconhecido pela máquina de envio e apagar a marca "entrou na
fila". Sem ele a promessa fica na tela para sempre.

**Feito no painel** (20/08): a máquina de envio ganhou o evento `enfileirar`,
que vai de `enviando` direto a `confirmado` com `fila: true` e `ecoId: null` —
sem passar por `aceito`, porque `aceito` é a espera do eco e aqui não há eco a
esperar. O prazo de 12s não se arma. Quando a drenagem chega, o eco `user`
apaga a marca e preenche o `ecoId`, pelo mesmo caminho que o Claude Code já
usa. A frase na tela é a mesma nos dois motores: **"entrou na fila"**.

## O que o painel promete

- **Não casa fila com feed.** A §10 tem os dois desenhos escritos; vale o segundo
  — o servidor casa por conteúdo, posicionalmente, porque só ele tem a ordem das
  entregas. O painel renderiza `estado`.
- **Não varre nada.** `drenando` além de 30s vira falho na leitura
  (`PRAZO_DRENANDO_MS`); a gravação de `motivo_falha` acontece na próxima escrita
  que passar por ali.
- **Não grava posição.** Deriva do `id` v7 na renderização.

## O que o servidor precisa prometer

- `endereco_retorno` viaja separado de `origem` — item do Telegram drenado sem
  `chat_id` responde no painel, e o Rica nunca vê.
- Desembrulho do envelope de canal é do servidor, e **falha de desembrulho é
  ruidosa**: gramática que não casar entrega o texto cru com o campo marcado
  como não reconhecido. Sem isso, item de Telegram apodrece até o teto de 5 min
  e ninguém liga o sintoma à causa.
- `motivo_falha` carimbado vence a frase genérica do prazo no painel — então
  vale carimbar o que se sabe (`pane_incompativel`, `input_ocupado_ou_travado`).
