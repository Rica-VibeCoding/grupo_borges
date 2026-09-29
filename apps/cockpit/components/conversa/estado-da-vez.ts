import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { MotivoDeErro } from '@/lib/conversa/tipos';

import type { Cena } from './moldura-estado.ts';

/**
 * O estado da tela tem que ser a verdade (adendo do Rica, 28/09): "falando" aparecia enquanto
 * o agente ainda pensava ou trabalhava — a máquina entra em `falando` com o primeiro texto e
 * fica lá até a voz acabar. A tela separa três coisas — PURO:
 *
 * - pensando (`esperandoZe`): esperando a resposta, sem ferramenta;
 * - trabalhando: o agente está usando ferramenta (o que o feed mostra como tool use);
 * - falando: só enquanto um áudio toca. Entre frases sem som, não é "falando".
 */

/** O agente está usando ferramenta agora? Lido do fim do log, pela última coisa que ele fez. */
export function ferramentaEmCurso(mensagens: readonly MessagePayload[]): boolean {
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const item = mensagens[i];
    if (item.is_sidechain) continue;
    const conteudo = item.message?.content;
    if (item.message?.role === 'assistant') {
      if (!Array.isArray(conteudo)) return false;
      for (let j = conteudo.length - 1; j >= 0; j -= 1) {
        const parte = conteudo[j];
        if (parte?.type === 'tool_use') return true;
        if (parte?.type === 'text' && parte.text.trim()) return false;
      }
      continue; // só raciocínio: quem decide é a linha anterior
    }
    if (Array.isArray(conteudo) && conteudo.some((parte) => parte?.type === 'tool_result')) return true;
    if (item.message?.role === 'user') return false; // pedido novo
  }
  return false;
}

export type EntradaDaCena = {
  /** A cena da conversa (a máquina, e `preparando` do detector). */
  cena: Cena;
  /** Um áudio da resposta está tocando agora (`use-fila-de-voz`). */
  tocando: boolean;
  ferramenta: boolean;
  /** Por que a conversa parou, quando parou (`conversa.motivo`). */
  motivo?: MotivoDeErro;
};

/**
 * A cena que o visual e a palavra do estado mostram. Fora do turno dele, é a da conversa — menos o
 * agente ocupado: é erro para a máquina (toque tenta de novo), mas não quebrou nada, e a tela desenha
 * `ocupado`, na cor própria, em vez do vermelho da falha.
 */
export function cenaVisivel({ cena, tocando, ferramenta, motivo }: EntradaDaCena): Cena {
  if (cena === 'erro') return motivo === 'agenteOcupado' ? 'ocupado' : 'erro';
  if (cena !== 'esperandoZe' && cena !== 'falando') return cena;
  if (tocando) return 'falando';
  return ferramenta ? 'trabalhando' : 'esperandoZe';
}
