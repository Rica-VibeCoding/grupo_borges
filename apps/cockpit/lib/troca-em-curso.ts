/**
 * A TROCA EM CURSO, vista do chat (F13 das conversas).
 *
 * Quem conduz a troca é o Histórico (`usa-acoes-de-conversa.ts`), que lê o
 * `/operacao`. O chat só precisa saber que ela está acontecendo, para não
 * parecer travado mostrando a conversa que vai sair. Este store é a ponte:
 * o Histórico publica, o chat lê. Sem React, por agente.
 *
 * Fim: o stream avisa (`conversa-trocada`) e o chat chama `concluiTroca`.
 * Uma troca publicada DEPOIS disso com início anterior é a mesma que já
 * acabou — o Histórico ainda conferindo a lista — e não volta a escurecer o chat.
 */
import type { EtapaEmCurso } from '../components/gaveta/acoes-de-conversa.ts';

export type TrocaNoChat =
  | {
      fase: 'trocando';
      tipo: 'retomar' | 'nova';
      /** Título da conversa pedida no Retomar, quando o Histórico sabe. */
      alvoTitulo: string | null;
      etapa: EtapaEmCurso;
      inicio: number;
      desligado: boolean;
      forcar: boolean;
    }
  /** A API terminou; o chat espera o stream trazer a conversa nova. */
  | { fase: 'pronta'; emMs: number }
  | { fase: 'falhou'; texto: string };

/** Depois da pronta, quanto o chat espera o aviso do stream antes de largar. */
export const ESPERA_DO_STREAM_MS = 20_000;

type Registro = { troca: TrocaNoChat | null; concluidaEm: number; donos: number };

const registros = new Map<string, Registro>();
const ouvintes = new Map<string, Set<() => void>>();

function registro(slug: string): Registro {
  let r = registros.get(slug);
  if (!r) {
    r = { troca: null, concluidaEm: 0, donos: 0 };
    registros.set(slug, r);
  }
  return r;
}

function avisa(slug: string): void {
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

export function leTrocaNoChat(slug: string): TrocaNoChat | null {
  return registros.get(slug)?.troca ?? null;
}

export function assinaTrocaNoChat(slug: string, fn: () => void): () => void {
  let set = ouvintes.get(slug);
  if (!set) {
    set = new Set();
    ouvintes.set(slug, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export function publicaTrocaNoChat(slug: string, troca: TrocaNoChat | null): void {
  const r = registro(slug);
  if (troca?.fase === 'trocando' && troca.inicio <= r.concluidaEm) return;
  if (troca?.fase === 'pronta' && r.troca?.fase !== 'trocando') return;
  if (r.troca === troca) return;
  r.troca = troca;
  avisa(slug);
}

/** O stream trouxe a conversa nova: a espera do chat acaba aqui. */
export function concluiTroca(slug: string, agora = Date.now()): void {
  const r = registro(slug);
  r.concluidaEm = agora;
  if (r.troca === null) return;
  r.troca = null;
  avisa(slug);
}

/** O Histórico está montado e conduzindo? Enquanto estiver, o chat não lê o
 *  `/operacao` por conta própria. Devolve quem solta. */
export function assumeTroca(slug: string): () => void {
  registro(slug).donos += 1;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    registro(slug).donos -= 1;
    avisa(slug);
  };
}

export function temDono(slug: string): boolean {
  return (registros.get(slug)?.donos ?? 0) > 0;
}

/** Só para teste. */
export function limpaTrocasNoChat(): void {
  registros.clear();
  ouvintes.clear();
}
