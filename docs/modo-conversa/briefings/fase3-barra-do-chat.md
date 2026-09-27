# Fase 3 — barra do chat enxuta (cadeira `ui`)

Pedido do Rica, 27/09, pelo Telegram, sobre o chat do agente (`app/agente/[slug]/`):
"retirar ícone de microfone · arrumar o componente que carrega a foto do agente (está desenquadrado) · mover
tela com o dedo para esquerda abre a conversa com o agente (o mesmo que clicar no microfone) · retirar ícone que
abre o painel (clicar na imagem do agente já abre o painel)".

## O que muda
1. **Microfone sai da barra** (`components/shell/barra-de-telas.tsx`, o `<Link>` para `/conversa/{slug}`). Para
   leitor de tela e teclado o link continua existindo, visualmente oculto (mesma regra de `fase3-gestos.md` item 6).
2. **Gestos, como o Rica definiu (27/09, segunda mensagem — vale esta, não a primeira leitura):**
   - **No chat:** arrastar para a **esquerda** abre a voz (`/conversa/{slug}`); arrastar para a **direita** abre a
     sidebar (a gaveta da tropa, o mesmo destino do `≡`, pelo mesmo caminho otimista do `BotaoNav` — sem `<Link>`
     seco nem estado novo).
   - **Na voz:** arrastar para a **direita** volta ao chat (hoje é a esquerda — troca). Arrastar para cima continua
     abrindo as configurações.
   - Limiar, bordas, origem (composer, gaveta, rolagem de lado, seleção) ficam como estão, em
     `components/conversa/gesto-de-arrasto.ts`, `arrasto-do-chat.tsx` e o arrasto da tela da conversa. Com a gaveta
     aberta, gesto nenhum dispara. Comentários que descrevem a direção antiga se atualizam.
3. **⧉ do painel sai** (`BotaoPainel` na coluna da direita da barra). A cápsula do agente já abre o mesmo painel.
   Antes de tirar, provar que o painel aberto FECHA sem ele (toque fora, botão da própria gaveta) no celular e no
   desktop. Se não fecha, pare e relate — não invente fechamento novo. O grid de 3 colunas tem de manter a pill
   no centro; órfãos (import, props `hrefFecharPainel`/`painelAberto` se ficarem sem uso) saem junto.
4. **Retrato desenquadrado na cápsula** (`capsula-do-agente.tsx`, `retrato.tsx`, `pastilha-do-chrome.ts`).
   Capture a barra em 390×844 (iPhone) e em desktop, diga o que está fora (corte do rosto, círculo achatado,
   descentrado na pastilha) e conserte na causa. Mostre antes/depois em captura.

## Limites e fecho
Só `components/shell/` (barra, cápsula, retrato, pastilha, `superficie-otimista.tsx`), `components/conversa/`
(gesto e arrastos) e o comentário do gesto em `app/agente/[slug]/page.tsx`. Menor diff. Teste puro do gesto atualizado (as três direções acima, e a antiga não dispara mais), `npm test` e
`type-check` verdes no PC, capturas antes/depois das 4 mudanças, relato em `relatos/fase3-ui.md`. Nada em sessão
viva, sem build da 3008, sem commit. Última linha: `FIM-DA-BARRA`.
