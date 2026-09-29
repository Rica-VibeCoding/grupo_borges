export function hrefDoPainel(href: string, pathname: string | null, busca: string): string {
  const destino = new URL(href, 'http://cockpit.local');
  const agenteAtual = pathname?.match(/^\/(?:agente|conversa)\/([^/]+)$/)?.[1];
  const agenteDestino = destino.pathname.match(/^\/(?:agente|conversa)\/([^/]+)$/)?.[1];
  if (!href.startsWith('/') || href.startsWith('//') || !agenteAtual || agenteAtual !== agenteDestino) return href;

  const parametros = new URLSearchParams(busca);
  const painel = destino.searchParams.get('painel');
  if (painel === null) parametros.delete('painel');
  else parametros.set('painel', painel);
  const consulta = parametros.toString();
  return `${pathname}${consulta ? `?${consulta}` : ''}${destino.hash}`;
}
