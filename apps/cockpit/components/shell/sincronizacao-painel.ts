import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

const ouvintes = new Map<string, Set<(painel: AgentPainelResponse) => void>>();

export function publicarPainel(painel: AgentPainelResponse): void {
  ouvintes.get(painel.slug)?.forEach((receber) => receber(painel));
}

export function sincronizarPainel(
  slug: string,
  buscar: (slug: string, signal: AbortSignal) => Promise<AgentPainelResponse>,
  receber: (painel: AgentPainelResponse) => void,
  falhar: () => void,
): () => void {
  const controlador = new AbortController();
  const atualizar = (painel: AgentPainelResponse) => {
    controlador.abort();
    receber(painel);
  };
  const inscritos = ouvintes.get(slug) ?? new Set();
  inscritos.add(atualizar);
  ouvintes.set(slug, inscritos);
  buscar(slug, controlador.signal).then((painel) => {
    if (!controlador.signal.aborted && painel.slug === slug) receber(painel);
  }).catch(() => {
    if (!controlador.signal.aborted) falhar();
  });
  return () => {
    controlador.abort();
    inscritos.delete(atualizar);
    if (!inscritos.size) ouvintes.delete(slug);
  };
}
