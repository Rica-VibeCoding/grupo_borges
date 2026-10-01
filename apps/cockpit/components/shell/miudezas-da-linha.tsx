/**
 * As miudezas da linha da tropa — pasta e número de contexto.
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

/**
 * A pasta em que o agente trabalha, sem a raiz que todos compartilham.
 *
 * Ordem do Rica (02/08): *"toda tropa eu tenho que saber em que pasta que tá"*;
 * em 03/08 ele recortou: só pra quem está DE PÉ. E só quando está FORA de casa —
 * `ze_claude/<slug>` repetiria o nome que está três pixels acima. Gêmea da do
 * cockpit antigo e deliberadamente NÃO compartilhada (o antigo está congelado).
 */
const RAIZ_DOS_REPOS = '/home/clawd/repos/';
const CASA_DA_FROTA = 'ze_claude/';

export function pastaCurta(workspacePath: string | null | undefined, slug: string): string | null {
  if (!workspacePath) return null;
  const limpo = workspacePath.replace(/\/+$/, '');
  if (!limpo) return null;
  const curta = limpo.startsWith(RAIZ_DOS_REPOS) ? limpo.slice(RAIZ_DOS_REPOS.length) : limpo;
  return curta === `${CASA_DA_FROTA}${slug}` ? null : curta;
}

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

/** Endereço fica em mono: é caminho, lido caractere a caractere. É a única mono
 *  da linha — relógio e percentual passaram para a sans tabular. */
export function Pasta({ pasta, caminho }: { pasta: string; caminho: string }) {
  return (
    <span
      className="min-w-0 truncate"
      style={{
        fontFamily: 'var(--ck-font-mono)',
        fontSize: 'var(--ck-text-xs)',
        color: 'var(--ck-text-secondary)',
      }}
      title={caminho}
    >
      {pasta}
    </span>
  );
}
