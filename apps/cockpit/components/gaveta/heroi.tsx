'use client';

/**
 * O topo da gaveta, numa linha só: a pílula do agente (a mesma da tela de voz),
 * o interruptor da sessão e o ×. Embaixo, a statusline (modelo · sessão ·
 * contexto), única fonte do modelo na gaveta, com a barra de contexto na
 * largura toda.
 *
 * Na gaveta a pílula fica parada: sem ondas nem barras, só o aro e a palavra na
 * cor do estado. A bolinha vermelha "!" segue na foto quando há algo que pede
 * olho; o texto do porquê está no cartão abaixo.
 */
import type { ReactNode } from 'react';

import type { Agent, AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

import { usaFrota } from '../shell/frota-provider';
import { PilulaDoAgente, type TomDeEstado } from '../shell/pilula-do-agente';
import { StatuslineAoVivo } from '../shell/statusline-ao-vivo';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { BolinhaDeAlerta } from './pecas';

/** 40px de foto: a pílula fica com 52px de altura. */
const FOTO = 40;

const DO_STATUS: Record<AgentStatus, { tom: TomDeEstado; rotulo: string }> = {
  trabalhando: { tom: 'ze', rotulo: 'trabalhando' },
  aguardando: { tom: 'voce', rotulo: 'esperando você' },
  ocioso: { tom: 'prepara', rotulo: 'na linha' },
  offline: { tom: 'desligado', rotulo: 'desligado' },
};

/** O estado da gaveta no tom da pílula: fora do ar vence, depois o alerta, depois o status da frota. */
export function estadoDaPilula(status: AgentStatus, foraDoAr: boolean, alerta: boolean): { tom: TomDeEstado; rotulo: string } {
  if (foraDoAr) return DO_STATUS.offline;
  if (alerta) return { tom: 'erro', rotulo: 'parou' };
  return DO_STATUS[status] ?? DO_STATUS.ocioso;
}

export function Heroi({
  agente,
  agora,
  fecharHref,
  foraDoAr,
  alerta,
  interruptor,
}: {
  agente: Agent;
  agora: number;
  fecharHref: string;
  foraDoAr: boolean;
  alerta: boolean;
  interruptor: ReactNode;
}) {
  // O status vem da frota viva (a mesma da statusline); o `agente` da página é a foto do carregamento.
  const status = usaFrota().agents.find((a) => a.slug === agente.slug)?.status ?? agente.status;
  const { tom, rotulo } = estadoDaPilula(status, foraDoAr, alerta);
  return (
    <header className="flex shrink-0 flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-1)' }}>
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
        <div className="flex min-w-0 flex-1 items-center">
          <PilulaDoAgente
            slug={agente.slug}
            nome={agente.name}
            tom={tom}
            rotulo={rotulo}
            lado={FOTO}
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
