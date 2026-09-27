# Fase 3 — barra do chat enxuta (cadeira `ui`)

Pedido do Rica, 27/09, pelo Telegram, sobre o chat do agente (`app/agente/[slug]/`):
"retirar ícone de microfone · arrumar o componente que carrega a foto do agente (está desenquadrado) · mover
tela com o dedo para esquerda abre a conversa com o agente (o mesmo que clicar no microfone) · retirar ícone que
abre o painel (clicar na imagem do agente já abre o painel)".

## O que muda
1. **Microfone sai da barra** (`components/shell/barra-de-telas.tsx`, o `<Link>` para `/conversa/{slug}`). Para
   leitor de tela e teclado o link continua existindo, visualmente oculto (mesma regra de `fase3-gestos.md` item 6).
2. **Arrastar para a ESQUERDA no chat também abre `/conversa/{slug}`.** Hoje só a direita abre (`gestoDoChat` em
   `components/conversa/gesto-de-arrasto.ts`, usado por `arrasto-do-chat.tsx`): a direita CONTINUA valendo
   (correção do Rica, 27/09), a esquerda passa a valer junto. Limiar, bordas, origem (composer, gaveta, rolagem de lado, seleção) ficam como estão. Atualizar os
   comentários que dizem só "direita".
3. **⧉ do painel sai** (`BotaoPainel` na coluna da direita da barra). A cápsula do agente já abre o mesmo painel.
   Antes de tirar, provar que o painel aberto FECHA sem ele (toque fora, botão da própria gaveta) no celular e no
   desktop. Se não fecha, pare e relate — não invente fechamento novo. O grid de 3 colunas tem de manter a pill
   no centro; órfãos (import, props `hrefFecharPainel`/`painelAberto` se ficarem sem uso) saem junto.
4. **Retrato desenquadrado na cápsula** (`capsula-do-agente.tsx`, `retrato.tsx`, `pastilha-do-chrome.ts`).
   Capture a barra em 390×844 (iPhone) e em desktop, diga o que está fora (corte do rosto, círculo achatado,
   descentrado na pastilha) e conserte na causa. Mostre antes/depois em captura.

## Limites e fecho
Só `components/shell/` (barra, cápsula, retrato, pastilha), `components/conversa/gesto-de-arrasto*` e
`arrasto-do-chat.tsx`. Menor diff. Teste puro do gesto atualizado (esquerda e direita abrem), `npm test` e
`type-check` verdes no PC, capturas antes/depois das 4 mudanças, relato em `relatos/fase3-ui.md`. Nada em sessão
viva, sem build da 3008, sem commit. Última linha: `FIM-DA-BARRA`.
