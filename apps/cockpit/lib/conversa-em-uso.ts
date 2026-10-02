'use client';

/**
 * A CONVERSA EM USO — para a pílula do topo saber o que está aberto agora.
 *
 * De onde isto vem: `GET /conversas` marca com `atual: true` a conversa da
 * linha (a mesma lista que o Cartão "Em uso agora" da gaveta lê). A API nunca
 * esconde a atual da lista, ainda que ela não tenha turno nenhum.
 *
 * O NOME QUE A PÍLULA MOSTRA é a parte com régua própria, e ela é PURA — mora
 * em `rotuloDaConversa`, com teste. Resumo da ordem de queda da API
 * (`services/conversas.py:_titulo`): nome dado pelo Rica > estacionado >
 * custom-title > ai-title > last-prompt > primeira fala do usuário. O último
 * degrau é a SENTINELA `Conversa {8 do id}`, que a API inventa quando ainda
 * não há fala nenhuma. Só a origem `primeira` pode ser sentinela, e ela só é
 * sentinela com zero turnos — com um turno já existe a fala que a nomeia.
 *
 * O store é o padrão da casa (`turno-vivo.ts`, `troca-em-curso.ts`): um valor
 * por agente, assinantes avisados na troca, `useSyncExternalStore` na ponta.
 * Quem lê é a pílula do topo; quem re-lê é ela também, em três momentos — ao
 * montar, quando a troca de conversa acaba, e quando o turno cai (é aí que a
 * API grava o título da primeira fala).
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { fetchConversas, postConversaTitulo, type Conversa, type ConversasResponse } from '@grupo_borges/cockpit-core/api';

import { formataDataHora } from '../components/feed/data-hora.ts';

import { assinaTrocaNoChat, leTrocaNoChat } from './troca-em-curso.ts';
import { assinaTurnoVivo, leTurnoVivo } from './turno-vivo.ts';

export type ConversaEmUso = {
  id: string;
  /** O que a pílula escreve: o nome dado, ou "Conversa nova". */
  rotulo: string;
  /** Ainda sem turno nenhum — o nome que existe é a sentinela da API. */
  nova: boolean;
  /** Quando começou (epoch ms); `null` quando a API não sabe dizer. */
  iniciadaEm: number | null;
  turnos: number;
};

/** O nome que a pílula mostra. A sentinela da API é `primeira` + zero turnos: */
export function rotuloDaConversa(c: Pick<Conversa, 'titulo' | 'titulo_origem' | 'turnos'>): string {
  if (c.titulo_origem === 'primeira' && c.turnos === 0) return 'Conversa nova';
  return c.titulo;
}

/** A conversa da linha na lista, ou `null` se a lista ainda não a aponta. */
export function leConversaEmUso(resposta: ConversasResponse | null): ConversaEmUso | null {
  const atual = resposta?.conversas.find((c) => c.atual);
  if (!atual) return null;
  return {
    id: atual.id,
    rotulo: rotuloDaConversa(atual),
    nova: atual.titulo_origem === 'primeira' && atual.turnos === 0,
    iniciadaEm: atual.iniciada_em ?? null,
    turnos: atual.turnos,
  };
}

// O dia e o dia da semana no fuso do Rica — a hora vem de `formataDataHora`,
// a mesma régua dos carimbos do feed.
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const SEMANA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short' });

/** Quando a conversa começou, já partido em BRT — a régua única do "hoje" da
 *  pílula e do cartão. `null` sem data ou com instante inválido. */
function quando(iniciadaEm: number | null, agora: number) {
  const carimbo = iniciadaEm === null ? null : formataDataHora(iniciadaEm);
  if (iniciadaEm === null || carimbo === null) return null;
  const [diaMes, hora] = carimbo.split(' ');
  return {
    diaMes,
    hora,
    hoje: DIA.format(iniciadaEm) === DIA.format(agora),
    semana: SEMANA.format(iniciadaEm).replace('.', ''),
  };
}

/** A data curta da pílula fechada: `28/09`, ou `hoje`. Sem data, `null`. A
 *  "Conversa nova" também leva a data — o Rica espera ver o dia da criação
 *  desde o primeiro instante (02/10). */
export function dataCurtaDaConversa(c: Pick<ConversaEmUso, 'iniciadaEm' | 'nova'>, agora: number = Date.now()): string | null {
  const q = quando(c.iniciadaEm, agora);
  if (!q) return null;
  return q.hoje ? 'hoje' : q.diaMes;
}

/** A linha embaixo do nome no cartão: `Aberta qui 28/09, 14:10 · 12 turnos`.
 *  Hoje vira `Aberta hoje, 14:10`; zero turnos some; sem data, só os turnos;
 *  sem nada, `null` (o cartão não reserva linha vazia). */
export function linhaDaConversa(c: Pick<ConversaEmUso, 'iniciadaEm' | 'turnos'>, agora: number = Date.now()): string | null {
  const partes: string[] = [];
  const q = quando(c.iniciadaEm, agora);
  if (q) partes.push(q.hoje ? `Aberta hoje, ${q.hora}` : `Aberta ${q.semana} ${q.diaMes}, ${q.hora}`);
  if (c.turnos > 0) partes.push(c.turnos === 1 ? '1 turno' : `${c.turnos} turnos`);
  return partes.length ? partes.join(' · ') : null;
}

// ── O store ────────────────────────────────────────────────────────────────
const valores = new Map<string, ConversaEmUso | null>();
const ouvintes = new Map<string, Set<() => void>>();

const igual = (a: ConversaEmUso | null, b: ConversaEmUso | null) =>
  a?.id === b?.id &&
  a?.rotulo === b?.rotulo &&
  a?.nova === b?.nova &&
  a?.iniciadaEm === b?.iniciadaEm &&
  a?.turnos === b?.turnos;

export function leConversaEmUsoGuardada(slug: string): ConversaEmUso | null {
  return valores.get(slug) ?? null;
}

export function assinaConversaEmUso(slug: string, fn: () => void): () => void {
  const conjunto = ouvintes.get(slug) ?? new Set<() => void>();
  conjunto.add(fn);
  ouvintes.set(slug, conjunto);
  return () => {
    conjunto.delete(fn);
    if (conjunto.size === 0) ouvintes.delete(slug);
  };
}

export function publicaConversaEmUso(slug: string, conversa: ConversaEmUso | null): void {
  if (igual(valores.get(slug) ?? null, conversa)) return; // mesmo valor: não acorda render à toa
  valores.set(slug, conversa);
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

/** Relê a lista. Leitura pedida depois manda: a anterior é abortada no ato, para
 *  uma resposta velha não desfazer uma troca que já aconteceu. */
const leituras = new Map<string, AbortController>();

export function relerConversaEmUso(agentSlug: string): void {
  leituras.get(agentSlug)?.abort();
  const controlador = new AbortController();
  leituras.set(agentSlug, controlador);
  fetchConversas(agentSlug, controlador.signal)
    .then((resposta) => {
      if (!controlador.signal.aborted) publicaConversaEmUso(agentSlug, leConversaEmUso(resposta));
    })
    .catch(() => {
      // Sem leitura a pílula fica com o que já sabia — nunca com um nome inventado.
    });
}

/** A pílula do topo — `null` enquanto a lista não chegou (nada de piscar nome errado). */
export function usaConversaEmUso(agentSlug: string): ConversaEmUso | null {
  const assina = useMemo(() => (fn: () => void) => assinaConversaEmUso(agentSlug, fn), [agentSlug]);
  const le = useMemo(() => () => leConversaEmUsoGuardada(agentSlug), [agentSlug]);
  const emUso = useSyncExternalStore(assina, le, () => null);

  const reler = useCallback(() => relerConversaEmUso(agentSlug), [agentSlug]);

  useEffect(() => {
    reler();
    return () => leituras.get(agentSlug)?.abort();
  }, [agentSlug, reler]);

  // A troca acabou: quem está em uso é outra conversa.
  const assinaDaTroca = useMemo(() => (fn: () => void) => assinaTrocaNoChat(agentSlug, fn), [agentSlug]);
  useEffect(() => {
    let antes = leTrocaNoChat(agentSlug);
    return assinaDaTroca(() => {
      const agora = leTrocaNoChat(agentSlug);
      const acabou = antes !== null && agora === null;
      antes = agora;
      if (acabou) reler();
    });
  }, [agentSlug, assinaDaTroca, reler]);

  // O turno caiu: a API acabou de gravar o título tirado da primeira fala.
  const assinaDoTurno = useMemo(() => (fn: () => void) => assinaTurnoVivo(agentSlug, fn), [agentSlug]);
  useEffect(() => {
    let antes = leTurnoVivo(agentSlug);
    return assinaDoTurno(() => {
      const agora = leTurnoVivo(agentSlug);
      const caiu = antes && !agora;
      antes = agora;
      if (caiu) reler();
    });
  }, [agentSlug, assinaDoTurno, reler]);

  return emUso;
}

/** Renomear pela pílula: mesma rota da gaveta (`postConversaTitulo`). O título
 *  novo entra no store no ato, e a releitura logo depois corrige o que a
 *  resposta do POST não sabe dizer — se a conversa ainda é nova, por exemplo.
 *  Vazio apaga o nome dado: a API devolve o título automático de volta. */
export async function renomeiaConversaEmUso(agentSlug: string, id: string, titulo: string): Promise<void> {
  const resposta = await postConversaTitulo(agentSlug, id, titulo);
  const antes = leConversaEmUsoGuardada(agentSlug);
  publicaConversaEmUso(agentSlug, {
    id: resposta.id,
    rotulo: resposta.titulo,
    nova: antes?.nova ?? false,
    iniciadaEm: antes?.iniciadaEm ?? null,
    turnos: antes?.turnos ?? 0,
  });
  relerConversaEmUso(agentSlug);
}
