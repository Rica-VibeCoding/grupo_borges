'use client';

/**
 * Fade cruzado de um texto que troca (28/09) — hoje, a 2ª linha do cartão da
 * tropa indo de "aguarda você" para modelo e relógio, e de volta.
 *
 * Só opacidade. O texto que entra ocupa o fluxo e acende; o que sai fica por
 * cima, fora do fluxo (`absolute`), apagando — assim a troca não mexe em
 * largura nem em altura de nada em volta. A cópia que sai é o nó da troca
 * anterior, guardado sem re-renderizar: congelado, que é o certo para quem
 * está indo embora.
 *
 * Na montagem não há troca e nada anima. O `animationcancel` também limpa: se
 * a coluna sair de cena no meio (`display: none`), o `animationend` nunca vem
 * e o texto velho ficaria colado por cima do novo.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Face = { chave: string; conteudo: ReactNode };

export function TrocaCruzada({
  chave,
  className,
  style,
  children,
}: {
  /** Muda quando o TEXTO muda de natureza — não a cada tique do relógio. */
  chave: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ultima = useRef<Face>({ chave, conteudo: children });
  const [saindo, setSaindo] = useState<Face | null>(null);

  // Efeito de layout: a cópia que sai entra na tela no mesmo quadro em que o
  // texto novo aparece, antes da pintura — sem quadro com os dois ausentes.
  useLayoutEffect(() => {
    if (ultima.current.chave !== chave) setSaindo(ultima.current);
    ultima.current = { chave, conteudo: children };
  });

  const encerra = () => setSaindo(null);

  return (
    <span className="relative flex min-w-0" style={{ alignItems: 'baseline' }}>
      <span key={chave} className={[className, saindo ? 'ck-troca-estado-entra' : ''].filter(Boolean).join(' ')} style={style}>
        {children}
      </span>
      {saindo ? (
        <span
          key={`sai-${saindo.chave}`}
          aria-hidden="true"
          className={[className, 'ck-troca-estado-sai'].filter(Boolean).join(' ')}
          // Sem `right`: na largura natural, o texto velho apaga inteiro em vez
          // de virar reticências na largura do novo.
          style={{ ...style, position: 'absolute', top: 0, left: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}
          onAnimationEnd={encerra}
          // O React não tem `onAnimationCancel`; vai pelo DOM.
          ref={(no) => {
            if (!no) return;
            no.addEventListener('animationcancel', encerra);
            return () => no.removeEventListener('animationcancel', encerra);
          }}
        >
          {saindo.conteudo}
        </span>
      ) : null}
    </span>
  );
}
