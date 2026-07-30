# Auditoria de tema + cauda longa da matriz — 30/07 (Hiro)

> Auditoria pedida pelo Daniel. **RELATO, não correção** — não editei nada em
> `apps/cockpit/`. Achado sem certeza está marcado como SUSPEITA.
>
> Estado do trabalho: **EM ANDAMENTO** (regravação incremental — turno anterior
> morreu em 429 segurando relato em memória; agora cada achado entra no disco na
> hora).

## Fila de verificação — o que falta olhar

Parte 1 (cor fora do tema):
- [x] varredura mecânica: hex, rgb(), rgba(), oklch(), hsl(), oklab(), lab(), lch() fora do `globals.css`
- [x] classes utilitárias de cor fixa do Tailwind (bg-red-500, text-white, ...) — varredura mecânica
- [x] valores arbitrários de cor (`bg-[#...]`, `text-[oklch(...)]`)
- [x] fill/stroke de SVG ≠ currentColor
- [x] `components/ui/badge.tsx` — `text-white` histórico já podado em 30/07 (limpo)
- [x] `linha-execucao.tsx:64` — record `COR` inteiro: os 4 valores são `var(--ck-*)`. LIMPO.
- [x] `marca.cor` do `retrato.tsx` — vem de `components/shell/estado.ts:27-30`, os 4 estados usam `var(--ck-*)`. LIMPO.
- [x] `code-block.tsx`, `thinking.tsx` — só `var(--ck-*)` em arbitrary values e classes `ck-*`. LIMPO.
- [x] `components/shell/` restantes — varredura de style multilinha: só `var(--ck-*)`, `currentColor` (tropa.tsx:55, herda do pai — correto), `transparent`. LIMPO.
- [x] `app/` restantes (gramatica, voz, not-found, agente/[slug]) — style multilinha conferido: LIMPO.
- [x] `components/feed/` (dir novo do Daniel, em construção) — zero cor declarada fora de token. LIMPO.
- [x] nomes de cor CSS em strings ('white', 'black', 'red', ...) — zero.
- [x] `app/spike/sem-lib/` — varredura mecânica limpa (auto-auditoria, ceticismo aplicado: conferi os style multilinha um a um).

Parte 2 (cauda longa da matriz):
- [ ] ler `docs/cockpit-v2-matriz-renderers.md` inteiro
- [ ] cruzar famílias previstas × renderers/testes existentes

## Parte 1 — cor fora do tema

### Achados confirmados

**A1. `app/layout.tsx:13` — `themeColor: '#191919'` (hex cru)**

Único hex literal fora do `globals.css` em toda a árvore (varredura de
`#[0-9a-fA-F]{3,8}` em .tsx/.ts/.css). O valor bate byte a byte com o
`--ck-surface-canvas` (`oklch(0.215 0 0)` = `#191919`).

Nuance: `themeColor` é o meta `theme-color` do navegador (barra de status do
Android/Safari) — é export de metadata do Next, **não aceita `var(--ck-*)`**, o
navegador lê antes do CSS. Não existe token para apontar; o problema é a
DUPLICAÇÃO silenciosa: se a §A mexer no canvas, esta linha fica velha sem
ninguém notar. Classifico como **achado estrutural, não violação de estilo** —
a correção possível é um comentário apontando pro token, não uma troca de valor.

**A2. `components/ui/badge.tsx` — LIMPO (registrando porque era o suspeito nº 1)**

O comentário do próprio arquivo (linhas 7–14) documenta a poda de 30/07: os
variants do template shadcn que carregavam `text-white` literal e tokens
inexistentes (primary, destructive, accent, ring) foram removidos. Resta só o
`ghost` sem cor. Confirmado: nenhuma cor no arquivo.

### Varreduras que voltaram LIMPAS (registrado pra ninguém refazer)

- rgb(), rgba(), oklch(), hsl(), oklab(), lab(), lch() fora do `globals.css`: **zero ocorrências**.
- Classes de cor fixa do Tailwind (`bg|text|border|ring|outline|fill|stroke|from|to|via|shadow|decoration|caret|accent|divide|placeholder` + cor nomeada): **zero ocorrências em código** (único hit foi o comentário histórico do badge.tsx).
- Valores arbitrários de cor (`bg-[#...]`, `text-[oklch...]`): **zero**. Os únicos `-[` encontrados são tamanho (`text-[13px]`, `leading-[1.55]`, `ring-[3px]`), não cor.
- fill/stroke de SVG: só `fill="none"` (linha-execucao.tsx:100, icones.tsx:26) e `currentColor`. Limpo.
- `color-mix` fora do globals.css: **zero**.
- boxShadow/drop-shadow/textShadow sem token: **zero**.
- `style` inline: TODOS usam `var(--ck-*)` — conferidos app/page.tsx, app/spike/page.tsx, app/envio/page.tsx, app/agente/[slug]/page.tsx, linha-execucao.tsx. Limpo.

### Suspeitas em aberto (a verificar)

- `linha-execucao.tsx:64` — `const COR: Record<Desfecho, string>` — grep não mostrou os valores. Se forem `var(--ck-*)`, limpo.
- `retrato.tsx:82` — `background: marca.cor` — a cor chega de fora (quem monta `marca`). Verificar o emissor em `tropa.tsx`.

## Parte 2 — cauda longa da matriz de renderers

(pendente)
