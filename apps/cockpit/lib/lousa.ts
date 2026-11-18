/**
 * A LOUSA DO TED — o critério e o trecho que ele fala. Puro, sem React.
 *
 * O Ted escreve a explicação num bloco de código emoldurado à mão:
 *
 *   ┌──── POR QUE O CÉU É AZUL ────┐
 *   │ A luz do sol tem TODAS as    │
 *   └──────────────────────────────┘
 *
 * O critério é a MOLDURA no conteúdo, não a linguagem do fence: a primeira
 * linha abre com `┌` e fecha com `┐`, a última abre com `└` e fecha com `┘`.
 * Código de verdade não começa assim, e um diagrama solto (sem fechar a caixa)
 * continua código. Mesmo assim o critério só é consultado onde o perfil liga a
 * lousa (`perfil-do-agente.ts`): diagrama emoldurado do Fred segue código.
 */

export function ehLousa(texto: string): boolean {
  const linhas = texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '');
  if (linhas.length < 2) return false;
  const primeira = linhas[0]!;
  const ultima = linhas[linhas.length - 1]!;
  return (
    primeira.startsWith('┌') && primeira.endsWith('┐') && ultima.startsWith('└') && ultima.endsWith('┘')
  );
}

type NoDoHast = { type: string; value?: string; children?: NoDoHast[] } | undefined;

/** O texto cru de `pre > code` no hast que o react-markdown entrega ao override. */
export function textoDoPre(pre: NoDoHast): string {
  const codigo = pre?.children?.[0];
  const texto = codigo?.type === 'element' ? codigo.children?.[0] : undefined;
  return texto?.type === 'text' ? (texto.value ?? '') : '';
}

/** A linha mais larga da lousa, em colunas — é o que dimensiona a letra para
 *  a caixa caber inteira na largura do iPhone sem rolar nem entortar. */
export function colunasDaLousa(texto: string): number {
  return texto.split('\n').reduce((maior, linha) => Math.max(maior, [...linha.trimEnd()].length), 0);
}

/** Teto do trecho falado: saudação e fechamento, nunca a aula inteira. */
export const TETO_DO_TRECHO = 220;

/** Tira os blocos cercados (``` ou ~~~), inclusive o que ainda não fechou. */
function semBlocosDeCodigo(texto: string): string {
  const fora: string[] = [];
  let cerca: string | null = null;
  for (const linha of texto.split('\n')) {
    const marca = /^ {0,3}(`{3,}|~{3,})/.exec(linha)?.[1];
    if (cerca === null) {
      if (marca) cerca = marca;
      else fora.push(linha);
    } else if (marca && marca[0] === cerca[0] && marca.length >= cerca.length && linha.trim() === marca) {
      cerca = null;
    }
  }
  return fora.join('\n');
}

const PICTOGRAFICO = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * O trecho que toca sozinho: o texto FORA dos blocos de código (a lousa nunca
 * é lida — é de ver), sem marcação, sem emoji (a voz leria "bola de futebol"),
 * cortado em frase inteira até o teto. `null` quando não sobra nada a dizer.
 */
export function trechoFalado(texto: string, teto = TETO_DO_TRECHO): string | null {
  const limpo = semBlocosDeCodigo(texto)
    .split('\n')
    .map((linha) =>
      linha
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*\[![A-Za-z]+\]\s*/, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''),
    )
    .join('\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(PICTOGRAFICO, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo === '') return null;

  const frases = limpo.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((f) => f.trim()).filter(Boolean) ?? [];
  let trecho = '';
  for (const frase of frases) {
    const junto = trecho === '' ? frase : `${trecho} ${frase}`;
    if (junto.length > teto) break;
    trecho = junto;
  }
  if (trecho !== '') return trecho;
  // Uma frase só, mais longa que o teto: corta na palavra.
  const corte = limpo.slice(0, teto);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > 0 ? corte.slice(0, espaco) : corte).trim()}…`;
}
