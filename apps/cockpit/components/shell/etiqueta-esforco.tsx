/**
 * A etiqueta do esforço — uma palavra ao lado do valor, ou nada.
 *
 * Cópia de gramática, não de conteúdo: a etiqueta `antigo` do contexto
 * (`statusline.tsx`) é o molde que o Rica aprovou em 09/08 — palavra curta em
 * cor terciária ao lado do número, explicação por extenso só no `title`. O que
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
      style={{ color: 'var(--ck-text-tertiary)' }}
      title={etiqueta.titulo}
    >
      {etiqueta.palavra}
    </span>
  );
}
