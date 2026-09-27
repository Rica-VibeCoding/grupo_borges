import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { efeitoNaCorrida } from '../../lib/spike/corrida-em-voo.ts';

export type TextoDoZe = { id: number; texto: string };

export function maiorIdDasMensagens(
  mensagens: readonly MessagePayload[],
  piso = 0,
): number {
  let maior = piso;
  for (const mensagem of mensagens) maior = Math.max(maior, mensagem.id);
  return maior;
}

function textosDe(item: MessagePayload): string[] {
  if (item.kind !== 'assistant' || item.message?.role !== 'assistant') return [];
  const conteudo = item.message.content;
  if (typeof conteudo === 'string') {
    const texto = conteudo.trim();
    return texto ? [texto] : [];
  }
  const textos: string[] = [];
  for (const parte of conteudo) {
    if (parte.type !== 'text') continue;
    const texto = parte.text.trim();
    if (texto) textos.push(texto);
  }
  return textos;
}

export function textosDoZeDepoisDe(
  mensagens: readonly MessagePayload[],
  depoisDe: number,
): TextoDoZe[] {
  const textos: TextoDoZe[] = [];
  for (const item of mensagens) {
    if (item.id <= depoisDe) continue;
    for (const texto of textosDe(item)) textos.push({ id: item.id, texto });
  }
  return textos;
}

export type PassoDoZe =
  | { tipo: 'abre' }
  | { tipo: 'respondeu' } // o assistente escreveu no turno (texto, ferramenta ou raciocínio)
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fecha' };

/**
 * As mensagens novas lidas NA ORDEM: o turno abre, o Zé responde, cada texto, o turno
 * fecha. Em ordem porque dois turnos cabem no mesmo lote — o fim de um turno descartado
 * e a mensagem que esperava na fila do Claude Code chegam colados.
 *
 * O fim não fecha na hora: o Claude Code grava uma resposta em várias linhas, todas com
 * o `stop_reason` final — a primeira pode vir vazia e o texto na seguinte. O turno fecha
 * quando começa outro pedido ou no fim do lote. `rodava` é o estado antes do lote;
 * `rodando`, o `isRunning` do stream depois dele, que vence quando diverge (mensagens
 * puladas numa reconexão).
 */
export function passosDoZeDepoisDe(
  mensagens: readonly MessagePayload[],
  depoisDe: number,
  rodava: boolean,
  rodando: boolean,
): PassoDoZe[] {
  const passos: PassoDoZe[] = [];
  let emVoo = rodava;
  let acabou = false;
  let respondeu = false;
  const fecha = () => {
    passos.push({ tipo: 'fecha' });
    emVoo = false;
    acabou = false;
  };
  for (const item of mensagens) {
    if (item.id <= depoisDe) continue;
    const efeito = efeitoNaCorrida(item);
    const textos = textosDe(item);
    const doZe = item.message?.role === 'assistant' && !item.is_sidechain;
    // Pedido novo (ou resultado de ferramenta): o turno que tinha acabado fecha agora.
    if (!doZe && efeito === true && acabou) fecha();
    if (!emVoo && (efeito === true || textos.length > 0)) {
      passos.push({ tipo: 'abre' });
      emVoo = true;
      respondeu = false;
    }
    if (emVoo && doZe && !respondeu) {
      passos.push({ tipo: 'respondeu' });
      respondeu = true;
    }
    for (const texto of textos) passos.push({ tipo: 'texto', texto });
    if (emVoo && efeito !== null) acabou = efeito === false;
  }
  if (acabou || (emVoo && !rodando)) fecha();
  if (!emVoo && rodando) passos.push({ tipo: 'abre' });
  return passos;
}
