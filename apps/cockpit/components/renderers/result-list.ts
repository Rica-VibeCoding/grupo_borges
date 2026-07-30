// Lógica do `result-list.tsx` — normaliza as 5 famílias do grupo G3 da matriz
// (lista de itens, 199 ocorrências) para um modelo de tela único:
//
//   WebSearch  → { query, results[], searchCount }        itens com title/url
//   ToolSearch → { query, matches[], total_deferred_tools } itens string
//   list_files → { method, paths[] }                        itens string
//   list_projects → { method, projects[] }                  objetos nome/id
//   tasks      → { tasks[] }                                array (vazio no fixture)
//
// Mora fora do `.tsx` de propósito: a suíte roda `node --test` sem JSX.
// O componente recebe o payload CRU por props — o pipeline ainda não entrega
// o `tool_use_result` aos itens (auditoria-tema-30-07.md); quando entregar,
// nada aqui muda.

export type ItemDaLista =
  | { tipo: 'link'; titulo: string; url: string }
  | { tipo: 'caminho'; caminho: string }
  | { tipo: 'objeto'; nome: string; detalhe?: string }
  | { tipo: 'texto'; texto: string };

export type ListaNormalizada = {
  /** A pergunta que gerou a lista (query da busca, method da chamada). */
  titulo?: string;
  /** Contagem reportada pela ferramenta (searchCount, total_deferred_tools). */
  total?: number;
  itens: ItemDaLista[];
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Um item de resultado do WebSearch. O fixture real mostra duas formas:
 *  objeto `{ title, url }` direto e objeto `{ tool_use_id, content: [...] }`
 *  cujo content é um array de `{ title, url }`. Strings soltas (trecho
 *  redigido) viram `texto`. */
function itemDeBusca(valor: unknown): ItemDaLista[] {
  if (typeof valor === 'string') {
    return valor.length > 0 ? [{ tipo: 'texto', texto: valor }] : [];
  }
  if (!ehObjeto(valor)) return [];
  if (typeof valor.title === 'string' && typeof valor.url === 'string') {
    return [{ tipo: 'link', titulo: valor.title, url: valor.url }];
  }
  if (Array.isArray(valor.content)) {
    return valor.content.flatMap((sub): ItemDaLista[] => {
      if (ehObjeto(sub) && typeof sub.title === 'string' && typeof sub.url === 'string') {
        return [{ tipo: 'link' as const, titulo: sub.title, url: sub.url }];
      }
      if (typeof sub === 'string' && sub.length > 0) {
        return [{ tipo: 'texto' as const, texto: sub }];
      }
      return [];
    });
  }
  return [];
}

function textoOuCaminho(valor: unknown): ItemDaLista | null {
  return typeof valor === 'string' && valor.length > 0
    ? { tipo: 'caminho', caminho: valor }
    : null;
}

/** Aceita o `tool_use_result` cru de qualquer uma das 5 famílias G3. Devolve
 *  null quando o payload não é lista — o chamador cai pro corpo genérico. */
export function normalizarListaResultado(valor: unknown): ListaNormalizada | null {
  if (!ehObjeto(valor)) return null;

  // WebSearch — a mais quente do grupo (165 ocorrências).
  if (Array.isArray(valor.results)) {
    return {
      titulo: typeof valor.query === 'string' ? valor.query : undefined,
      total: typeof valor.searchCount === 'number' ? valor.searchCount : undefined,
      itens: valor.results.flatMap(itemDeBusca),
    };
  }

  // ToolSearch — matches é array de NOMES de tool (caminho mono, não link).
  if (Array.isArray(valor.matches)) {
    return {
      titulo: typeof valor.query === 'string' ? valor.query : undefined,
      total:
        typeof valor.total_deferred_tools === 'number' ? valor.total_deferred_tools : undefined,
      itens: valor.matches.flatMap((m) => {
        const item = textoOuCaminho(m);
        return item ? [item] : [];
      }),
    };
  }

  // DesignSync list_files — paths é array de caminhos.
  if (Array.isArray(valor.paths)) {
    return {
      titulo: typeof valor.method === 'string' ? valor.method : undefined,
      itens: valor.paths.flatMap((p) => {
        const item = textoOuCaminho(p);
        return item ? [item] : [];
      }),
    };
  }

  // DesignSync list_projects — objetos nomeados.
  if (Array.isArray(valor.projects)) {
    return {
      titulo: typeof valor.method === 'string' ? valor.method : undefined,
      itens: valor.projects.flatMap((p) => {
        if (ehObjeto(p) && typeof p.name === 'string') {
          const detalhe = typeof p.projectId === 'string' ? p.projectId : undefined;
          return [{ tipo: 'objeto' as const, nome: p.name, detalhe }];
        }
        if (typeof p === 'string' && p.length > 0) {
          return [{ tipo: 'objeto' as const, nome: p }];
        }
        return [];
      }),
    };
  }

  // tasks — array; vazio no fixture, mas a forma existe e não pode quebrar.
  if (Array.isArray(valor.tasks)) {
    return {
      itens: valor.tasks.flatMap((t): ItemDaLista[] => {
        if (typeof t === 'string' && t.length > 0) return [{ tipo: 'texto' as const, texto: t }];
        if (ehObjeto(t) && typeof t.title === 'string') {
          return [{ tipo: 'objeto' as const, nome: t.title }];
        }
        return [];
      }),
    };
  }

  return null;
}
