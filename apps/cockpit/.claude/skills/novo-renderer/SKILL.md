---
name: novo-renderer
description: Adicionar ou corrigir o desenho de uma família de payload (tool, tool_use_result, bloco) no feed do chat. É o trabalho mais repetido do projeto — 23 tools e 24 formas de resultado.
---

# novo-renderer — desenhar uma família de payload

## Por que esta skill existe

É a **cauda longa** do projeto: 23 tools, 24 formas de `tool_use_result`. E o modo
de falha é traiçoeiro — renderer errado **não dá erro**, dá tela torta que ninguém
nota até o Rica notar.

## Regra de ouro

**Nunca escreva renderer contra payload imaginado.** Existem 52 famílias reais
gravadas em `../../fixtures/cockpit-v2/familias/`. Se a sua não está lá, ela é
gravada primeiro.

## Passos

### 1. Achar a família

```bash
ls ../../fixtures/cockpit-v2/familias/ | grep -i <tool-ou-chave>
```

Nomes: `tool__<Nome>.json`, `result__<chaves-ordenadas>.json`, `bloco__<tipo>.json`,
`borda__<caso>.json`.

### 2. Ver o quanto ela pesa

```bash
python3 -c "
import json; d=json.load(open('../../fixtures/cockpit-v2/familias/_indice.json'))
print(sorted(d['ocorrencias'].items(), key=lambda x: -x[1])[:15])
"
```

Constrói na ordem da frequência. `bloco__tool_result` aparece 1.499 vezes;
uma família de MCP raro aparece uma. O esforço segue o número.

### 3. Ver como o payload vira item

O desenho não parte do JSON cru: parte do `RenderItem` que
`buildRenderItems` produz. Uma execução chega como `assistant` com parts
`tool_use` (a maioria) ou como `chip` de tool (só quando o resultado passa de 300
caracteres). As duas viram `EntradaDaExecucao` em
`components/feed/execucao-do-item.ts` e são desenhadas pela `LinhaExecucao`; o
`tool_use_result` cru vem em `entrada.rich`. Contrato completo em
`../../docs/cockpit-v2-data-contract.md` §2.

Agrupamento errado é em `components/feed/grupo-ferramentas.ts` e
`lib/spike/render-items-incremental.ts`. Chip errado (corte de 300, Skill,
supressão) é no **classificador**
(`packages/cockpit-core/src/chat-payload-classifier.ts`), não no seu componente —
e mexer lá pausa as outras frentes: fale comigo (Pavan) antes.

### 4. Escrever em `components/renderers/`

Um par por **corpo**, não por família — várias famílias caem no mesmo corpo (o
shell cobre cinco):

- `<corpo>.ts` com `normalizar<Algo>(rich)`, que devolve `null` fora da família,
  testado contra a fixture real (`<corpo>.test.ts`);
- `<corpo>.tsx`, o desenho.

Registrar em `familiaDoRich` (`components/feed/execucao-do-item.ts`) e no
`corpoRico` de `components/feed/execucao.tsx`. Sem cor: só tokens `--ck-*`. Teto
de 300 linhas.

### 5. As duas bordas, sempre

Todo renderer tem de sobreviver a:

- `borda__content_none` — **199 casos** de `message: null` (o evento some do feed, sem erro)
- `borda__content_string` — **87 casos** de `content` como string, não array

Não são hipóteses; apareceram no baseline sem ninguém procurar.

### 6. Provar

```bash
pnpm --filter @grupo_borges/cockpit-core test   # o pipeline puro
pnpm --filter @grupo_borges/cockpit test        # os normalizadores dos corpos
pnpm --filter @grupo_borges/cockpit type-check
```

No notebook é `pnpm` direto; na VPS `borges`, `corepack pnpm …`.

E olhar na tela, com a família real carregada. Tipo limpo não prova desenho certo.
