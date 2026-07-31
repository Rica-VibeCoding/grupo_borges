# Revisão cruzada — `agent-result` da Tara (G7, 30/07 noite)

> Revisor: Hiro. Regra do ownership.md: revisão de frontend é sempre Kimi/Hiro,
> nunca o autor. RELATO, não correção — quem ajusta é a Tara ou o Pavan.
> Escopo: `components/renderers/agent-result.{ts,tsx,test.ts}` (sem commit).
> Régua: `docs/cockpit-v2-estetica.md`, fixtures reais em
> `fixtures/cockpit-v2/familias/`, padrão dos irmãos `fetch-result`/`result-list`.

**Veredito: aprovado com 1 médio, 1 baixo, 2 nits.** Normalizador e testes são
sólidos; o achado principal está na cor do cabeçalho.

---

## Achados

### 1. MÉDIO · cor do status é decidida pela VARIANTE, não pelo valor

`agent-result.tsx:103-111`: a variante `concluido` pinta o status em
`--ck-state-ok` (verde) e a `assincrono` em `--ck-state-running` (ciano) —
incondicionalmente. O normalizador aceita **qualquer** string de `status`
(`ehStringPreenchida`, `agent-result.ts:104-110`), mas os fixtures reais só
mostram `completed` e `async_launched`. Se um subagente terminar com
`failed`/`error`/`interrupted` — shape idêntico, status diferente — o cabeçalho
o pinta de **verde**. É a classe do literal mentiroso: não é cor-sozinha (a
palavra aparece, §9.7 safa), mas a cor **contradiz** a palavra, que é pior que
neutro.

Caminho sugerido (decisão de quem ajustar): mapear pelo VALOR —
`completed`→ok, `failed|error|interrupted`→fail, desconhecido→`text-secondary`
— mesma filosofia do "valor desconhecido aparece cru" do `acoes-rapidas.ts`.
Um teste com `status: 'failed'` sintético trava a regra sem fixture novo.

### 2. BAIXO · `formatoDuracao` local duplica o do `fetch-result.ts`

`agent-result.tsx:20-27` define um `formatoDuracao` próprio — sem a guarda de
`NaN`/negativo que o de `fetch-result.ts:37-41` tem, sem teste, com uma faixa
a mais (minutos). Duas cópias do mesmo conceito são como elas divergem em
silêncio — a lição que o `motor.ts` documenta ter aprendido com
`shortModelName` e que o `acoes-rapidas.ts` cita ao importar em vez de copiar.
Caminho: estender o `formatoDuracao` existente com a faixa de minutos (ou
extrair para módulo compartilhado) e cobrir a faixa nova com teste.

### 3. NIT · `Intl.NumberFormat` instanciado por chamada

`agent-result.tsx:29-31`: `formatoNumero` cria um `Intl.NumberFormat('pt-BR')`
novo a cada chamada — 9 por render do `Resumo`, que não é memoizado. Barato,
mas o padrão da casa instancia uma vez no módulo.

### 4. NIT · `text-[13px]` solto em vez do token

O arquivo usa `text-[13px]` em 8 lugares; `--ck-text-sm` **é** 13px. A §9.15
só proíbe entrelinha/tracking soltos, então não reprova — e o irmão
`fetch-result.tsx` faz igual. Vale decidir uma vez para os dois: ou vira
padrão consciente, ou token nos dois — para a terceira cópia não nascer
divergente.

---

## O que conferi e está certo (para não reabrir)

- **Normalizador estrito e pessimista**: exige as chaves observadas nos
  fixtures (`agentId`/`status`/`resolvedModel` na base; as específicas de cada
  variante depois); `null` fora da família — verificado contra as duas fixtures
  G7 e contra a rejeição da fixture G3 (`durationSeconds_query_results…`).
- **Testes**: 2 fixtures reais (valores conferidos por mim contra o JSON —
  `a8d94ead4f11ef0db`/`async_launched`, `a52cc756ebf5ff9c9`/`completed`/
  `totalDurationMs 193145`/`toolStats` exato) + rejeição em 3 formas (null,
  objeto de outra família, fixture cruzada). União discriminada com guards
  corretos (`assert.fail` após narrow).
- **Tokens**: zero hex cru; `--ck-text-tertiary` ausente (a correção que ela
  mesma fez está valendo); bordas em `edge-hairline` (decorativo, sem piso —
  correto para moldura de seção).
- **Toque e a11y**: botões com `min-h-[44px]`; `aria-expanded` no "ver tudo"
  (que o irmão `fetch-result` NÃO tem — aqui está melhor); texto nunca some —
  parte sem texto vira `[conteúdo X sem texto]`, não string vazia.
- **Estado de expansão chaveado pelo conteúdo** (`chaveDoConteudo`): se a
  instância for reusada com outro resultado (feed virtualizado), o "ver tudo"
  não vaza de um agente para o outro. Esperto e barato.
- **Detalhes de leitura**: `ck-tabular` nos números, `Intl` pt-BR, U+2212 no
  saldo de linhas, teto de 120 linhas igual ao do `Saida`.
- O `prompt` da fixture assíncrona não entra no modelo — a `description` é o
  resumo certo para a linha; decisão correta.

## Nota de integração (minha, não da Tara)

A ramificação em `corpo-do-item.tsx` (peça minha, em andamento) vai chamar
`normalizarAgentResult` ANTES do componente — que re-normaliza internamente.
Redundância barata e deliberada: mantém o componente auto-suficiente para a
vitrine. Não é achado contra o arquivo dela.

---

## Delta pós-revisão (Hiro, 30/07 ~23h — a pedido do Pavan)

Mudanças depois da minha revisão: `d11c91b` (Daniel, committed — fix de
self-import em `fetch-result.tsx`/`result-list.tsx`) + o WIP em disco no
`agent-result.{ts,tsx,test.ts}` (território da Tara, sem commit).

**Médio nº 1 — RESOLVIDO, e bem resolvido.** `classeDeCorDoStatus`
(`agent-result.ts:52`) mapeia pelo VALOR: `completed*` → ok,
`failed|error|interrupted*` → fail, todo o resto → `text-secondary` neutro —
exatamente a filosofia do "desconhecido aparece cru". Bônus certo:
`async_launched` deixou de ser ciano (lançado ≠ rodando) e virou neutro.
Cobertura no padrão sugerido: teste sintético com `status: 'failed'` sobre a
fixture de concluído prova que o normalizador aceita e a cor acompanha, mais
`completed`→ok e `async_launched`→neutro. Sem ressalva.

**O 500 da rota real — causa raiz confirmada e o meu lado absolvido.** O
`d11c91b` documenta: os `.tsx` irmãos importavam de si mesmos sem extensão e o
Turbopack resolveu o bare specifier pro próprio arquivo (circular) quando a
minha ramificação (`2d51b20`) ligou os renderers à rota real — dormente até
então. Meu `corpo-do-item.tsx` já nascera com extensão explícita nos 3
imports, pela mesma ambiguidade. Lição registrada: **tsc e suíte NÃO pegam
isso** — só load de página real; o Playwright do Daniel na `/agente/pavan`
foi o gate que valeu.

**Suíte real na árvore atual: 254/254** (o "248" do `d11c91b` é de antes dos
meus 4 testes da ramificação + os do helper). tsc foi rodado limpo pelo
Daniel no `d11c91b` com o WIP presente.

**Seguem ABERTOS (decisão do Pavan, não bloqueiam o commit dos 3):**
- Baixo nº 2 — `formatoDuracao` duplicado (o `d11c91b` não tocou; o tmp que
  vi sumir era alguém começando e parando).
- Nits 3 e 4 — `Intl.NumberFormat` por chamada; `text-[13px]` × token.

**Veredito do delta: aprovado para commitar o `agent-result` quando a Tara/
Pavan decidirem** — o fix de import nela é idêntico ao do `d11c91b` e o
helper está correto e testado.
