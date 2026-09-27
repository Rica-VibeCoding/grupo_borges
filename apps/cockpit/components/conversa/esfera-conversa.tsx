import type { CSSProperties } from 'react';
import type { Estado } from '@/lib/conversa/tipos';
import styles from './esfera-conversa.module.css';

export function EsferaConversa({ estado, nivel, preparando }: {
  estado: Estado;
  nivel: number;
  preparando: boolean;
}) {
  const cor = preparando || estado === 'esperandoZe' || estado === 'transcrevendo'
    ? 'var(--ck-state-thinking)'
    : estado === 'ouvindo' || estado === 'interrompendo'
      ? 'var(--ck-state-running)'
      : estado === 'falando' ? 'var(--ck-state-ok)'
        : estado === 'erro' ? 'var(--ck-state-fail)' : 'var(--ck-text-secondary)';
  const volume = Math.min(1, Math.max(0, nivel));
  return (
    <div aria-hidden="true" className={styles.area} data-estado={estado}>
      <div className={styles.esfera} style={{
        color: cor,
        '--esfera-escala': 1 + volume * 0.22,
        '--esfera-volume': volume,
      } as CSSProperties} />
    </div>
  );
}
