'use client';

// A LINHA VIVA — a última linha do feed quando a corrida trabalha e nenhuma
// ferramenta apareceu ainda: "Pensando há 12 s".
//
// É a MESMA gramática da linha de ferramenta em voo (grupo-ferramentas.tsx):
// filete azul à esquerda, texto na cor de estado, o pulso do
// `data-estado="trabalhando"`. Não é botão — não há nada para expandir — e
// não é `role="status"`: essa linha já é dos avisos da voz, no composer, e
// um aria-live com texto que muda a cada segundo seria um locutor que não
// cala.
//
// O TEMPO CONTA SOZINHO AQUI: o servidor emite uma vez e cala, então o tick
// é um `setInterval` de 1 s local. O que se re-renderiza é um nó de texto —
// o feed virtualizado nem nota. A âncora (`desdeMs`) vem da última mensagem
// do stream, calculada em `linha-viva.ts` — a mesma peça que decide QUANDO
// esta linha existe.

import { useEffect, useState } from 'react';

import { rotuloDoTempo } from './linha-viva.ts';

const TICK_MS = 1_000;

export function LinhaVivaView({ desdeMs }: { desdeMs: number }) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setAgoraMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ borderLeft: '2px solid var(--ck-state-running)' }}>
      <p
        className="ck-pulso truncate"
        data-estado="trabalhando"
        style={{
          margin: 0,
          minHeight: '32px',
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          fontSize: 'var(--ck-text-sm)',
          lineHeight: 'var(--ck-leading-body)',
          color: 'var(--ck-state-running)',
        }}
      >
        {`Pensando ${rotuloDoTempo(agoraMs - desdeMs)}`}
      </p>
    </div>
  );
}
