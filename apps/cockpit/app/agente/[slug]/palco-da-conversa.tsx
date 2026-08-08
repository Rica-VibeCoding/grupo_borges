'use client';

// O palco: o feed ocupa a altura inteira e o composer FLUTUA por cima dele.
//
// Até 08/08 os dois eram irmãos numa coluna flex — o composer `shrink-0` com
// `--ck-surface-canvas` sólido, roubando altura do feed. Nada passava por baixo
// porque não havia "baixo": eles se dividiam a tela. O Rica mandou a referência
// do ChatGPT e do Telegram e cravou o pedido: *"o input texto fica por cima de
// uma transparência quando o texto vai descendo"*. Transparência só faz sentido
// se houver conteúdo atrás — daí a sobreposição vir ANTES da cor.
//
// A cor e o desfoque são do Daniel (pele, ownership §2). Aqui é só esqueleto:
// quem sobrepõe quem, e quanto respiro o feed ganha no fim para que a última
// mensagem não morra atrás do composer.
//
// ## `--ck-composer-altura` é o contrato entre as duas metades
//
// O composer não tem altura fixa: cresce com a textarea, com anexo, com chip de
// erro e com o seletor de esforço. Um respiro constante erraria nos dois
// sentidos — sobra de buraco na altura mínima, mensagem coberta na máxima. Este
// componente MEDE o wrapper e publica a altura como variável CSS; quem precisa
// de espaço lê a variável (`components/feed/feed.tsx`). O Daniel não mede nada.
//
// Por que `ResizeObserver` e não `useLayoutEffect` com `offsetHeight`: a altura
// muda por digitação e por anexo, eventos que não passam por render deste
// componente. Ler uma vez daria o valor de estreia e congelaria.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

export function PalcoDaConversa({
  composer,
  children,
}: {
  /** O `<Composer>` já montado no servidor — este arquivo não conhece as props
   *  dele, e é de propósito: mudar a assinatura do composer não deve tocar aqui. */
  composer: ReactNode;
  /** O feed. */
  children: ReactNode;
}) {
  const palcoRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);

  const publicaAltura = useCallback((altura: number) => {
    // A variável vai no PALCO, não no `:root`: duas rotas de agente abertas em
    // telas divididas teriam alturas diferentes, e o `:root` deixaria a última
    // a escrever vencer para as duas. O feed é descendente do palco, então a
    // herança entrega o valor certo sem estado global.
    palcoRef.current?.style.setProperty('--ck-composer-altura', `${Math.ceil(altura)}px`);
  }, []);

  useEffect(() => {
    const alvo = composerRef.current;
    if (!alvo) return;

    publicaAltura(alvo.getBoundingClientRect().height);

    const observador = new ResizeObserver((entradas) => {
      for (const entrada of entradas) {
        // `borderBoxSize` inclui padding e borda — é a altura que de fato tapa
        // o feed. `contentRect` mediria só o miolo e deixaria o respiro curto
        // exatamente pelo tamanho do padding do composer.
        const caixa = entrada.borderBoxSize?.[0];
        publicaAltura(caixa ? caixa.blockSize : entrada.contentRect.height);
      }
    });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [publicaAltura]);

  return (
    <div ref={palcoRef} className="relative min-h-0 flex-1">
      {/* O feed ocupa o palco inteiro, inclusive a faixa que fica atrás do
          composer. É essa altura sobrando que dá o que desfocar. */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{ containerType: 'inline-size', background: 'var(--ck-surface-canvas)' }}
      >
        {children}
      </div>

      {/* O composer. Sem `background` aqui: quem pinta é o próprio componente,
          e pintar nos dois lugares criaria uma camada opaca por baixo da
          translúcida — o desfoque existiria e não apareceria. Desde 08/08 o
          vidro tem a FORMA DA CAIXA e não há mais camada de fundo nenhuma
          nesta faixa: o feed passa nítido até encostar no composer.

          `position: absolute` e não `sticky`: `sticky` ancora no scrollport
          mais próximo (css-position-3 §3.4), que aqui é o viewport do Radix
          dentro do feed virtualizado — colocar o composer lá dentro o
          submeteria à virtualização. E não `fixed`: qualquer ancestral com
          `transform`, `filter` ou `contain` vira containing block e desloca o
          elemento (MDN, Containing block). `absolute` ancora no palco, que é
          exatamente a caixa que ele deve cobrir. */}
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0"
        style={{
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          paddingBottom: 'calc(var(--ck-space-3) + var(--ck-safe-bottom))',
        }}
      >
        {composer}
      </div>
    </div>
  );
}
