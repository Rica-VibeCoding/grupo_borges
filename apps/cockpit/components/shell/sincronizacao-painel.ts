import { fetchAgentPainel } from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { leiaOperacao } from './operacao-de-motor.ts';

/** `fundo`: o painel chegou sem ser resposta a uma ação do Rica NESTE chip —
 *  o reenvio da troca em espera, a convergência do esforço, a barra do chat
 *  (28/09). Quem recebe atualiza o dado, mas não fecha a gaveta que ele pode
 *  ter aberto nesse meio-tempo nem mexe no "salvando" de outra ação. */
export type ContextoDoPainel = { fundo: boolean };

const ouvintes = new Map<string, Set<(painel: AgentPainelResponse, contexto: ContextoDoPainel) => void>>();

/* O ÚLTIMO PAINEL LIDO, POR AGENTE (28/09). Sem ele o chip do motor nascia sem
 * dado a cada montagem — abrir ou voltar a um agente — e ficava só leitura, sem
 * dropdown, até o `/painel` responder. É o painel do BACK, nunca a config: o
 * modelo ali já é o `state_model` do banco, que vence o `agents.yaml`.
 *
 * O cache NÃO pode ressuscitar o motor velho de uma troca (armadilha do
 * ae5c41b). Por isso: cada envio de troca ESQUECE o agente (`esquecerPainel`,
 * que também invalida leitura já em voo); com troca em curso — esperando ou
 * trocando — nada entra nem sai daqui; o mesmo com religar em curso, que
 * também esquece ao disparar; e só vale painel lido DEPOIS do último
 * esquecimento. Quem diz se há troca em curso é a store da espera, que se
 * registra em `definirTrocaEmCurso` (`esperas-de-troca-cliente.ts`). */
const guardados = new Map<string, AgentPainelResponse>();
const esquecimentos = new Map<string, number>();
let trocaEmCurso: (slug: string) => boolean = () => false;

export function definirTrocaEmCurso(consulta: (slug: string) => boolean): void {
  trocaEmCurso = consulta;
}

/** Sem troca em curso e sem religar em curso: só aí o painel guardado vale.
 *  Religando (desligando, subindo, confirmando, agrupando escolhas) o motor
 *  pode estar mudando por um caminho que não passa pela espera da troca. */
function quieto(slug: string): boolean {
  const fase = leiaOperacao(slug).fase;
  return (fase === 'ocioso' || fase === 'concluido') && !trocaEmCurso(slug);
}

/** Marca de uma leitura que começa agora; `null` = não pode guardar. */
export function marcaDaLeitura(slug: string): number | null {
  return quieto(slug) ? esquecimentos.get(slug) ?? 0 : null;
}

/** Guarda o painel lido. Sem `marca`, é painel que acabou de chegar do back. */
export function guardarPainel(painel: AgentPainelResponse, marca?: number | null): void {
  if (marca === null || !quieto(painel.slug)) return;
  if (marca !== undefined && marca !== (esquecimentos.get(painel.slug) ?? 0)) return;
  guardados.set(painel.slug, painel);
}

/** A semente do chip que monta. */
export function painelGuardado(slug: string): AgentPainelResponse | undefined {
  return quieto(slug) ? guardados.get(slug) : undefined;
}

export function esquecerPainel(slug: string): void {
  guardados.delete(slug);
  esquecimentos.set(slug, (esquecimentos.get(slug) ?? 0) + 1);
}

/* O PAINEL SAI NO TOQUE DA TROPA, NÃO NA MONTAGEM DO CHIP — mesma ideia do
 * `preaqueceConversa`. O agente que ele nunca abriu nesta aba não tem painel
 * guardado; sem isto o `/painel` só saía depois do commit da navegação, em
 * série com ela. O chip que montar em seguida TOMA esta leitura em vez de
 * fazer a dele: o pedido é o mesmo, só sai antes. */
const PREAQUECIMENTO_VALE_MS = 3_000;
const preaquecidos = new Map<string, { leitura: Promise<AgentPainelResponse>; em: number; marca: number | null }>();

export function preaquecePainel(
  slug: string,
  ler: (slug: string) => Promise<AgentPainelResponse> = fetchAgentPainel,
  agora: () => number = Date.now,
): void {
  const atual = preaquecidos.get(slug);
  if (atual && agora() - atual.em < PREAQUECIMENTO_VALE_MS) return;
  const marca = marcaDaLeitura(slug);
  const leitura = ler(slug);
  leitura.then((painel) => { if (painel.slug === slug) guardarPainel(painel, marca); }, () => undefined);
  preaquecidos.set(slug, { leitura, em: agora(), marca });
}

/** A leitura preaquecida de `slug`, uma vez só — e só se ainda fresca e sem
 *  troca nem esquecimento desde que saiu: senão ela descreve o motor de antes. */
export function tomarPreaquecimento(slug: string, agora: () => number = Date.now): Promise<AgentPainelResponse> | null {
  const atual = preaquecidos.get(slug);
  preaquecidos.delete(slug);
  if (!atual || agora() - atual.em >= PREAQUECIMENTO_VALE_MS) return null;
  return atual.marca !== null && atual.marca === marcaDaLeitura(slug) ? atual.leitura : null;
}

export function publicarPainel(painel: AgentPainelResponse, opcoes: { fundo?: boolean } = {}): void {
  guardarPainel(painel);
  const contexto = { fundo: opcoes.fundo === true };
  ouvintes.get(painel.slug)?.forEach((receber) => receber(painel, contexto));
}

export function sincronizarPainel(
  slug: string,
  buscar: (slug: string, signal: AbortSignal) => Promise<AgentPainelResponse>,
  receber: (painel: AgentPainelResponse, contexto: ContextoDoPainel) => void,
  falhar: () => void,
): () => void {
  const controlador = new AbortController();
  const atualizar = (painel: AgentPainelResponse, contexto: ContextoDoPainel) => {
    controlador.abort();
    receber(painel, contexto);
  };
  const inscritos = ouvintes.get(slug) ?? new Set();
  inscritos.add(atualizar);
  ouvintes.set(slug, inscritos);
  const marca = marcaDaLeitura(slug);
  buscar(slug, controlador.signal).then((painel) => {
    if (controlador.signal.aborted || painel.slug !== slug) return;
    guardarPainel(painel, marca);
    // A leitura inicial chega como FUNDO: com o painel guardado o chip já nasce
    // com dropdown, e a gaveta que ele abriu nesse meio-tempo não pode fechar
    // na mão dele quando a leitura fresca chegar.
    receber(painel, { fundo: true });
  }).catch(() => {
    if (!controlador.signal.aborted) falhar();
  });
  return () => {
    controlador.abort();
    inscritos.delete(atualizar);
    if (!inscritos.size) ouvintes.delete(slug);
  };
}
