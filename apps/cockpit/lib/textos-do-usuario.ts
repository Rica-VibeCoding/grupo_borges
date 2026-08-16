/**
 * O que o Rica JÁ mandou, extraído do stream na forma que a reconciliação da
 * bolha otimista compara: texto e instante, na ordem em que apareceram.
 *
 * Mora fora do `.tsx` pelo motivo de sempre nesta casa — o `node --test` prova
 * a régua sem transpilar JSX.
 *
 * ## O `queued` conta, e é o ponto fino
 *
 * Quando o agente está no meio de um turno, o CLI grava a mensagem nova como
 * `queue-operation` e o back a canoniza em `kind: 'queued'`, com `message:
 * null` e o texto solto em `content` — o eco `user` de verdade só nasce quando
 * a fila drena, minutos depois. Esperar por ele deixaria a bolha otimista
 * empilhada em cima da bolha da fila: a mesma frase duas vezes na tela, uma
 * delas em cinza de "pendente" sobre algo que o CLI já aceitou. O texto
 * aparecer na fila é prova de que entrou, e é o que encerra a pendência.
 *
 * Módulo neutro: sem `'use client'`, sem React, sem DOM.
 */

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { textoEnfileirado } from '@grupo_borges/cockpit-core/render-items';
import type { MensagemReal } from './codex/eco-pendente.ts';

export function textosDoUsuario(messages: readonly MessagePayload[]): MensagemReal[] {
  const textos: MensagemReal[] = [];
  for (const m of messages) {
    const timestamp = Date.parse(m.timestamp);
    const criadoEmMs = Number.isFinite(timestamp) ? timestamp : m.created_at * 1_000;
    const daFila = textoEnfileirado(m);
    if (daFila !== null) {
      textos.push({ texto: daFila, criadoEmMs });
      continue;
    }
    if (m.kind !== 'user' || m.message?.role !== 'user') continue;
    const conteudo = m.message.content;
    if (typeof conteudo === 'string') {
      textos.push({ texto: conteudo, criadoEmMs });
      continue;
    }
    if (!Array.isArray(conteudo)) continue;
    // Bloco de texto só. `tool_result` e `image` numa mensagem de usuário não
    // são o que ele digitou, e concatená-los faria a comparação por texto
    // exato nunca casar — a pendência ficaria de pé até o teto de 3 min.
    const texto = conteudo
      .map((parte) => (parte && parte.type === 'text' ? parte.text : ''))
      .join('');
    if (texto) textos.push({ texto, criadoEmMs });
  }
  return textos;
}
