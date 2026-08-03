'use client';

// AS DELEGAÇÕES — alguém trabalhando a pedido DESTE agente, no pé do feed.
//
// Quando o Daniel manda trabalho pra Tara ou pro Hiro, a execução é um
// processo externo de minutos — e o chat parecia ocioso. Não é bloqueio, é
// presença: "tem coisa rodando, e você pode falar comigo enquanto isso".
//
// A gramática é a MESMA da linha viva (`linha-viva.tsx`), de propósito —
// filete azul à esquerda, texto discreto na cor de estado, o tempo tickando
// de segundo em segundo no relógio do cliente. Duas diferenças, as duas do
// brief: o texto é o nome do EXECUTOR trabalhando (não "Pensando"), e o item
// é clicável — leva pro `/agente/<alvo>`, que é onde se vê o que o executor
// está fazendo. O formatador do tempo é o `rotuloDoTempo` da linha viva,
// reaproveitado: um jeito de falar de tempo no app inteiro.
//
// O HOOK É A FONTE ÚNICA do "tem delegação ativa": o feed consome daqui, e a
// pílula do topo — quando for feita — bebe do MESMO `usaDelegacoes`, sem
// reescrever a busca. Poll de 3 s, sem SSE: é uma lista de zero a dois itens
// que muda de minuto em minuto; websocket seria peso morto.

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { Delegacao } from '@/app/api/delegacoes/delegacoes.ts';

import { rotuloDoTempo } from './linha-viva.ts';

const POLL_MS = 3_000;
const TICK_MS = 1_000;

/** As delegações vivas cujo DELEGADOR é `slug`. Falha de rede não zera a
 *  lista — manter o último estado bom por 3 s é melhor que piscar. */
export function usaDelegacoes(slug: string): Delegacao[] {
  const [delegacoes, setDelegacoes] = useState<Delegacao[]>([]);

  useEffect(() => {
    let montado = true;

    const busca = async () => {
      try {
        const res = await fetch(`/api/delegacoes?agente=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const corpo = (await res.json()) as { delegacoes?: Delegacao[] };
        if (montado) setDelegacoes(Array.isArray(corpo.delegacoes) ? corpo.delegacoes : []);
      } catch {
        // Rede caiu ou a API está fora: mantém o que já estava na tela.
      }
    };

    void busca();
    const timer = setInterval(() => void busca(), POLL_MS);
    return () => {
      montado = false;
      clearInterval(timer);
    };
  }, [slug]);

  return delegacoes;
}

/** Uma delegação — "Tara trabalhando · há 4 min", com o tempo contando
 *  sozinho como na linha viva: o que se re-renderiza no tick é um nó de
 *  texto, o feed virtualizado nem nota. */
export function DelegacaoView({
  quem,
  alvo,
  desdeMs,
}: {
  quem: string;
  alvo: string;
  desdeMs: number;
}) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setAgoraMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Link
      href={`/agente/${encodeURIComponent(alvo)}`}
      style={{ display: 'block', textDecoration: 'none' }}
    >
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
          {`${quem} trabalhando · ${rotuloDoTempo(agoraMs - desdeMs)}`}
        </p>
      </div>
    </Link>
  );
}
