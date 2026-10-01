'use client';

/**
 * O topo da gaveta do zero: o círculo-herói da referência ACI (ícone num
 * disco laranja, dois anéis de halo), com o RETRATO do agente no lugar do
 * ícone. Abaixo, o nome grande e a statusline (modelo · sessão · contexto),
 * que continua sendo a única fonte do modelo na gaveta.
 *
 * O disco perde a cor quando o agente está fora do ar — laranja é identidade
 * viva. A bolinha vermelha aparece quando há algo que pede olho (sem sinal,
 * falha, controles ilegíveis); o texto do porquê está no cartão abaixo.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { Retrato } from '../shell/retrato';
import { StatuslineAoVivo } from '../shell/statusline-ao-vivo';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { BolinhaDeAlerta } from './pecas';

export function Heroi({
  agente,
  agora,
  fecharHref,
  foraDoAr,
  alerta,
}: {
  agente: Agent;
  agora: number;
  fecharHref: string;
  foraDoAr: boolean;
  alerta: boolean;
}) {
  return (
    <header className="relative flex shrink-0 flex-col items-center" style={{ paddingTop: 'var(--ck-space-4)' }}>
      <LinkFechaPainel
        href={fecharHref}
        rotulo="detalhes"
        className="ck-gv-pilula ck-veil absolute flex items-center justify-center rounded-full"
        style={{
          top: 0,
          right: 0,
          width: 'var(--ck-touch-min)',
          height: 'var(--ck-touch-min)',
          fontSize: 'var(--ck-text-lg)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        ×
      </LinkFechaPainel>

      {/* Halo: 132px de anéis, disco de 84px, retrato de 64px. */}
      <div className="ck-gv-halo relative flex items-center justify-center rounded-full" style={{ width: '132px', height: '132px' }}>
        <div
          className="ck-gv-heroi relative flex items-center justify-center rounded-full"
          data-fora={String(foraDoAr)}
          style={{ width: '84px', height: '84px' }}
        >
          <div className="overflow-hidden rounded-full" style={{ width: '64px', height: '64px' }}>
            <Retrato slug={agente.slug} nome={agente.name} tamanho={64} opacidade={foraDoAr ? 0.55 : 1} />
          </div>
          {alerta ? <BolinhaDeAlerta style={{ top: '2px', right: '2px' }} /> : null}
        </div>
      </div>

      <h2
        className="max-w-full truncate"
        style={{
          marginTop: 'var(--ck-space-1)',
          fontSize: 'var(--ck-text-lg)',
          fontWeight: 600,
          letterSpacing: 'var(--ck-track-title)',
          color: 'var(--ck-text-primary)',
        }}
      >
        {agente.name}
      </h2>

      <div className="flex w-full flex-col" style={{ marginTop: 'var(--ck-space-3)' }}>
        <StatuslineAoVivo agente={agente} agora={agora} larguraDaBarra={null} />
      </div>
    </header>
  );
}
