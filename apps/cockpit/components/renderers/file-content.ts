// Lógica do `file-content.tsx` — normaliza as duas famílias G5 (conteúdo de
// arquivo) para um modelo único de tela. Mora fora do `.tsx` de propósito: a
// suíte roda `node --test` sem transpilação de JSX, então o que precisa de
// prova não pode morar dentro de componente.
//
// Duas formas de origem, um núcleo comum (caminho + conteúdo + nº de linhas):
// `Read` (`type`+`file.{filePath,content,totalLines}`) e MCP `get_file`
// (`method`+`path`+`content`). O componente recebe o `tool_use_result` cru
// por props — o pipeline já entrega (render-items.ts:177, `entry.rich`).

export type ConteudoDeArquivoNormalizado = {
  caminho: string;
  conteudo: string;
  totalDeLinhas: number;
  /** `type: 'image'` (Read) ou `isBase64: true` (MCP) — ramo previsto pela
   *  matriz, sem fixture real ainda (auditoria-tema-30-07.md). Sem conteúdo
   *  de texto pra mostrar, só o aviso. */
  binario: boolean;
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function ehStringPreenchida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

function contarLinhas(texto: string): number {
  return texto.length === 0 ? 0 : texto.split('\n').length;
}

function normalizarLeituraDeArquivo(
  valor: Record<string, unknown>,
): ConteudoDeArquivoNormalizado | null {
  if (typeof valor.type !== 'string') return null;
  const arquivo = valor.file;
  if (!ehObjeto(arquivo)) return null;
  if (!ehStringPreenchida(arquivo.filePath)) return null;
  if (typeof arquivo.totalLines !== 'number') return null;

  const binario = valor.type !== 'text' || typeof arquivo.content !== 'string';
  return {
    caminho: arquivo.filePath,
    conteudo: binario ? '' : (arquivo.content as string),
    totalDeLinhas: arquivo.totalLines,
    binario,
  };
}

function normalizarLeituraMcp(
  valor: Record<string, unknown>,
): ConteudoDeArquivoNormalizado | null {
  if (valor.method !== 'get_file') return null;
  if (!ehStringPreenchida(valor.path)) return null;
  if (typeof valor.content !== 'string') return null;

  const binario = valor.isBase64 === true;
  return {
    caminho: valor.path,
    conteudo: binario ? '' : valor.content,
    totalDeLinhas: binario ? 0 : contarLinhas(valor.content),
    binario,
  };
}

/** Aceita o `tool_use_result` cru das duas famílias G5. Devolve null quando
 *  não é conteúdo de arquivo, para o chamador cair no corpo genérico. */
export function normalizarConteudoDeArquivo(
  valor: unknown,
): ConteudoDeArquivoNormalizado | null {
  if (!ehObjeto(valor)) return null;
  return normalizarLeituraDeArquivo(valor) ?? normalizarLeituraMcp(valor);
}
