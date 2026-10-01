/**
 * A RÉGUA DO HISTÓRICO — sem React, sem DOM, sem rede (F9 das conversas).
 *
 * A lista vem inteira numa ida só (`GET /conversas`, filtro `todas`) e filtro e
 * busca rodam aqui, no aparelho. A frio o servidor leva ~10 s para ler os JSONL
 * do Pavan (relato da F3); voltar a ele a cada letra digitada seria esperar de
 * novo por um dado que já está na mão.
 */
import type { Conversa } from '@grupo_borges/cockpit-core/api';

export type FiltroDeConversa = 'todas' | 'estrela' | 'pendencia';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function inicioDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "agora", "4 min", "3h", "ontem", "4 dias" e, depois de 30 dias (só as ⭐
 *  chegam lá), a data curta "12 set". Hora conta só dentro do mesmo dia: às
 *  9h, uma conversa das 22h de ontem é "ontem", não "11h". */
export function tempoRelativo(quando: number, agora: number): string {
  const diferenca = Math.max(0, agora - quando);
  if (diferenca < MINUTO) return 'agora';
  if (diferenca < HORA) return `${Math.floor(diferenca / MINUTO)} min`;
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(quando)) / (24 * HORA));
  if (dias <= 0) return `${Math.floor(diferenca / HORA)}h`;
  if (dias === 1) return 'ontem';
  if (dias <= 30) return `${dias} dias`;
  const d = new Date(quando);
  const data = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === new Date(agora).getFullYear() ? data : `${data} ${d.getFullYear()}`;
}

/** Caixa e acento não contam: "migracao" acha "Migração". */
export function normaliza(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Toda palavra digitada tem que aparecer no título ou na nota, em qualquer ordem. */
export function casaBusca(conversa: Conversa, busca: string): boolean {
  const palavras = normaliza(busca).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  const alvo = normaliza(`${conversa.titulo}\n${conversa.nota ?? ''}`);
  return palavras.every((p) => alvo.includes(p));
}

/** `seguradas`: conversas que perderam a ⭐ com o filtro Especiais aberto.
 *  Sumir no toque assusta (furo da F9); elas ficam até trocar de filtro. */
export function filtraConversas(
  lista: readonly Conversa[],
  filtro: FiltroDeConversa,
  busca: string,
  seguradas: ReadonlySet<string> = new Set(),
): Conversa[] {
  return lista.filter((c) => {
    if (filtro === 'estrela' && !c.estrela && !seguradas.has(c.id)) return false;
    if (filtro === 'pendencia' && !c.pendencia) return false;
    return casaBusca(c, busca);
  });
}

/** A de agora sobe para o cartão "Em uso agora"; o resto é a lista. */
export function separaAtual(lista: readonly Conversa[]): { atual: Conversa | null; outras: Conversa[] } {
  const atual = lista.find((c) => c.atual) ?? null;
  return { atual, outras: lista.filter((c) => !c.atual) };
}

/** O filtro ⚠️ só aparece quando a API sabe contar pendência. Enquanto toda
 *  conversa vier com `pendencia: null` (até a F7), ele seria um filtro sempre
 *  vazio. */
export function sabePendencia(lista: readonly Conversa[]): boolean {
  return lista.some((c) => c.pendencia !== null);
}

/** Texto do 🔒. Com dono, nomeia a linha; sem dono, a trava é de escrita recente. */
export function descreveTrava(conversa: Conversa, nomeDoAgente: (slug: string) => string): string {
  if (conversa.bloqueada_por) return `Em uso por ${nomeDoAgente(conversa.bloqueada_por)}`;
  return 'Em uso em outro lugar';
}

export function contaTurnos(turnos: number): string {
  return turnos === 1 ? '1 turno' : `${turnos} turnos`;
}

/** O que dizer quando a lista filtrada vem vazia — sempre com a saída. */
export function listaVazia(filtro: FiltroDeConversa, busca: string): string {
  if (busca.trim()) return `Nada com “${busca.trim()}” no título ou na nota.`;
  if (filtro === 'estrela') return 'Nenhuma especial ainda. Abra uma conversa e marque a estrela.';
  if (filtro === 'pendencia') return 'Nenhuma conversa deixou arquivo sem commit.';
  return 'Nenhuma outra conversa nos últimos 30 dias.';
}
