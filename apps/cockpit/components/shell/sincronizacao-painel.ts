import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

/** `fundo`: o painel chegou sem ser resposta a uma ação do Rica NESTE chip —
 *  o reenvio da troca em espera, a convergência do esforço, a barra do chat
 *  (28/09). Quem recebe atualiza o dado, mas não fecha a gaveta que ele pode
 *  ter aberto nesse meio-tempo nem mexe no "salvando" de outra ação. */
export type ContextoDoPainel = { fundo: boolean };

const ouvintes = new Map<string, Set<(painel: AgentPainelResponse, contexto: ContextoDoPainel) => void>>();

export function publicarPainel(painel: AgentPainelResponse, opcoes: { fundo?: boolean } = {}): void {
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
  buscar(slug, controlador.signal).then((painel) => {
    if (!controlador.signal.aborted && painel.slug === slug) receber(painel, { fundo: false });
  }).catch(() => {
    if (!controlador.signal.aborted) falhar();
  });
  return () => {
    controlador.abort();
    inscritos.delete(atualizar);
    if (!inscritos.size) ouvintes.delete(slug);
  };
}
