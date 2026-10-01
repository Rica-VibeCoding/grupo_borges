/**
 * As miudezas da linha da tropa — o número de contexto.
 *
 * Peças pequenas e puras que `linha-da-tropa.tsx` monta; separadas pra que cada
 * arquivo faça uma coisa só (teto de 300 linhas do `apps/cockpit/CLAUDE.md`).
 *
 * Dono: Daniel (pele).
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { resolveContextPct } from '@grupo_borges/cockpit-core/cockpit-types';
import { formatElapsedShort } from '@grupo_borges/cockpit-core/painel-format';
import { SemContexto, ValorDoContexto } from './barra-de-contexto';
import { TETO_PCT } from './medidor';

/** `agora` só existe pra quem está de pé (idade do número velho); `null` é
 *  quem dorme. O número de contexto no fim da primeira linha — o MESMO para vivo e dormindo,
 *  na mesma fonte e tamanho, pra que a coluna do `%` caia no mesmo `x`. */
export function Contexto({ agente, agora }: { agente: Agent; agora: number | null }) {
  const vivo = agora !== null;
  const pct = resolveContextPct(agente);
  const velho = vivo && agente.context_stale;
  if (pct === null) return <SemContexto />;
  const titulo = !vivo
    ? agente.context_stale
      ? `contexto ${pct}% de uma sessão anterior a esta — não é a leitura de quando ela fechou`
      : `contexto ${pct}% ao fechar a sessão — teto da frota ${TETO_PCT}%`
    : velho
      ? `contexto ${pct}% medido ${
          agente.context_updated_at !== null
            ? formatElapsedShort(agora - agente.context_updated_at)
            : 'em sessão anterior'
        } — não é a leitura desta sessão`
      : `contexto ${pct}% — teto da frota ${TETO_PCT}%`;
  return (
    <span className="flex shrink-0 items-baseline" style={{ gap: 'var(--ck-space-1)' }} title={titulo}>
      {/* De pé com número de outro run: a PALAVRA avisa, como na gaveta. */}
      {velho ? <span style={{ fontSize: 'var(--ck-text-xs)' }}>antigo</span> : null}
      <span data-pct className="flex">
        <ValorDoContexto pct={pct} />
      </span>
    </span>
  );
}

export const ESTILO_DO_NUMERO = {
  fontSize: 'var(--ck-text-sm)',
  color: 'var(--ck-text-secondary)',
} as const;
