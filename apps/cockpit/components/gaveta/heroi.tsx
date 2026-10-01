'use client';

/**
 * O topo da gaveta, numa linha só: a pílula do agente (a mesma da tela de voz),
 * o interruptor da sessão e o ×. Embaixo, a statusline (modelo · sessão ·
 * contexto), única fonte do modelo na gaveta, com a barra de contexto na
 * largura toda.
 *
 * Na gaveta a pílula fica parada: sem ondas nem barras, só o aro e a palavra na
 * cor do estado — a mesma palavra da pílula da voz (`shell/estado-da-pilula`). A bolinha vermelha "!" segue na foto quando há algo que pede
 * olho; o texto do porquê está no cartão abaixo.
 */
import type { ReactNode } from 'react';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { PilulaDoAgente } from '../shell/pilula-do-agente';
import { StatuslineAoVivo } from '../shell/statusline-ao-vivo';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { usaEstadoDaPilula } from '../shell/usa-estado-da-pilula';
import { BolinhaDeAlerta } from './pecas';

export function Heroi({
  agente,
  agora,
  fecharHref,
  alerta,
  interruptor,
}: {
  agente: Agent;
  agora: number;
  fecharHref: string;
  alerta: boolean;
  interruptor: ReactNode;
}) {
  // A mesma régua da pílula da voz: frota viva + cena da voz aberta. O alerta fica com o "!".
  const { tom, rotulo } = usaEstadoDaPilula(agente.slug);
  return (
    <header className="flex shrink-0 flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-1)' }}>
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
        <div className="flex min-w-0 flex-1 items-center">
          <PilulaDoAgente
            slug={agente.slug}
            nome={agente.name}
            tom={tom}
            rotulo={rotulo}
            lugar="gaveta"
            selo={
              alerta ? <BolinhaDeAlerta style={{ top: '-6px', right: '-6px', width: '16px', height: '16px', fontSize: '10px' }} /> : null
            }
          />
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
