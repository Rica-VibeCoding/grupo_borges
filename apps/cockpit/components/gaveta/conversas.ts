/**
 * A RÉGUA DO HISTÓRICO — sem React, sem DOM, sem rede (F9 das conversas).
 *
 * A lista vem inteira numa ida só (`GET /conversas`, filtro `todas`) e filtro e
 * busca rodam aqui, no aparelho. As concluídas são a exceção: a API não as
 * manda em `todas` (F14), e o filtro delas faz a sua própria ida. A frio o servidor leva ~10 s para ler os JSONL
 * do Pavan (relato da F3); voltar a ele a cada letra digitada seria esperar de
 * novo por um dado que já está na mão.
 */
import type { Conversa } from '@grupo_borges/cockpit-core/api';

export type FiltroDeConversa = 'todas' | 'estrela' | 'concluidas';

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

/** Filtro e busca sobre a lista já lida. A API já separa as concluídas; a
 *  marca vale de novo aqui porque Concluída e Reabrir mudam a lista no
 *  aparelho, antes de ela ser relida. */
export function filtraConversas(lista: readonly Conversa[], filtro: FiltroDeConversa, busca: string): Conversa[] {
  return lista.filter((c) => {
    if (filtro === 'concluidas' ? !c.concluida : c.concluida) return false;
    if (filtro === 'estrela' && !c.estrela) return false;
    return casaBusca(c, busca);
  });
}

/** A de agora sobe para o cartão "Em uso agora"; o resto é a lista. */
export function separaAtual(lista: readonly Conversa[]): { atual: Conversa | null; outras: Conversa[] } {
  const atual = lista.find((c) => c.atual) ?? null;
  return { atual, outras: lista.filter((c) => !c.atual) };
}

/** Texto do 🔒. Com dono, nomeia a linha; sem dono, a trava é de escrita recente. */
export function descreveTrava(conversa: Conversa, nomeDoAgente: (slug: string) => string): string {
  if (conversa.bloqueada_por) return `Em uso por ${nomeDoAgente(conversa.bloqueada_por)}`;
  return 'Em uso em outro lugar';
}

export function contaTurnos(turnos: number): string {
  return turnos === 1 ? '1 turno' : `${turnos} turnos`;
}

/** A linha de baixo do título na leitura: "3h atrás, 24 turnos", "ontem, 3 turnos".
 *  "atrás" só no que é contagem — "agora", "ontem" e a data já se dizem sozinhos. */
export function resumoDaLeitura(conversa: Pick<Conversa, 'atualizada_em' | 'turnos'>, agora: number): string {
  const quando = tempoRelativo(conversa.atualizada_em, agora);
  const conta = /^\d+( min|h| dias)$/.test(quando) ? `${quando} atrás` : quando;
  return `${conta}, ${contaTurnos(conversa.turnos)}`;
}

/** O cartão "Em uso agora" some com a conversa de agora vazia (rodada 2): uma
 *  conversa recém-aberta não tem o que mostrar. Ação em curso ou troca recém-feita
 *  seguram o cartão — é onde elas aparecem. Sem conversa conhecida e de pé, ele
 *  fica só com a Nova conversa, como antes. */
export function mostraEmUso(atual: Pick<Conversa, 'turnos'> | null, comAcao: boolean, dePe: boolean): boolean {
  if (comAcao) return true;
  return atual ? atual.turnos > 0 : dePe;
}

/** O que dizer quando a lista filtrada vem vazia — sempre com a saída. */
export function listaVazia(filtro: FiltroDeConversa, busca: string): string {
  if (busca.trim()) return `Nada com “${busca.trim()}” no título ou na nota.`;
  if (filtro === 'estrela') return 'Nenhuma especial ainda. Abra uma conversa e marque a estrela.';
  if (filtro === 'concluidas') return 'Nenhuma concluída. Abra uma conversa e toque em Concluída.';
  return 'Nenhuma outra conversa nos últimos 30 dias.';
}
