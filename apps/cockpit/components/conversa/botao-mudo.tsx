'use client';

import { useEffect, type SyntheticEvent } from 'react';

import { aceitaAtalhoDoMudo, CONSULTA_COMPUTADOR_MUDO } from './atalho-do-mudo';
import styles from './botao-mudo.module.css';
import { ROTULO_DA_ENTRADA, toqueDoMicrofone, type EntradaDoMicrofone } from './entrada-do-microfone';

function isola(evento: SyntheticEvent) {
  evento.stopPropagation();
}

/** O microfone do canto: o mudo de sempre e, sem fone na vez dele, a entrada fechada que o toque
 *  abre para uma fala (`entrada-do-microfone.ts`). A tecla M segue sendo só o mudo. */
export function BotaoMudo({ mudo, aoMudar, ativo, entrada, aoUmaFala }: {
  mudo: boolean;
  aoMudar: (mudo: boolean) => void;
  ativo: boolean;
  entrada: EntradaDoMicrofone;
  aoUmaFala: (abrir: boolean) => void;
}) {
  useEffect(() => {
    if (!ativo) return;
    const computador = window.matchMedia(CONSULTA_COMPUTADOR_MUDO);
    const tecla = (evento: KeyboardEvent) => {
      if (!aceitaAtalhoDoMudo(evento, ativo, computador.matches)) return;
      evento.preventDefault();
      evento.stopPropagation();
      aoMudar(!mudo);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ativo, mudo, aoMudar]);

  const toque = toqueDoMicrofone(entrada);
  const fechada = entrada === 'fechada' || entrada === 'fechadaSemToque';
  const toca = () => {
    if (toque === 'mudar') aoMudar(!mudo);
    else if (toque !== 'nada') aoUmaFala(toque === 'abrirUmaFala');
  };

  return (
    <button
      type="button"
      className={styles.botao}
      data-entrada={entrada}
      aria-label={ROTULO_DA_ENTRADA[entrada]}
      aria-pressed={toque === 'mudar' ? mudo : entrada === 'umaFala'}
      aria-keyshortcuts="M"
      title={toque === 'mudar' ? `${mudo ? 'Ligar' : 'Silenciar'} microfone (M)` : ROTULO_DA_ENTRADA[entrada]}
      aria-disabled={toque === 'nada' || undefined}
      disabled={!ativo}
      onPointerDown={isola}
      onPointerUp={isola}
      onPointerCancel={isola}
      onClick={(evento) => { isola(evento); toca(); }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {fechada ? (
          <>
            {/* A cápsula do microfone com a boca tampada: fechada, não silenciada. */}
            <rect x="9" y="1" width="6" height="14" rx="3" />
            <path d="M5 12h14M12 19v3m-4 0h8" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2" opacity="0.4" />
          </>
        ) : mudo ? (
          <>
            <path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.12 2.12M9 5V4a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 4.9M19 10v2c0 .7-.1 1.37-.29 2" />
            <path d="M12 19v3m-4 0h8" />
          </>
        ) : (
          <>
            <rect x="9" y="1" width="6" height="14" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
          </>
        )}
      </svg>
    </button>
  );
}
