/**
 * A regra do pager do agente, sem DOM: qual painel a URL pede, qual URL cada painel mostra e
 * quando a rolagem assentou num painel. Chat em `/agente/{slug}`, voz em `/conversa/{slug}` —
 * a mesma página, montada uma vez; o pager só troca a URL, sem navegar e sem empilhar
 * histórico (`replaceState`, adendo do Rica de 27/09).
 */

export type Painel = 'chat' | 'voz';

/** `?tela=voz`: a entrada direta. `/conversa/{slug}` redireciona para o chat com ele. */
export const TELA = 'tela';

/** O painel que a URL pede para este agente; `null` quando a URL é de outra página. */
export function painelDaUrl(caminho: string, busca: string, slug: string): Painel | null {
  if (caminho === `/conversa/${slug}`) return 'voz';
  if (caminho !== `/agente/${slug}`) return null;
  return new URLSearchParams(busca).get(TELA) === 'voz' ? 'voz' : 'chat';
}

/** A URL do painel, com o resto da busca (`?diag=`, por exemplo) e sem a marca de entrada. */
export function urlDoPainel(painel: Painel, slug: string, busca: string): string {
  const parametros = new URLSearchParams(busca);
  parametros.delete(TELA);
  const resto = parametros.toString();
  return `${painel === 'voz' ? '/conversa' : '/agente'}/${slug}${resto ? `?${resto}` : ''}`;
}

/** Assentou: a rolagem está a até 1 px de um painel. No meio do caminho, `null`. */
export function painelAssentado(rolagem: number, largura: number): Painel | null {
  if (largura <= 0) return null;
  const indice = Math.round(rolagem / largura);
  if (Math.abs(rolagem - indice * largura) > 1) return null;
  return indice <= 0 ? 'chat' : 'voz';
}

/**
 * A URL com a tropa aberta ou fechada. A gaveta lê `?nav=aberto` — o mesmo estado otimista
 * do `≡` —, e o gesto troca só esse parâmetro.
 */
export function urlComTropa(caminho: string, busca: string, aberta: boolean): string {
  const parametros = new URLSearchParams(busca);
  if (aberta) parametros.set('nav', 'aberto');
  else parametros.delete('nav');
  const resto = parametros.toString();
  return `${caminho}${resto ? `?${resto}` : ''}`;
}
