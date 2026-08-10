// A CORRIDA EM VOO — o que liga e desliga o "Pensando" no pé do feed.
//
// Mora fora do `canario-stream-controller.ts` porque não é transporte: é a
// leitura semântica do log, e o `node --test` a prova sem EventSource nenhum.
//
// A RÉGUA ANTIGA eram duas linhas — toda mensagem `role: user` ligava, só um
// assistente com `end_turn` desligava — e mentia por três motivos que a
// varredura de 126 mil mensagens dos JSONL da frota (10/08) mediu:
//
//  - **1.627 comandos locais** (`/clear`, `/compact`, `/model`) e **2.690
//    system-reminders** entram no log como `role: user` sem que nada tenha
//    sido pedido ao modelo. Ligavam o "Pensando", e como comando local NÃO
//    gera resposta, nenhum `end_turn` vinha desligar: a linha ficava de pé até
//    o próximo turno de verdade terminar. É o que o Rica via depois do
//    `/clear`.
//  - **99 interrupções** (`[Request interrupted by user]`, o ESC) ligavam pelo
//    mesmo caminho, e ali o turno tinha acabado de ser abortado.
//  - `stop_reason` diferente de `end_turn` era tratado como "ainda rodando" —
//    o que é verdade para `tool_use` e para o nulo do streaming, mas não para
//    `stop_sequence` (72 casos) nem para os cortes por teto de saída.
//
// A régua nova tem TRÊS respostas, não duas: em voo, acabou, e **não falo
// sobre isso**. O terceiro estado é o conserto — mensagem que não é turno não
// mexe no estado em nenhuma direção.
//
// O que a régua NÃO cobre, de propósito: turno que morre sem despedida (limite
// de uso, agente desligado, sessão morta). Não existe evento a ler — o log
// simplesmente para. Quem cuida daquele é o prazo de validade da linha viva,
// em `components/feed/linha-viva.ts`.

import { classifyMessage } from '@grupo_borges/cockpit-core/chat-payload-classifier';
import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

// `[Request interrupted by user]` e a variante `... for tool use`. Âncora no
// começo pela mesma razão das regex do classificador: quem CITA a frase no meio
// de um texto (este arquivo, por exemplo) não é uma interrupção.
const INTERRUPCAO_RE = /^\s*\[Request interrupted by user/;

function textoDe(content: string | ContentPart[] | null | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let texto = '';
  for (const parte of content) {
    if (parte?.type === 'text' && typeof parte.text === 'string') texto += parte.text;
  }
  return texto;
}

function temResultadoDeFerramenta(content: string | ContentPart[] | null | undefined): boolean {
  return Array.isArray(content) && content.some((parte) => parte?.type === 'tool_result');
}

/** O que UMA mensagem diz sobre a corrida: `true` em voo, `false` acabou,
 *  `null` não fala sobre isso — e `null` preserva o estado anterior. */
export function efeitoNaCorrida(payload: MessagePayload): boolean | null {
  const message = payload.message;
  if (!message) return null;

  // Sidechain é a conversa do SUBAGENTE. O `end_turn` dele encerra o trabalho
  // dele, não o do agente que o chamou — sem esta guarda, a linha viva do
  // principal apagava toda vez que um subagente entregasse.
  if (payload.is_sidechain) return null;

  if (message.role === 'assistant') {
    const stop = message.stop_reason;
    // Em voo é o `tool_use` e o nulo do streaming; QUALQUER outro motivo de
    // parada é fim de turno, inclusive os que ainda não estão no tipo.
    return stop == null || stop === 'tool_use';
  }

  if (message.role !== 'user') return null;

  // 82% do log é ferramenta, e resultado casado é a prova mais barata de que o
  // agente está no meio do trabalho — antes de qualquer regex.
  if (temResultadoDeFerramenta(message.content)) return true;

  if (INTERRUPCAO_RE.test(textoDe(message.content))) return false;

  // O resto da régua já existe e é testada: o classificador do feed sabe o que
  // é ruído (`suppress`), comando local (`slash`) e resumo de compact. Reusar
  // aqui é o que impede a segunda cópia das regex divergir da primeira.
  const { kind } = classifyMessage(payload);
  if (kind === 'suppress' || kind === 'slash' || kind === 'compact-summary') return null;

  return true;
}

/** O estado da corrida depois de aplicar um lote do stream, em ordem. */
export function corridaEmVoo(
  anterior: boolean,
  lote: readonly MessagePayload[],
): boolean {
  let emVoo = anterior;
  for (const payload of lote) {
    const efeito = efeitoNaCorrida(payload);
    if (efeito !== null) emVoo = efeito;
  }
  return emVoo;
}
