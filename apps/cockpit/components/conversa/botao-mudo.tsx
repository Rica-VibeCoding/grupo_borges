'use client';

import { useEffect, type SyntheticEvent } from 'react';

import { aceitaAtalhoDoMudo, CONSULTA_COMPUTADOR_MUDO } from './atalho-do-mudo';
import styles from './botao-mudo.module.css';

function isola(evento: SyntheticEvent) {
  evento.stopPropagation();
}

export function BotaoMudo({ mudo, aoMudar, ativo }: {
  mudo: boolean;
  aoMudar: (mudo: boolean) => void;
  ativo: boolean;
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

  return (
    <button
      type="button"
      className={styles.botao}
      aria-label="Silenciar microfone"
      aria-pressed={mudo}
      aria-keyshortcuts="M"
      title={`${mudo ? 'Ligar' : 'Silenciar'} microfone (M)`}
      disabled={!ativo}
      onPointerDown={isola}
      onPointerUp={isola}
      onPointerCancel={isola}
      onClick={(evento) => { isola(evento); aoMudar(!mudo); }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {mudo ? (
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
      <span aria-live="polite">{mudo ? 'Microfone mudo' : 'Microfone ligado'}</span>
      <kbd aria-hidden="true">M</kbd>
    </button>
  );
}
