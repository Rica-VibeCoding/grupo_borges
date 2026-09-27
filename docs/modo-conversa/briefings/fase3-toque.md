# Fase 3 — um toque inicia, um toque para (cadeira `ui`)

Pedido do Rica, 27/09: "1 toque inicia; 1 toque, se já iniciado, para. Mas tem que ser completo, entender
as nuances da conversa." Base: `docs/modo-conversa/pesquisa-toque.md` (Canário, com arquivo:linha). Leia
antes, e a máquina em `lib/conversa/`.

## Decisão (não reabrir)
A palavra dele é **para**. Em todo estado ativo, o toque encerra a conversa; não existe "calar e seguir
ouvindo" pelo toque (isso já é a fala por cima, com fone). Para calar o Zé e falar: toque (para) e toque
(começa de novo). Diferente da recomendação do Canário em `falando`, de propósito.

## O que fazer
1. **A tela inteira é o botão**, menos o cabeçalho (Voltar e configuração) e a folha aberta. Um elemento
   `button` de verdade (teclado e leitor de tela), com rótulo acessível de Começar/Encerrar/Tentar de novo,
   sem texto visível. `touch-action: manipulation` (sem zoom de toque duplo). O botão visível do rodapé sai;
   a linha de aviso que pede ação continua.
2. **Por estado:**
   - parado → começa, no mesmo tick do gesto (áudio, microfone, Wake Lock). Detector preparando → o toque
     não faz nada, e o visual deixa claro que ainda prepara.
   - ouvindo / transcrevendo / interrompendo → para (fala em curso e resultado em voo descartados, como já é).
   - esperandoZe / falando → para **e freia o turno no servidor**: `POST /api/agents/{slug}/interromper`
     (já existe, `apps/api/routers/agents.py:4136`, cliente em `packages/cockpit-core/src/api.ts:504`),
     só quando o agente estiver rodando. Sem isso a resposta aparece no chat de texto minutos depois (R6).
     Garanta que texto que ainda chegar do turno freado não traga a voz de volta (`zeDescartado`,
     `maquina.ts:167-186` e `:242-248`).
   - erro → tenta de novo.
3. **Toque acidental:** ignore um segundo toque até ~400 ms depois do anterior (toque duplo não liga e
   desliga). Nada de segurar-para-confirmar.
4. **Retorno sem texto:** som curto distinto para começar e para parar (o `AudioContext` já destravado),
   e a mudança do visual. Vibração só como bônus com detecção (`navigator.vibrate`); não existe no iPhone.
5. **Envio logo depois do freio** (ver §3 da pesquisa, emenda do Canário): o `/input` não recusa por
   ocupação, o Claude Code enfileira; o 409 real é `agent_pane_unavailable`, que quer dizer "entrega não
   provada", e quase sempre entrou. Se ele recomeçar e falar logo depois de parar, a fala não pode virar
   alarme falso nem ser reenviada em dobro: reuse `apps/cockpit/lib/recusa-transitoria.ts` e o que
   `lib/usa-envio.ts` já faz com `safe_to_resend`.

## Limites
Só `apps/cockpit/components/conversa/`, `lib/conversa/` se precisar (com teste), tokens em `globals.css`.
Não mexer em `apps/api`. ≤300 linhas por arquivo. Context7 antes de codar o que for de React/Next.

## Fecha quando
Testes novos da regra "estado → o que o toque faz" (puros), `npm test` e `type-check` verdes, E2E em Fio e
Matéria com o `canarinho` cobrindo: começar pelo toque, parar ouvindo, parar esperando o Zé (confere que o
turno foi freado: a resposta não chega depois) e parar com ele falando (a voz não volta). Sem commit.
Relato curto em `relatos/fase3-ui.md`. Última linha: `FIM-DO-TOQUE`.
