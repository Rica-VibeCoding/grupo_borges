// Lógica do `fetch-result.tsx` — normaliza o `tool_use_result` rico do WebFetch
// (família `result__bytes_code_codeText_durationMs_result`, 245 ocorrências na
// matriz) para um modelo de tela. Mora fora do `.tsx` de propósito: a suíte
// roda `node --test` sem transpilação de JSX, então o que precisa de prova não
// pode morar dentro de componente.
//
// O componente recebe o payload CRU por props — o pipeline ainda não entrega o
// `tool_use_result` aos itens (auditoria-tema-30-07.md, ressalva estrutural);
// quando entregar, nada aqui muda.

export type FetchNormalizado = {
  url: string;
  codigo: number;
  textoDoCodigo: string;
  bytes: number;
  duracaoMs: number;
  corpo: string;
};

/** 2xx é saúde, 3xx é desvio (nem bom nem ruim), o resto é falha. */
export function tomDoStatus(codigo: number): 'ok' | 'neutro' | 'erro' {
  if (codigo >= 200 && codigo < 300) return 'ok';
  if (codigo >= 300 && codigo < 400) return 'neutro';
  return 'erro';
}

/** 2.954.287 → "2,8 MB" — vírgula, que é como o Rica lê. */
export function formatoBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const casas = (n: number) => n.toFixed(1).replace('.', ',');
  if (bytes < 1024 * 1024) return `${casas(bytes / 1024)} kB`;
  return `${casas(bytes / (1024 * 1024))} MB`;
}

/** 4211 → "4,2 s"; abaixo de um segundo, milissegundos cheios. */
export function formatoDuracao(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Aceita o `tool_use_result` cru. Devolve null quando não é um fetch — o
 *  chamador (a ponte do feed) cai pro corpo genérico. `url`, `code` e
 *  `result` são o núcleo visto em TODAS as 245 ocorrências; os demais campos
 *  têm default porque um fetch abortado pode vir sem eles. */
export function normalizarFetchResult(valor: unknown): FetchNormalizado | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const bruto = valor as Record<string, unknown>;
  if (typeof bruto.url !== 'string' || bruto.url.length === 0) return null;
  if (typeof bruto.code !== 'number') return null;
  if (typeof bruto.result !== 'string') return null;
  return {
    url: bruto.url,
    codigo: bruto.code,
    textoDoCodigo: typeof bruto.codeText === 'string' ? bruto.codeText : '',
    bytes: typeof bruto.bytes === 'number' ? bruto.bytes : 0,
    duracaoMs: typeof bruto.durationMs === 'number' ? bruto.durationMs : 0,
    corpo: bruto.result,
  };
}
