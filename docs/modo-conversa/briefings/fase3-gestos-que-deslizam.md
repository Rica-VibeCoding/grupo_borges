# Fase 3 — gestos que deslizam (cadeira `ui`, depois da barra do chat)

Teste do Rica no iPhone, 27/09, com `e4488f1` publicado: "achei o movimento horrível, parece que ele tá duro,
parece que ele salta da tela, não tem um movimento deslizante". E: "só a gaveta que abre de baixo para cima parece
que abre certo, deslizando, bonita". Decisão dele (D1 sim): **dar o mesmo tratamento aos três gestos, igual à folha.**

## Causa (já sabida)
`arrasto-do-chat.tsx` e o arrasto da conversa só decidem no `touchend` e aí trocam de rota/abrem a gaveta de uma
vez. Nada acompanha o dedo durante o arrasto. A folha de configurações é a referência de sensação: leia como ela
se move e reproduza o mesmo tempo e a mesma curva.

## O que muda
Os três gestos passam a **seguir o dedo** e **assentar com mola** ao soltar:
1. **Chat ⬅️ voz:** a tela do chat anda com o dedo para a esquerda, a da voz entra pela direita.
2. **Chat ➡️ tropa:** a gaveta da tropa sai da esquerda acompanhando o dedo (é a mesma gaveta do `≡`, mesmo estado
   otimista; nada de estado paralelo).
3. **Voz ➡️ chat:** a tela da voz anda para a direita, o chat entra pela esquerda. Sair continua encerrando a
   conversa como o parar (freio incluso).
- Soltou antes da metade (ou sem velocidade de arremesso) → volta ao lugar com mola. Passou da metade, ou arremesso
  rápido → assenta no destino. Arrasto e mola a 60 fps no iPhone: só `transform`/`opacity`, nada de layout.
- Troca de rota sem piscar branco nem tela vazia no meio: pré-carregue o destino (`router.prefetch`) e escolha o
  caminho — View Transitions do Next 16, camada com o destino por baixo, ou outro — **com Context7 antes**
  (Next 16 / React 19). Justifique a escolha no relato.
- O que já vale segue valendo: limiar para decidir que é gesto horizontal, bordas do Safari, origem (composer,
  gaveta, rolagem de lado, seleção), rolagem vertical do chat intacta, arrasto não vira toque na voz, gaveta aberta
  bloqueia gesto, `prefers-reduced-motion` sem animação.

## Defeito relatado junto (Rica, 27/09, no iPhone)
"Quando eu tô no chat e arrasto para a direita, não me parece que tá abrindo a sidebar." No E2E passou; no iPhone
não. Ache a causa antes de refazer o gesto (hipóteses a eliminar: arrasto começado dentro de `LIMIAR.borda` — o
dedo natural para a direita nasce perto da borda esquerda —, o voltar do Safari tomando o gesto, `usaNavegacaoDaTropa`
nulo nessa árvore, gaveta sem animar). Prove com o toque simulado em WebKit, não só Chromium.

## Limites e fecho
`components/conversa/` (gesto, arrastos, tela da conversa), `components/shell/` só o que a gaveta da tropa pedir, e
o mínimo em `app/agente/[slug]/` e `app/conversa/`. Menor diff. Teste puro da decisão (metade, velocidade, volta),
`npm test` e `type-check` verdes no PC, E2E com toque simulado dos três gestos (indo e voltando com mola) no
tamanho do iPhone — **sem vídeo nem captura para o Rica** (ordem dele, 27/09: ele testa direto na UI). Ao fechar,
deixe o `next dev` do PC no ar na 3009 e diga a porta no PRONTO: a coordenação expõe para o iPhone. Relato em `relatos/fase3-ui.md`. Nada em sessão viva, sem build da 3008, sem commit.
Última linha: `FIM-DO-DESLIZE`.
