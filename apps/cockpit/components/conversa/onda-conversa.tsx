import type { CSSProperties } from 'react';
import type { Estado } from '@/lib/conversa/tipos';

import styles from './onda-conversa.module.css';

const PERFIL = [0.22, 0.42, 0.66, 0.34, 0.78, 0.48, 0.92, 0.6, 1, 0.56, 0.86, 0.4, 0.72, 0.3, 0.58];

function corDoEstado(estado: Estado): string {
  switch (estado) {
    case 'ouvindo':
      return 'var(--ck-state-running)';
    case 'transcrevendo':
    case 'esperandoZe':
      return 'var(--ck-state-thinking)';
    case 'falando':
      return 'var(--ck-state-ok)';
    case 'erro':
      return 'var(--ck-state-fail)';
    default:
      return 'var(--ck-text-secondary)';
  }
}

export function OndaConversa({
  estado,
  nivel,
  preparando,
}: {
  estado: Estado;
  nivel: number;
  preparando: boolean;
}) {
  const animada = preparando || estado === 'esperandoZe' || estado === 'falando';

  return (
    <div
      aria-hidden="true"
      className={`${styles.onda} ${animada ? styles.animada : ''}`}
      style={{ color: preparando ? 'var(--ck-state-thinking)' : corDoEstado(estado) }}
    >
      {PERFIL.map((altura, indice) => {
        const escala = estado === 'ouvindo'
          ? 0.12 + altura * (0.22 + nivel * 0.9)
          : estado === 'erro' || estado === 'parado'
            ? 0.12 + altura * 0.12
            : 0.18 + altura * 0.38;
        const variaveis = {
          '--onda-min': String(0.12 + altura * 0.18),
          '--onda-max': String(0.38 + altura * 0.62),
          '--onda-atraso': `${indice * -72}ms`,
          transform: `scaleY(${escala})`,
        } as CSSProperties;
        return <span className={styles.barra} style={variaveis} key={indice} />;
      })}
    </div>
  );
}
