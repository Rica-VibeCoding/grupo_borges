/** Projeção do acompanhamento único nos botões do Histórico. */
import type { TrocaEmCurso } from '../../lib/troca-em-curso.ts';
import { explicaRecusa, ATUAL, type EstadoDaAcao } from './acoes-de-conversa.ts';

export function estadoDaTroca(t: TrocaEmCurso | null, nome: string): EstadoDaAcao | null {
  if (!t) return null;
  switch (t.fase) {
    case 'esperando': return { fase: 'esperando', troca: t, etapa: t.etapa, inicio: t.inicio };
    case 'conferindo': return t.conferencia?.listaConferida ? null : { fase: 'conferindo', troca: t, inicio: t.inicio, ate: t.conferencia!.ate, erro: t.conferencia!.erro };
    case 'falhou': return { fase: 'falhou', onde: t.alvo ?? ATUAL, texto: t.erro! };
    case 'recusada': return t.recusa === 'ocupado' && !t.forcar
      ? { fase: 'ocupado', troca: { ...t, forcar: true } }
      : { fase: 'falhou', onde: t.alvo ?? ATUAL, texto: explicaRecusa(t.recusa!, nome) };
    case 'concluida': return null;
  }
}
