'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { EtiquetaDoEsforco } from './etiqueta-esforco';
import type { EtiquetaEsforco } from './motor';
import type { EstadoDaOperacao } from './operacao-de-motor.ts';
import { TEXTO_VALE_NO_BOOT } from './troca-de-motor';

/** A linha de baixo do chip — extraída de `SeletorMotor` (teto de 300 linhas).
 *  Quem manda nela, nesta ordem: a operação em curso (ela conta o AGORA, e a
 *  ressalva do boot diria o contrário do que está acontecendo), o recado da
 *  última troca e, por fim, a divergência do boot — calada enquanto o chip
 *  conta uma troca em curso, que é a notícia do momento. */
export function RessalvaDoSeletor({
  operacao,
  aoConfirmarOperacao,
  recado,
  divergindo,
}: {
  operacao: EstadoDaOperacao;
  aoConfirmarOperacao: () => void;
  /** O desfecho de uma troca feita com a gaveta já fechada (27/09). */
  recado: string | null;
  divergindo: boolean;
}) {
  if (operacao.aviso) {
    return (
      <span className="flex min-w-0 items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          role={operacao.fase === 'aplicando' ? 'status' : 'alert'}
          aria-live="polite"
          className="truncate"
          style={{
            color: operacao.fase === 'aplicando' ? 'var(--ck-text-secondary)' : 'var(--ck-state-attention)',
            fontSize: 'var(--ck-text-xs)',
          }}
        >
          {operacao.aviso}
        </span>
        {operacao.fase === 'confirmando' ? (
          // O alvo do segundo toque. A gaveta já fechou quando a gravação passou,
          // e escolher o mesmo valor de novo não dispara nada.
          <button
            type="button"
            onClick={aoConfirmarOperacao}
            className="ck-veil shrink-0 border"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-2)',
              borderRadius: 'var(--ck-radius-chip)',
              borderColor: 'var(--ck-edge-functional)',
              color: 'var(--ck-state-attention)',
              fontSize: 'var(--ck-text-xs)',
            }}
          >
            Confirmar?
          </button>
        ) : null}
      </span>
    );
  }
  if (recado) {
    return (
      <span role="status" aria-live="polite" style={{ color: 'var(--ck-state-attention)', fontSize: 'var(--ck-text-xs)' }}>
        {recado}
      </span>
    );
  }
  if (divergindo) {
    return (
      <span role="status" style={{ color: 'var(--ck-state-attention)', fontSize: 'var(--ck-text-xs)' }}>
        {TEXTO_VALE_NO_BOOT}
      </span>
    );
  }
  return null;
}

const RECADO_DURA_MS = 10_000;

/** O recado da última troca some sozinho: ele conta um desfecho, não um estado. */
export function usaRecado() {
  const [recado, setRecado] = useState<string | null>(null);
  useEffect(() => {
    if (!recado) return;
    const timer = setTimeout(() => setRecado(null), RECADO_DURA_MS);
    return () => clearTimeout(timer);
  }, [recado]);
  return [recado, setRecado] as const;
}

/** O motor sem controle — só leitura, quando o back não oferece troca. */
export function LeituraDoMotor(props: {
  rotuloModelo: string | null;
  rotuloDoEsforco: string | null;
  etiquetaEsforco: EtiquetaEsforco | null;
  tintaModelo: string;
  ressalva: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col" style={{ fontSize: 'var(--ck-text-sm)' }}>
      <div className="flex items-center" style={{ gap: '3px' }}>
        {props.rotuloModelo ? <span className="truncate" style={{ color: props.tintaModelo }}>{props.rotuloModelo}</span> : null}
        {props.rotuloDoEsforco ? <span style={{ color: 'var(--ck-text-secondary)' }}>{props.rotuloDoEsforco}</span> : null}
        {props.etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={props.etiquetaEsforco} /> : null}
      </div>
      {props.ressalva}
    </div>
  );
}
