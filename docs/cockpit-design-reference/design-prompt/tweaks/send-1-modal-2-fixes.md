# Send 1 — Cockpit · Agent Modal v1.html (2 fixes consolidados)

> **Onde colar:** projeto Designer (`https://claude.ai/design/p/019e1329-d50a-7583-a0d3-3b5bbefdc096`) → sessão de chat #4 (a do modal) → composer principal.
>
> **Custo:** 1 Send (queima 1 prompt do orçamento Pro semanal · 4-7min de geração).
>
> **Por quê Send e não Tweaks:** rodada de Tweaks no modal não pegou os 2 fixes — vão pro Send consolidado conforme `feedback_fix_consolidado_designer.md`. Kanban resolveu 5/5 via Tweaks; modal precisa de Send pelo padrão de mudança (CSS pseudo-element + substituição em 2 pontos do mesmo arquivo).

---

```
Aplique estes 2 ajustes pontuais ao arquivo `Cockpit · Agent Modal v1.html`. **Importante: não alterar nada além dos pontos listados.** Toda a estrutura existente — 4 abas (Missão · Skills · Docs · Tabelas), paleta Hermes, tipografia, comportamento de dialog (focus trap, keyboard nav, ARIA), augmented-ui, microcopy técnico, mini-cockpit context atrás do backdrop, footer com keyhints — deve permanecer idêntica.

1. **Close button `✕ ESC` empilhado.** Hoje o botão de fechar tem o `✕` grande e abaixo dele aparece um "ESC" pequenininho via pseudo-element CSS `::after { content:"ESC"; bottom:6px; right:8px; position:absolute }`. Esse empilhado parece glitch ou label colado. Remover o pseudo-element completamente — deixar o botão SÓ com o `✕`. O footer do modal já tem o keyhint `[ESC] close` na barra inferior, então a redundância no botão pode sair sem perda de affordance.

2. **Separador francês `1 143` → `1.143` (formato pt-BR).** Em 2 lugares específicos do código:
   - Linha do panel-eyebrow: `scope: 4 tables · 1 143 rows` → `scope: 4 tables · 1.143 rows`
   - Item da aba Tabelas (`TOTAL ROWS`): `<span class="v cy">1 143</span>` → `<span class="v cy">1.143</span>`

   Trocar o separador de espaço por ponto. Resultado: `1.143 rows` e `1.143`.

Devolva o arquivo `Cockpit · Agent Modal v1.html` atualizado com SOMENTE essas 2 mudanças aplicadas. Sem repaginar, sem mudar dimensões, sem revisitar paleta ou comportamento.
```
