// Lógica do `published-page.tsx` — normaliza o `tool_use_result` da página
// publicada (G8 da matriz, família `…_liveSubscription_path_title_updated_url`,
// 3 ocorrências — a mais rara). Mora fora do `.tsx` de propósito: a suíte roda
// `node --test` sem transpilação de JSX, então o que precisa de prova não pode
// morar dentro de componente.
//
// Par visual da tool `Artifact` (tool-chip.tsx, ainda não construído) — este
// arquivo é só o corpo do resultado.

export type PaginaPublicadaNormalizada = {
  titulo: string;
  url: string;
  caminho: string;
  versao: string;
  atualizado: boolean;
  liveSubscription: string;
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function ehStringPreenchida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

/** Aceita o `tool_use_result` cru. Devolve null quando não é página publicada
 *  — o chamador cai pro corpo genérico. As 6 chaves aparecem juntas na única
 *  fixture vista; sem evidência de campo opcional, valida todas. */
export function normalizarPaginaPublicada(valor: unknown): PaginaPublicadaNormalizada | null {
  if (!ehObjeto(valor)) return null;
  if (!ehStringPreenchida(valor.url)) return null;
  if (!ehStringPreenchida(valor.title)) return null;
  if (typeof valor.path !== 'string') return null;
  if (typeof valor.version !== 'string') return null;
  if (typeof valor.updated !== 'boolean') return null;
  if (typeof valor.liveSubscription !== 'string') return null;

  return {
    titulo: valor.title,
    url: valor.url,
    caminho: valor.path,
    versao: valor.version,
    atualizado: valor.updated,
    liveSubscription: valor.liveSubscription,
  };
}
