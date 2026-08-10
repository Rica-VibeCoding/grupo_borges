'use client';

// A statusline da gaveta, ligada na tomada.
//
// O DEFEITO QUE ELA CONSERTA (10/08, reportado pelo Rica): *"logo após o botão
// clear no cockpit v2, ele não atualiza"*. A página do agente é `force-dynamic`,
// e por isso o `agente` que a gaveta desenhava vinha do `fetchFleet()` do
// servidor — fresco ao ABRIR e congelado dali em diante. Modelo, contexto e
// duração de sessão ficavam parados no retrato tirado na navegação: o `/clear`
// zerava o contexto de verdade e a barra continuava marcando o número velho, o
// Desligar tirava o agente do ar e a linha seguia contando sessão. O relógio
// nem andava — provado com Playwright na 3008, statusline parada em "02:41"
// enquanto a tropa ao lado atualizava em 5 s.
//
// A frota VIVA já existia e já cobria esta página (`FrotaProvider` no
// `app/layout.tsx`, poll de 5 s + SSE `/api/stream`) — o feed ao lado bebe dela
// desde sempre. Faltava a gaveta beber. Não entra poll novo aqui: entra o
// mesmo agente que a home usa.
//
// O QUE ESTA PEÇA NÃO FAZ: as ações rápidas continuam com o `/painel` delas
// (`bloco-de-acoes.tsx`). Aquela fonte é mais fresca (~2 s, lida direto do
// cc-status) e traz o que a frota não tem — permissão, sandbox, cota, vida. As
// duas convivem de propósito: telemetria pela frota, botão pelo painel.

import { useEffect, useState } from 'react';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { usaFrota } from './frota-provider';
import { relogioAncorado } from './relogio-ancorado';
import { Statusline } from './statusline';

/** DEZ segundos, não um. O relógio da gaveta é `HH:MM` (`formatDuration` com
 *  `withSeconds` falso), então um tique por segundo redesenharia 59 vezes para
 *  mudar o texto na sexagésima. Dez segundos deixam a virada do minuto atrasar
 *  no máximo isso — invisível em cima de um número que conta horas. */
const TICK_MS = 10_000;

export function StatuslineAoVivo({
  agente: doServidor,
  agora: agoraDoServidor,
  larguraDaBarra,
}: {
  /** O retrato do servidor. Continua sendo o primeiro quadro e o fallback: um
   *  agente que sumiu da frota não some da tela no meio da leitura. */
  agente: Agent;
  agora: number;
  larguraDaBarra?: number | null;
}) {
  const { agents } = usaFrota();
  const vivo = agents.find((a) => a.slug === doServidor.slug) ?? doServidor;

  // O tique é local porque o servidor emite uma vez e cala — mesmo desenho da
  // linha viva do feed (`components/feed/linha-viva.tsx`). O que ele
  // re-renderiza é uma linha de texto.
  const [montouEmMs] = useState(() => Date.now());
  const [agoraMs, setAgoraMs] = useState(montouEmMs);

  useEffect(() => {
    const relogio = setInterval(() => setAgoraMs(Date.now()), TICK_MS);
    return () => clearInterval(relogio);
  }, []);

  return (
    <Statusline
      agente={vivo}
      agora={relogioAncorado(agoraDoServidor, montouEmMs, agoraMs)}
      larguraDaBarra={larguraDaBarra}
    />
  );
}
