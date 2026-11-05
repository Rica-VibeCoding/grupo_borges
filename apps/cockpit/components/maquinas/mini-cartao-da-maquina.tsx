/**
 * Cada máquina numa linha, no pé da tropa, embaixo do cartão da VPS: nome, RAM,
 * temperatura e quantos estão parados. O toque leva à tela Abertos com a aba
 * dele. Mesma língua do cartão da VPS (`composer` + fio de luz, número em
 * `tabular-nums`, cor só acima do teto), uma linha só porque o detalhe mora
 * na tela.
 *
 * Lê o `resumo` compartilhado com o selo do atalho (`usa-resumo-da-maquina`).
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { IconeMaquina } from '@/components/shell/icones';
import { emAlerta } from '@/components/shell/recursos-da-vps';
import { temperaturaEmAlerta } from '@/lib/maquinas';

import { usaMaquinas, usaResumoDaMaquina } from './usa-resumo-da-maquina';

const ALERTA = { color: 'var(--ck-state-attention)' } as const;

/** Um mini cartão por máquina que a API conhece; nome e id vêm de lá. */
export function MiniCartoesDasMaquinas() {
  return usaMaquinas().map((m) => <MiniCartaoDaMaquina key={m.id} id={m.id} nome={m.nome} />);
}

function MiniCartaoDaMaquina({ id, nome }: { id: string; nome: string }) {
  const resumo = usaResumoDaMaquina(id);

  let linha: ReactNode = ' ';
  if (resumo && !resumo.online) linha = 'fora do ar'; // o nome já está ao lado
  if (resumo?.online) {
    const parados = resumo.parados_30min;
    linha = (
      <>
        <span style={emAlerta('ram', resumo.ram.pct) ? ALERTA : undefined}>RAM {Math.round(resumo.ram.pct)}%</span>
        {resumo.temperatura_c !== null ? (
          <>
            {' · '}
            <span style={temperaturaEmAlerta(resumo.temperatura_c) ? ALERTA : undefined}>
              {Math.round(resumo.temperatura_c)} °C
            </span>
          </>
        ) : null}
        {parados > 0 ? ` · ${parados} ${parados === 1 ? 'parado' : 'parados'}` : null}
      </>
    );
  }

  return (
    <Link
      href={`/abertos?m=${encodeURIComponent(id)}`}
      className="ck-vps ck-maquina-mini flex shrink-0 items-center"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        marginTop: 'var(--ck-space-2)',
        padding: '0 var(--ck-space-4)',
        color: 'var(--ck-text-primary)',
      }}
    >
      <IconeMaquina tamanho={16} style={{ color: 'var(--ck-text-secondary)' }} />
      <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600 }}>{nome}</span>
      <span
        className="ck-tabular ml-auto min-w-0 truncate"
        style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
      >
        {linha}
      </span>
    </Link>
  );
}
