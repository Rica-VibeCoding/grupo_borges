# Tweak 2 — Cockpit · Agent Modal v1.html (2 fixes)

> **Onde colar:** projeto Designer `https://claude.ai/design/p/019e1329-d50a-7583-a0d3-3b5bbefdc096` → abrir arquivo `Cockpit · Agent Modal v1.html` → modo **Tweaks** (pílula no canto inferior do canvas) → colar o bloco abaixo.
>
> **Custo:** free (Tweaks não queima Send).
>
> **Risco:** baixo. Os 2 fixes são pontuais (substituição literal + reposicionamento CSS isolado). Tweaks deve resolver os dois numa passada.

---

```
Aplique estes 2 ajustes pontuais SEM alterar nada além dos pontos listados.

1. **Close button `✕ ESC` empilhado** — hoje "ESC" aparece pequenininho abaixo do `✕`, parece glitch ou label colado. Mover ESC pra um chip `[ESC]` separado à esquerda do `✕` (com hairline própria, mesma altura do `✕`), OU remover o "ESC" do botão e deixar só o `✕` (o footer do modal já tem o keyhint `[ESC] CLOSE`, então a redundância pode ser removida). Sua decisão entre as duas opções — mas o empilhado não pode permanecer.

2. **Separador francês `1 143` → `1.143` (formato pt-BR)** — em 2 lugares: `1 143 rows` no panel-eyebrow do modal e `1 143` no summary da aba Tabelas. Trocar o separador de espaço por ponto. Resultado: `1.143 rows` e `1.143`.
```
