---
name: novo-renderer
description: Adicionar ou corrigir o desenho de uma família de payload (tool, tool_use_result, bloco) no feed do chat. É o trabalho mais repetido do projeto — 23 tools e 25 formas de resultado.
---

# novo-renderer — desenhar uma família de payload

## Por que esta skill existe

É a **cauda longa** do projeto: 23 tools, 25 formas de `tool_use_result`. E o modo
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
`buildRenderItems` produz. Quase toda tool vira `kind: 'chip'` — com `chip.icon`,
`chip.label`, `chip.summary`, `expandBody` e `classifierKind`. Contrato completo em
`../../docs/cockpit-v2-data-contract.md` §2.

Se o agrupamento está errado, o defeito é no **classificador**
(`packages/cockpit-core/src/chat-payload-classifier.ts`), não no seu componente —
e mexer lá pausa as outras frentes: fale comigo (Pavan) antes.

### 4. Escrever em `components/render/`

Um arquivo por família. Sem cor: só tokens `--ck-*`. Teto de 300 linhas.

### 5. As duas bordas, sempre

Todo renderer tem de sobreviver a:

- `borda__content_none` — **199 casos** de `content: null`
- `borda__content_string` — **87 casos** de `content` como string, não array

Não são hipóteses; apareceram no baseline sem ninguém procurar.

### 6. Provar

```bash
corepack pnpm --filter @grupo_borges/cockpit-core test   # o pipeline puro
corepack pnpm --filter @grupo_borges/cockpit type-check
```

E olhar na tela, com a família real carregada. Tipo limpo não prova desenho certo.
