/** Régua pura: identidade vem antes de prazo, e um fim nunca volta à espera. */
import type { OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';

export type Troca = {
  tipo: 'retomar' | 'nova';
  /** Conversa pedida no Retomar; null na Nova. */
  alvo: string | null;
  alvoTitulo?: string | null;
  forcar: boolean;
  /** Agente desligado: o Retomar sobe direto, sem estacionar. */
  desligado: boolean;
  /** A Nova se prova quando a lista sai desta conversa. */
  antes?: string | null;
};
export type EtapaEmCurso = 'estacionando' | 'religando';
export type Operacao = Omit<OperacaoDeConversa, 'id'> & { id?: string | null };
export type EventoDaTroca = { operacaoId?: string | null; sessionId: string };
export type Leitura = { tipo: 'segue'; etapa: EtapaEmCurso } | { tipo: 'pronta' } | { tipo: 'erro'; texto: string } | { tipo: 'sumiu' };
export const PRAZO_DA_TROCA_MS = 240_000;
// A CONFERÊNCIA (F12). O fim na API não é o fim na tela: a primeira
// releitura da lista pode vir velha. E a API às vezes dá erro com a troca
// feita — o /clear volta não confirmado e chegou (F11). A lista ou o stream
// têm este prazo para provar a troca antes de exibir o erro.
export const CONFERE_ERRO_MS = 10_000;
export const CONFERE_PRONTA_MS = 20_000;
export const OPERACAO_SUMIU = 'A troca não começou ou desapareceu do servidor. Confira a conversa e tente de novo.';
export const SEM_CONTATO = 'Perdi o contato com o servidor no meio da troca. Ela pode ter seguido: abra Conversas de novo em instantes.';

export type TrocaEmCurso = Troca & {
  clienteId: string;
  id: string | null;
  inicio: number;
  post: 'pendente' | 'aceito' | 'morto' | 'adotando' | 'recusado';
  viuId: boolean;
  viuEtapa?: boolean;
  emCursoEm?: number;
  adotada: boolean;
  entrou: string | null;
  fase: 'esperando' | 'conferindo' | 'concluida' | 'falhou' | 'recusada';
  etapa: EtapaEmCurso;
  visivel: boolean;
  eventos: EventoDaTroca[];
  conferencia?: { erro: string | null; ate: number; desde: number; listaConferida?: boolean };
  erro?: string;
  recusa?: string;
};
export type SinalDaTroca =
  | { tipo: 'post-aceito'; op: Operacao }
  | { tipo: 'post-morreu' }
  | { tipo: 'post-recusado'; codigo: string }
  | { tipo: 'operacao'; op: Operacao; encerrada?: boolean }
  | { tipo: 'evento'; evento: EventoDaTroca }
  | { tipo: 'falha-de-leitura' }
  | { tipo: 'relogio'; atual?: string | null; sessao?: string | null; listaLidaEm?: number; listaFalhou?: boolean };

export function comecaTroca(pedido: Troca, clienteId: string, agora: number): TrocaEmCurso {
  return { ...pedido, clienteId, id: clienteId, inicio: agora, post: 'pendente', viuId: false, adotada: false,
    entrou: null, fase: 'esperando', etapa: pedido.desligado ? 'religando' : 'estacionando', visivel: false, eventos: [] };
}
export function terminouTroca(t: TrocaEmCurso): boolean {
  return t.fase === 'concluida' || t.fase === 'falhou' || t.fase === 'recusada';
}
export function trocaBloqueia(t: TrocaEmCurso | null): boolean {
  return !!t && !terminouTroca(t) && !t.conferencia?.listaConferida;
}
export function leOperacao(op: Operacao): Leitura {
  if (op.fase === 'estacionando' || op.fase === 'religando') return { tipo: 'segue', etapa: op.fase };
  if (op.fase === 'pronta') return { tipo: 'pronta' };
  if (op.fase === 'erro') return { tipo: 'erro', texto: op.detalhe ?? 'A troca de conversa falhou.' };
  return { tipo: 'sumiu' };
}
export function trocaRefletida(t: Troca, atual: string | null | undefined): boolean {
  if (!atual) return false;
  return t.tipo === 'retomar' ? atual === t.alvo : t.antes != null && atual !== t.antes;
}
function fim(t: TrocaEmCurso, leitura: Exclude<Leitura, { tipo: 'segue' }>, agora: number): TrocaEmCurso {
  if (t.conferencia?.erro && leitura.tipo === 'pronta') return { ...t, fase: 'concluida', conferencia: undefined };
  if (t.fase !== 'esperando') return t;
  const erro = leitura.tipo === 'erro' ? leitura.texto : leitura.tipo === 'sumiu' ? OPERACAO_SUMIU : null;
  return { ...t, fase: 'conferindo', conferencia: { erro, desde: agora, ate: agora + (erro ? CONFERE_ERRO_MS : CONFERE_PRONTA_MS) } };
}
function eventoConfere(t: TrocaEmCurso, e: EventoDaTroca): boolean {
  return !e.operacaoId || e.operacaoId === t.id;
}
function segue(t: TrocaEmCurso, etapa: EtapaEmCurso, agora: number): TrocaEmCurso {
  t = { ...t, emCursoEm: agora };
  // Falha de leitura não é um desfecho da operação no servidor.
  if (t.conferencia?.erro === SEM_CONTATO) return { ...t, fase: 'esperando', conferencia: undefined, etapa, viuEtapa: true };
  return t.viuEtapa && t.etapa === etapa ? t : { ...t, etapa, viuEtapa: true };
}
function opera(t: TrocaEmCurso, op: Operacao, agora: number, encerrada = false): TrocaEmCurso {
  if (t.post === 'adotando') {
    // A que bloqueou já acabou nesta aba: confira o pedido na lista, sem adotá-la de novo.
    if (encerrada) return fim({ ...t, post: 'aceito' }, { tipo: 'sumiu' }, agora);
    t = { ...t, id: op.id ?? null, post: 'aceito', adotada: true, visivel: true };
    const evento = t.eventos.find((e) => eventoConfere(t, e));
    if (evento) return { ...t, fase: 'concluida', entrou: evento.sessionId };
  }
  // Sem id é API antiga: mantém a interpretação anterior do /operacao.
  if (op.id === undefined) {
    if (op.session_id && op.session_id !== t.entrou) t = { ...t, entrou: op.session_id };
    const l = leOperacao(op);
    if (l.tipo === 'sumiu' && t.post === 'pendente') return agora - t.inicio < PRAZO_DA_TROCA_MS ? t : fim(t, { tipo: 'erro', texto: SEM_CONTATO }, agora);
    return l.tipo === 'segue' ? segue(t, l.etapa, agora) : fim(t, l, agora);
  }
  const nossa = !encerrada && !!op.id && op.id === t.id;
  if (nossa && (!t.viuId || (op.session_id && op.session_id !== t.entrou))) {
    t = { ...t, viuId: true, entrou: op.session_id ?? t.entrou };
  }
  // O Safari pode acordar depois dos 240 s com a pronta já disponível.
  if (nossa && (op.fase === 'pronta' || op.fase === 'erro')) return fim(t, leOperacao(op) as Exclude<Leitura, { tipo: 'segue' }>, agora);
  if ((op.fase === null && (t.post === 'aceito' || (t.post === 'morto' && t.viuId)))
    || (!nossa && !t.viuId && t.post === 'morto' && agora - t.inicio >= 15_000)) return fim(t, { tipo: 'sumiu' }, agora);
  if (nossa && (op.fase === 'estacionando' || op.fase === 'religando')) return segue(t, op.fase, agora);
  if (agora - t.inicio >= PRAZO_DA_TROCA_MS) return fim(t, { tipo: 'erro', texto: SEM_CONTATO }, agora);
  return t;
}
export function reduzTroca(t: TrocaEmCurso, sinal: SinalDaTroca, agora: number): TrocaEmCurso {
  // A falha encerra a espera, mas uma prova tardia ainda pode apagar o alerta.
  if (t.fase === 'falhou') {
    if (sinal.tipo === 'post-aceito' && sinal.op.fase === 'pronta' && sinal.op.id && sinal.op.id === t.id) {
      return opera({ ...t, fase: 'esperando', conferencia: undefined, erro: undefined, post: 'aceito', visivel: true }, sinal.op, agora);
    }
    const entrou = sinal.tipo === 'evento' && eventoConfere(t, sinal.evento) ? sinal.evento.sessionId
      : sinal.tipo === 'relogio' && (t.entrou ? sinal.sessao === t.entrou
        : !t.adotada && t.tipo === 'retomar' && trocaRefletida(t, sinal.sessao)) ? sinal.sessao : null;
    return entrou ? { ...t, fase: 'concluida', entrou, erro: undefined, conferencia: undefined } : t;
  }
  if (terminouTroca(t)) return t;
  switch (sinal.tipo) {
    case 'post-morreu': return { ...t, post: 'morto' };
    case 'post-recusado':
      return sinal.codigo === 'operacao_em_curso'
        ? { ...t, post: 'adotando' }
        : { ...t, post: 'recusado', fase: 'recusada', recusa: sinal.codigo };
    case 'post-aceito': return opera({ ...t, post: 'aceito', visivel: true }, sinal.op, agora);
    case 'operacao': return opera(t, sinal.op, agora, sinal.encerrada);
    case 'falha-de-leitura': return fim(t, { tipo: 'erro', texto: SEM_CONTATO }, agora);
    case 'evento':
      return eventoConfere(t, sinal.evento)
        ? { ...t, fase: 'concluida', entrou: sinal.evento.sessionId }
        : { ...t, eventos: [...t.eventos.filter((e) => e.operacaoId !== sinal.evento.operacaoId), sinal.evento] };
    case 'relogio': {
      if (t.fase === 'conferindo' && t.conferencia) {
        const c = t.conferencia;
        const refletida = t.entrou ? sinal.atual === t.entrou : !t.adotada && trocaRefletida(t, sinal.atual);
        const sessaoConferida = t.entrou ? sinal.sessao === t.entrou : !t.adotada && trocaRefletida(t, sinal.sessao);
        if (sessaoConferida) return { ...t, fase: 'concluida', entrou: sinal.sessao ?? t.entrou };
        // A lista libera os botões, mas o chat ainda precisa receber a sessão nova.
        if (refletida && !c.listaConferida) return { ...t, entrou: t.entrou ?? sinal.atual ?? null,
          conferencia: { erro: null, listaConferida: true, desde: c.erro ? agora : c.desde,
            ate: c.erro ? agora + CONFERE_PRONTA_MS : c.ate } };
        // Relógio e lista antiga não encerram a conferência após Safari congelado/recarga.
        if (agora >= c.ate) {
          if (!c.erro) return { ...t, fase: 'concluida' };
          if ((sinal.atual !== undefined || sinal.listaFalhou) && (sinal.listaLidaEm ?? agora) >= c.ate) return { ...t, fase: 'falhou', erro: c.erro };
        }
      }
      if (t.fase === 'esperando' && agora - t.inicio >= PRAZO_DA_TROCA_MS
        && (t.emCursoEm === undefined || agora - t.emCursoEm >= CONFERE_ERRO_MS)) return fim(t, { tipo: 'erro', texto: SEM_CONTATO }, agora);
      return !t.visivel && agora - t.inicio >= 2_000 ? { ...t, visivel: true } : t;
    }
  }
}
