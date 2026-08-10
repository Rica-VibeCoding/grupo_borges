// A régua de EXIBIÇÃO da linha viva ("Pensando há 12 s"), do lado de quem
// monta a conversa. A linha em si — quando ela vence, o que o tempo diz — mora
// em `components/feed/linha-viva.ts`, território do Hiro; aqui fica só a
// decisão de mostrar, que é do `feed-da-conversa.tsx`.
//
// Mora fora do `.tsx` pelo motivo de sempre nesta casa: o `node --test` prova a
// régua sem transpilar JSX.
//
// O QUE A FROTA ACRESCENTA — 10/08. O `isRunning` se lê do JSONL, e o JSONL não
// conta o turno que morre sem despedida: o Rica clicava em **Desligar** e o
// "Pensando" continuava de pé, contando sozinho, até os 5 minutos de
// `VALIDADE_LINHA_VIVA_MS`. A frota sabe do desligamento em segundos (poll de
// 5 s + SSE, cruzando tmux, processo e hook do CC), e é ela que corta a espera.
//
// A frota só DESLIGA, nunca liga — e isso é assimetria de propósito, não
// esquecimento. O `lifecycle_status` tem 300 s de frescor (`derive_agent_status`
// em `apps/api/db/store.py`): "ocioso" ali pode ser um agente que começou a
// trabalhar há dois segundos. Deixar esse valor ACENDER a linha trocaria a
// mentira que estamos consertando por outra; deixar que ele APAGUE só antecipa
// um fim que o prazo daria de qualquer jeito.

import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

export type EntradaDaLinhaViva = {
  /** `isRunning` do stream: o log diz que a corrida está de pé. */
  correndo: boolean;
  /** O prazo de `VALIDADE_LINHA_VIVA_MS` estourou. */
  vencida: boolean;
  /** O último item do feed já está no gerúndio — repetir seria dizer duas vezes. */
  trabalhoEmVooNoFim: boolean;
  /** De onde contar o tempo (`desdeDaLinhaViva`). `null` = feed sem mensagem. */
  desdeMs: number | null;
  /** O que a frota viva diz deste agente. `null` = fora dela. */
  statusDaFrota: AgentStatus | null;
};

/** A âncora de tempo quando a linha viva deve aparecer, `null` quando não deve.
 *  Devolve a âncora em vez de um booleano de propósito: quem chama monta o item
 *  do feed com ela, e sem `!` — sem âncora não existe linha. */
export function ancoraDaLinhaViva(entrada: EntradaDaLinhaViva): number | null {
  if (!entrada.correndo || entrada.vencida || entrada.trabalhoEmVooNoFim) return null;
  if (entrada.statusDaFrota === 'offline') return null;
  return entrada.desdeMs;
}
