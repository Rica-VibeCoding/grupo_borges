'use client';

/**
 * O topo DISCRETO da gaveta (branch `ideia/gaveta-discreta`, 01/10): o Rica
 * achou o círculo-herói com halo chamativo e grande demais — comia quase um
 * terço da gaveta. Aqui ele vira um cabeçalho de uma linha só: retrato pequeno
 * com um anel fino laranja, a bolinha de estado, o nome, o interruptor da
 * sessão e o ×. Embaixo, a statusline (modelo · sessão · contexto), única
 * fonte do modelo na gaveta, com a barra de contexto na largura toda.
 *
 * O anel apaga quando o agente está fora do ar — laranja é identidade viva. A
 * bolinha vermelha "!" segue no retrato quando há algo que pede olho; o texto
 * do porquê está no cartão abaixo.
 */
import type { ReactNode } from 'react';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { Retrato } from '../shell/retrato';
import { StatuslineAoVivo } from '../shell/statusline-ao-vivo';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { BolinhaDeAlerta } from './pecas';

/** 40px de retrato; com folga e anel o conjunto fica em ~47px. */
const RETRATO = 40;

export function Heroi({
  agente,
  agora,
  fecharHref,
  foraDoAr,
  alerta,
  estado,
  interruptor,
}: {
  agente: Agent;
  agora: number;
  fecharHref: string;
  foraDoAr: boolean;
  alerta: boolean;
  /** Tom e frase do pulso (`ativo`/`parado`/`sem-sinal`); `null` enquanto não leu. */
  estado: { tom: string; frase: string } | null;
  interruptor: ReactNode;
}) {
  const tom = foraDoAr ? 'fora' : (estado?.tom ?? 'parado');
  return (
    <header className="flex shrink-0 flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-1)' }}>
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
        <div className="relative shrink-0">
          <div
            className="ck-gv-anel overflow-hidden rounded-full"
            data-fora={String(foraDoAr)}
            style={{ width: `${RETRATO}px`, height: `${RETRATO}px` }}
          >
            <Retrato slug={agente.slug} nome={agente.name} tamanho={RETRATO} opacidade={foraDoAr ? 0.55 : 1} />
          </div>
          {alerta ? <BolinhaDeAlerta style={{ top: '-6px', right: '-6px', width: '16px', height: '16px', fontSize: '10px' }} /> : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <span
            role="img"
            aria-label={foraDoAr ? 'Fora do ar' : (estado?.frase ?? 'Lendo o estado')}
            title={foraDoAr ? 'Fora do ar' : estado?.frase}
            className="ck-gv-ponto shrink-0 rounded-full"
            data-tom={tom}
            style={{ width: '8px', height: '8px' }}
          />
          <h2
            className="min-w-0 truncate"
            style={{
              fontSize: 'var(--ck-text-md)',
              fontWeight: 600,
              letterSpacing: 'var(--ck-track-title)',
              color: 'var(--ck-text-primary)',
            }}
          >
            {agente.name}
          </h2>
        </div>

        {interruptor}

        <LinkFechaPainel
          href={fecharHref}
          rotulo="detalhes"
          className="ck-veil flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 'var(--ck-touch-min)',
            height: 'var(--ck-touch-min)',
            marginRight: 'calc(var(--ck-space-2) * -1)',
            fontSize: 'var(--ck-text-lg)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          ×
        </LinkFechaPainel>
      </div>

      <div className="flex w-full flex-col">
        <StatuslineAoVivo agente={agente} agora={agora} larguraDaBarra={null} />
      </div>
    </header>
  );
}
