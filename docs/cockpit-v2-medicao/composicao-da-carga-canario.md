# Do que a carga do canário é feita — leia ANTES de caçar custo de render

> Registrado em 30/07 por ordem do Pavan. Motivo declarado: "é o tipo de coisa
> que o próximo esquece e refaz". Eu ia gastar a rodada perfilando o markdown.

## O número que muda o alvo

Contagem sobre `task_events` do agente `canario` (o mesmo banco que a bancada
mede), somando as partes de cada mensagem:

- **`text`** — 535 partes, **11.880 caracteres no total** (média de ~22 por parte)
- **`thinking`** — 76 partes, **503.272 caracteres no total** (média de ~6.622 por parte)
- **`tool_use`** — 126 partes
- **`tool_result`** — 241 partes
- papéis: 737 `assistant`, 246 `user`

## O que isso decide

**O markdown não é o suspeito.** `AssistantMarkdown` (react-markdown +
remark-gfm) é o renderer mais caro por caractere do feed, e a intuição manda
começar por ele — mas ele processa **11.880 caracteres na carga inteira**. Não
há uma hora de perfilamento que valha isso.

**O raciocínio é 42× o volume do texto.** Se sobrar custo de render depois de
descartadas as causas estruturais, o lugar de olhar é **`Thinking`**
(`components/renderers/thinking.tsx`), não o markdown. Dois detalhes que
importam quando essa hora chegar:

1. `buildThinkingRenderModel(content)` roda a **cada render**, e é ele que
   percorre o texto para contar linhas — sobre blocos de ~6,6 mil caracteres.
2. O corpo só monta `AssistantMarkdown` quando `open` é verdadeiro, e `open`
   nasce de `initiallyExpanded`. Se essa bandeira vier ligada, cada bloco de
   raciocínio arrasta o parser de markdown com 6,6 mil caracteres **de
   primeira** — e aí o markdown volta a importar, mas por causa do `Thinking`,
   não por causa do texto do assistente.

## A ressalva de sempre

Isto descreve a **fixture**, não a produção. A tese do cockpit v2 (82% de
`tool_use`) é sobre o tráfego real do Rica; a carga do canário é um gerador
sintético e a distribuição dela é outra. Para explicar um número que ESTA
bancada produziu, vale a composição acima. Para decidir o que otimizar em
produção, não — aí a régua é o tráfego real.

## Como recontar

```python
import sqlite3, json, collections
c = sqlite3.connect('file:apps/api/db/grupo_borges.db?mode=ro', uri=True)
tipos, tam = collections.Counter(), collections.Counter()
for (raw,) in c.execute("SELECT payload FROM task_events WHERE agent_slug='canario'"):
    partes = (json.loads(raw).get('message') or {}).get('content')
    if not isinstance(partes, list):
        continue
    for parte in partes:
        if not isinstance(parte, dict):
            continue
        tipos[parte.get('type')] += 1
        for campo in ('text', 'thinking'):
            if parte.get('type') == campo:
                tam[f'{campo}_chars'] += len(parte.get(campo) or '')
print(dict(tipos), dict(tam))
```

Somente leitura (`mode=ro`), e não interfere numa medição em curso.
