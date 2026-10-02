/**
 * A TROCA DE CONVERSA NO CHAT — sem React, sem rede (F13 das conversas).
 *
 * Quando o Retomar ou a Nova chegam a `pronta`, o stream do chat emite
 * `conversa-trocada` e passa a servir a conversa nova. A tela recomeça o
 * stream (cursor zerado: os ids da retomada são mais velhos que os da que
 * saiu) e desenha um MARCO no ponto da troca: de qual conversa para qual, a
 * nota e o briefing de retorno.
 *
 * O marco fica guardado na aba (`sessionStorage`): recarregar a página na
 * conversa nova ainda mostra de onde ela veio. Vale só enquanto o stream
 * estiver nela — o `session_id` das mensagens é a prova.
 */
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';


export type ConversaTrocada = {
  /** A conversa que entrou. */
  sessionId: string;
  /** A que saiu, quando a API sabe. */
  de: string | null;
  deTitulo: string | null;
  motivo: 'retomar' | 'nova';
  /** Título e nota da que entrou (a Nova não tem nenhum). */
  titulo: string | null;
  nota: string | null;
  /** O que o gancho entregou na largada do Retomar, ou `null`. */
  briefing: string | null;
  /** Instante da troca, em ms do servidor — onde o marco entra no feed. */
  emMs: number | null;
};

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** O evento cru do stream → troca, ou `null` se não der para confiar nele. */
export function leConversaTrocada(cru: unknown): ConversaTrocada | null {
  if (!cru || typeof cru !== 'object') return null;
  const o = cru as Record<string, unknown>;
  const sessionId = texto(o.session_id);
  if (!sessionId || (o.motivo !== 'retomar' && o.motivo !== 'nova')) return null;
  return {
    sessionId,
    de: texto(o.de),
    deTitulo: texto(o.de_titulo),
    motivo: o.motivo,
    titulo: texto(o.titulo),
    nota: texto(o.nota),
    briefing: texto(o.briefing),
    emMs: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null,
  };
}

/** O stream está na conversa do marco? Sem mensagem ainda, a dúvida fica com
 *  o marco (conversa nova, recém-aberta). */
export function marcoValeAqui(troca: ConversaTrocada, mensagens: readonly MessagePayload[]): boolean {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const sessao = mensagens[i]?.session_id;
    if (sessao) return sessao === troca.sessionId;
  }
  return true;
}

/** Mensagem que nasceu ANTES da troca? Sem hora conhecida, conta como antes. */
export function antesDaTroca(troca: Pick<ConversaTrocada, 'emMs'>, mensagem: Pick<MessagePayload, 'timestamp'>): boolean {
  if (troca.emMs === null) return true;
  const ts = typeof mensagem.timestamp === 'string' ? Date.parse(mensagem.timestamp) : Number.NaN;
  return !Number.isFinite(ts) || ts <= troca.emMs;
}

export type TextosDoMarco = {
  cabeca: string;
  titulo: string | null;
  nota: string | null;
  saiu: string;
};

/** O que o marco diz. Sem jargão: "Histórico" é o nome que o Rica vê na gaveta. */
export function textosDoMarco(troca: ConversaTrocada): TextosDoMarco {
  const saiu = troca.deTitulo
    ? `“${troca.deTitulo}” ficou guardada no Histórico.`
    : 'A conversa anterior ficou guardada no Histórico.';
  if (troca.motivo === 'nova') return { cabeca: 'Conversa nova', titulo: null, nota: null, saiu };
  return { cabeca: 'Conversa retomada', titulo: troca.titulo ?? 'Conversa sem título', nota: troca.nota, saiu };
}

// O marco guardado na aba. Um por agente: a troca seguinte substitui.
const CHAVE = (slug: string) => `ck-conversa-trocada:${slug}`;

type Guarda = Pick<Storage, 'getItem' | 'setItem'>;

export function guardaMarco(guarda: Guarda | null, slug: string, troca: ConversaTrocada): void {
  try {
    guarda?.setItem(CHAVE(slug), JSON.stringify(troca));
  } catch {
    // Safari privado recusa escrita: o marco só não sobrevive ao recarregar.
  }
}

export function marcoGuardado(guarda: Guarda | null, slug: string): ConversaTrocada | null {
  try {
    const cru = guarda?.getItem(CHAVE(slug));
    if (!cru) return null;
    const o = JSON.parse(cru) as Partial<ConversaTrocada>;
    return leConversaTrocada({
      session_id: o.sessionId,
      de: o.de,
      de_titulo: o.deTitulo,
      motivo: o.motivo,
      titulo: o.titulo,
      nota: o.nota,
      briefing: o.briefing,
      at: o.emMs,
    });
  } catch {
    return null;
  }
}
