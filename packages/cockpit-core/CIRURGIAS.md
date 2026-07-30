# CIRURGIAS.md — o que se pode mexer dentro do `cockpit-core`

> Passo 3 da ordem em `cockpit-v2-fusao.md`. A fusão cobrou esta lista porque
> "`lib/` sobrevive com zero reescrita" e "os 10 hotspots resolvidos" se
> contradiziam. Este arquivo desfaz a contradição — e o resultado é melhor do que
> o previsto.

## O achado: nenhum dos 10 hotspots mora aqui

Cruzando os 10 hotspots de `docs/refactor-playbook.md` (JP-18, diagnóstico do
Daniel, com arquivo e linha) contra os 14 arquivos copiados para `src/`:

| hotspot | onde mora | está no core? |
|---|---|---|
| 1. árvore reconstrói por chunk | `chat-messages.tsx:511` + `use-messages-stream.ts:234` | **não** |
| 2. sem virtualização | `chat-messages.tsx:585-664` | não |
| 3. markdown reprocessa | `chat-messages.tsx:449-455` | não |
| 4. auto-scroll sem rAF | `chat-messages.tsx:533-542` | não |
| 5. sem "agente digitando" | `chat-messages.tsx` | não |
| 6. expand do chip empurra scroll | `one-line-chip.tsx` | não |
| 7. textarea mede por keystroke | `chat-panel.tsx:375-382` | não |
| 8. cap de 134px | `chat-panel.tsx:380` | não |
| 9. timer 1Hz no container | `chat-messages.tsx:524-528` | não |
| 10. reconnect espera 30s | `use-messages-stream.ts:316-322` | **não** |

**Dez de dez fora.** Todos moram em componentes React ou no hook de SSE — e o
corte que define este pacote (puro, sem React) excluiu exatamente esses arquivos.

A leitura que isso permite, e que muda o tom do projeto: **o `render-items.ts` não
é dívida, é o ativo.** O hotspot 1 não diz que `buildRenderItems` é lento — diz que
ele era **chamado em O(N) a cada chunk**. O defeito estava em *quem chamava e
quando*, não no que era chamado. As 528 linhas maduras atravessam a migração
intactas; o que se joga fora é o consumo.

Consequência prática: `use-messages-stream.ts` e os componentes de chat **não são
copiados** para o v2. São código novo, escrito contra este núcleo. É por isso que
não há "cirurgia" a fazer no que foi extraído.

---

## A única cirurgia prevista, e ela é condicional

A contramedida do hotspot 1 é **append incremental** em vez de reconstruir a lista
inteira por chunk. Se o spike do passo 5 confirmar que isso é necessário (é o
esperado), o pacote ganha:

```ts
appendRenderItems(items: RenderItem[], novas: MessagePayload[]): RenderItem[]
```

Com três condições, e elas não são negociáveis:

1. **Função nova, ao lado.** `buildRenderItems` **não é alterada**. Nada de
   parâmetro extra, nada de flag, nada de "otimizar por dentro".
2. **A antiga vira oráculo de teste.** Para qualquer sequência de mensagens,
   `appendRenderItems` aplicado incrementalmente tem de produzir **exatamente** o
   que `buildRenderItems` produz do zero. É um teste de propriedade, e ele roda
   contra as 52 famílias de `fixtures/cockpit-v2/familias/`.
3. **Preservar identidade de objeto.** Os itens que não mudaram têm de sair com a
   **mesma referência**. É a condição nº 1 do playbook (§ armadilha do `WeakMap`):
   um `map` que recria tudo invalida o cache do `assistant-ui` e devolve o hotspot
   que estávamos tirando.

Fora dessa, mudança neste pacote passa por mim (Pavan) — é a única peça que as três
frentes consomem, e mexer aqui as pausa. Ver `docs/cockpit-v2-ownership.md` §3.

---

## O que *não* veio, e por que

Ficaram no `apps/web` de propósito:

- `cockpit-css.ts` — 40 KB **numa única linha**, o gerador do visual matrix. É o que
  o v2 joga fora. (Nota lateral: arquivo de linha única é armadilha de `grep` largo
  nesta máquina — ver a memória do incidente de 28/07.)
- `pane-chrome.ts`, `cockpit-mock.ts`, `slash-command-palette-logic.ts` — atados à
  UI antiga.
- Todos os `use-*.ts` e `*-context.tsx` — React. A fronteira SSE→estado é o ponto
  onde o débito estava concentrado, e é código novo no v2.

Critério de entrada, para quem for adicionar algo: **sem `import` de react, e
fechado sob suas próprias dependências.** O pacote hoje tem zero import apontando
para fora de si — verificado por mim e reconfirmado em auditoria independente
(Tara, 30/07): os únicos imports externos de todo o pacote são `node:test` e
`node:assert`, e só no arquivo de teste.

Precisão sobre a procedência: dos 14 arquivos, 13 vieram de `apps/web/lib/` e
**um** — `one-line-chip-types.ts` — de `apps/web/components/`. A mensagem do commit
`b1fefc3` diz "14 arquivos de `apps/web/lib`", o que é impreciso. Não afeta o
fechamento do pacote; fica registrado aqui porque histórico de commit não se
reescreve.

## O consumo como source foi provado em build de produção

A dúvida real era se `exports` apontando para `.ts` com
`allowImportingTsExtensions` funcionava só em `next dev`. **Funciona nos dois:** a
auditoria rodou `pnpm install --frozen-lockfile` e `next build` numa cópia
temporária, e o Next 16.2.6 compilou, type-checou e gerou as páginas. Não é
comportamento exclusivo de desenvolvimento.
