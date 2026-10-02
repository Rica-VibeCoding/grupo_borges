/**
 * A etiqueta do esforço — uma palavra ao lado do valor, ou nada.
 *
 * Cópia de gramática, não de conteúdo: a etiqueta `antigo` do contexto
 * (`statusline.tsx`) é o molde que o Rica aprovou em 09/08 — palavra curta em
 * cor discreta ao lado do número, explicação por extenso só no `title`. Aqui a
 * cor é a secundária: a etiqueta mora na caixa do composer, onde a terciária
 * não passa 4.5:1 (estética §2). O que
 * muda é o estado carregado: aqui é a comparação entre o esforço pedido e o
 * que a sessão de fato roda (`etiquetaDoEsforco`, em `motor.ts`).
 *
 * Texto explicativo na tela continua revogado (ordem de 30/07): quem quer o
 * detalhe paira sobre a palavra; quem lê de tela a ouve como parte do botão.
 */
import type { EtiquetaEsforco } from './motor';

export function EtiquetaDoEsforco({ etiqueta }: { etiqueta: EtiquetaEsforco }) {
  return (
    <span
      className="shrink-0"
      style={{ color: 'var(--ck-text-secondary)' }}
      title={etiqueta.titulo}
    >
      {etiqueta.palavra}
    </span>
  );
}
