/**
 * Único dono da troca por agente. Histórico, atalho e chat entregam fatos;
 * a régua decide e só este store escreve ck-conversa-troca na aba.
 */
import { safeUUID } from '@grupo_borges/cockpit-core/ids';
import { comecaTroca, reduzTroca, terminouTroca, trocaBloqueia, type EventoDaTroca, type Operacao,
  type SinalDaTroca, type Troca, type TrocaEmCurso, type EtapaEmCurso } from './regua-da-troca.ts';
export { trocaBloqueia } from './regua-da-troca.ts';
export type { Troca, TrocaEmCurso, Operacao } from './regua-da-troca.ts';

export const ESPERA_DO_STREAM_MS = 2_000;

export type TrocaNoChat =
  | { fase: 'trocando'; tipo: Troca['tipo']; alvoTitulo: string | null; etapa: EtapaEmCurso; inicio: number; desligado: boolean; forcar: boolean }
  | { fase: 'pronta'; emMs: number; sessionId?: string | null }
  | { fase: 'falhou'; texto: string };
export type GuardaDaTroca = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Registro = { estado: TrocaEmCurso | null; chat: TrocaNoChat | null; guarda: GuardaDaTroca | null; restaurado: boolean; falhas: number; encerradas: Set<string>; sessao?: string | null };
const registros = new Map<string, Registro>();
const ouvintes = new Map<string, Set<() => void>>();
const chave = (slug: string) => `ck-conversa-troca:${slug}`;
const chaveEncerradas = (slug: string) => `${chave(slug)}:encerradas`;

export function sessaoDaTroca(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
function registro(slug: string): Registro {
  let r = registros.get(slug);
  if (!r) {
    r = { estado: null, chat: null, guarda: null, restaurado: false, falhas: 0, encerradas: new Set() };
    registros.set(slug, r);
  }
  return r;
}
function projeta(t: TrocaEmCurso | null, agora: number): TrocaNoChat | null {
  if (!t || t.fase === 'concluida' || t.fase === 'recusada') return null;
  if (t.fase === 'falhou') return { fase: 'falhou', texto: t.erro! };
  if (t.fase === 'conferindo' && !t.conferencia?.erro) return agora < t.conferencia!.desde + ESPERA_DO_STREAM_MS
    ? { fase: 'pronta', emMs: t.conferencia!.desde, sessionId: t.entrou } : null;
  if (!t.visivel) return null;
  return { fase: 'trocando', tipo: t.tipo, alvoTitulo: t.alvoTitulo ?? null, etapa: t.etapa,
    inicio: t.inicio, desligado: t.desligado, forcar: t.forcar };
}
function publica(slug: string, t: TrocaEmCurso | null, agora = Date.now()): void {
  const r = registro(slug);
  const chat = projeta(t, agora);
  const mudouChat = JSON.stringify(chat) !== JSON.stringify(r.chat);
  if (r.estado === t && !mudouChat) return;
  r.estado = t;
  if (t && terminouTroca(t)) {
    r.encerradas.add(t.clienteId);
    if (t.id) r.encerradas.add(t.id);
    podaEncerradas(r);
  }
  if (mudouChat) r.chat = chat;
  try {
    // Fim limpa a aba aqui, inclusive quando só o chat está montado.
    if (t && terminouTroca(t)) r.guarda?.setItem(chaveEncerradas(slug), JSON.stringify([...r.encerradas]));
    if (!t || terminouTroca(t)) r.guarda?.removeItem(chave(slug));
    else r.guarda?.setItem(chave(slug), JSON.stringify(t));
  } catch { /* Safari privado pode recusar acesso à aba. */ }
  for (const fn of ouvintes.get(slug) ?? []) fn();
}
function podaEncerradas(r: Registro): void {
  while (r.encerradas.size > 20) r.encerradas.delete(r.encerradas.values().next().value!);
}
export function restauraTroca(slug: string, guarda: GuardaDaTroca | null = sessaoDaTroca(), agora = Date.now()): void {
  const r = registro(slug);
  if (r.restaurado) return;
  r.restaurado = true;
  r.guarda = guarda;
  try {
    const ids = JSON.parse(guarda?.getItem(chaveEncerradas(slug)) ?? '[]');
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') r.encerradas.add(id);
    podaEncerradas(r);
    if (Array.isArray(ids) && ids.length > 20) guarda?.setItem(chaveEncerradas(slug), JSON.stringify([...r.encerradas]));
  } catch { /* Uma chave inválida não impede restaurar a troca em curso. */ }
  if (r.estado) return;
  try {
    const cru = guarda?.getItem(chave(slug));
    if (!cru) return;
    const t = JSON.parse(cru);
    if (t.tipo !== 'nova' && t.tipo !== 'retomar') return;
    if (typeof t.clienteId === 'string' && typeof t.inicio === 'number') {
      if (!terminouTroca(t) && !r.encerradas.has(t.id) && !r.encerradas.has(t.clienteId)) publica(slug, { ...t, post: t.post === 'pendente' ? 'morto' : t.post }, agora);
    } else {
      // O formato antigo não prova que o POST chegou; só /operacao pode mostrar espera.
      guarda?.removeItem(chave(slug));
    }
  } catch { /* Uma chave inválida não impede abrir o Histórico. */ }
}
export function leTroca(slug: string): TrocaEmCurso | null { return registros.get(slug)?.estado ?? null; }
export function leTrocaNoChat(slug: string): TrocaNoChat | null { return registros.get(slug)?.chat ?? null; }
export function assinaTrocaNoChat(slug: string, fn: () => void): () => void {
  const conjunto = ouvintes.get(slug) ?? new Set();
  conjunto.add(fn);
  ouvintes.set(slug, conjunto);
  return () => { conjunto.delete(fn); };
}
/** O cartão relê inclusive após falha ou dispensa: a troca pode ter seguido
 * no servidor sem confirmação na tela. */
export function assinaTrocaFeita(slug: string, fn: () => void): () => void {
  const feita = () => {
    const t = leTroca(slug);
    return t?.fase === 'concluida' || t?.conferencia?.listaConferida ? t.clienteId
      : t && terminouTroca(t) ? `${t.clienteId}:${t.fase}` : null;
  };
  let ultima = feita();
  let anterior = leTroca(slug);
  return assinaTrocaNoChat(slug, () => {
    const id = feita();
    const atual = leTroca(slug);
    const dispensada = anterior && !atual;
    anterior = atual;
    const mudou = id && id !== ultima;
    ultima = id;
    if (mudou || dispensada) fn();
  });
}
export function comecarTroca(slug: string, pedido: Troca, agora = Date.now(), id: string = safeUUID()): string {
  restauraTroca(slug);
  if (registro(slug).encerradas.has(id)) return id;
  const anterior = leTroca(slug);
  if (anterior?.clienteId === id || trocaBloqueia(anterior)) return anterior!.clienteId;
  const sessao = registro(slug).sessao;
  if (pedido.tipo === 'nova' && pedido.antes === undefined && sessao !== undefined) pedido = { ...pedido, antes: sessao };
  registro(slug).falhas = 0;
  publica(slug, comecaTroca(pedido, id, agora), agora);
  return id;
}
function entrega(slug: string, id: string, sinal: SinalDaTroca, agora: number): void {
  const t = leTroca(slug);
  if (t?.clienteId === id) publica(slug, reduzTroca(t, sinal, agora), agora);
}
export function postRespondeu(slug: string, id: string, op: Operacao, agora = Date.now()): void {
  entrega(slug, id, { tipo: 'post-aceito', op }, agora);
}
export function postMorreu(slug: string, id: string, agora = Date.now()): void {
  entrega(slug, id, { tipo: 'post-morreu' }, agora);
}
export function postRecusado(slug: string, id: string, codigo: string, agora = Date.now()): void {
  entrega(slug, id, { tipo: 'post-recusado', codigo }, agora);
}
/** O carimbo impede uma leitura iniciada antes do clique/409 de fechar ou adotar outra operação. */
export function carimboDaLeitura(slug: string): string {
  const t = leTroca(slug);
  return t ? `${t.clienteId}:${t.post}:${t.id}` : '';
}
export function operacaoLida(slug: string, carimbo: string, op: Operacao, agora = Date.now()): void {
  if (carimbo !== carimboDaLeitura(slug)) return;
  const r = registro(slug);
  r.falhas = 0;
  const encerrada = !!op.id && r.encerradas.has(op.id);
  if (!encerrada && (!r.estado || terminouTroca(r.estado)) && (op.fase === 'estacionando' || op.fase === 'religando')) {
    const t = comecaTroca({ tipo: 'retomar', alvo: null, forcar: false, desligado: false }, safeUUID(), agora);
    publica(slug, { ...t, id: op.id ?? null, post: 'aceito', adotada: true, visivel: true }, agora);
  }
  const t = leTroca(slug);
  if (t) entrega(slug, t.clienteId, { tipo: 'operacao', op, encerrada }, agora);
}
export function leituraMorreu(slug: string, carimbo: string, agora = Date.now()): void {
  if (carimbo !== carimboDaLeitura(slug)) return;
  const r = registro(slug);
  const t = r.estado;
  if (t && ++r.falhas >= 5) entrega(slug, t.clienteId, { tipo: 'falha-de-leitura' }, agora);
}
export function conversaTrocada(slug: string, evento: EventoDaTroca, agora = Date.now()): void {
  const t = leTroca(slug);
  if (t) entrega(slug, t.clienteId, { tipo: 'evento', evento }, agora);
}
export function confereTroca(slug: string, prova: { atual?: string | null; sessao?: string | null; listaLidaEm?: number; listaFalhou?: boolean } = {}, agora = Date.now()): void {
  if (prova.sessao !== undefined) registro(slug).sessao = prova.sessao;
  const t = leTroca(slug);
  if (t) entrega(slug, t.clienteId, { tipo: 'relogio', ...prova }, agora);
}
export function dispensaTroca(slug: string, clienteId?: string): void {
  const t = leTroca(slug);
  if (t && terminouTroca(t) && (!clienteId || t.clienteId === clienteId)) publica(slug, null);
}
export function limpaTrocasNoChat(): void { registros.clear(); ouvintes.clear(); }
