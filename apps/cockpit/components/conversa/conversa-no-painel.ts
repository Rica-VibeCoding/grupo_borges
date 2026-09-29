import { painelDaUrl } from './rota-do-pager.ts';

export function mostraConversaNoPainel(caminho: string, busca: string): boolean {
  const slug = /^\/(?:agente|conversa)\/([^/]+)$/.exec(caminho)?.[1];
  return !!slug && painelDaUrl(caminho, busca, slug) === 'voz'
    && new URLSearchParams(busca).get('painel') === 'detalhes';
}
