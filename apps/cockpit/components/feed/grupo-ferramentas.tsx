'use client';

// O grupo de ferramentas na tela — §7 do contrato na forma que o Rica
// fotografou no app do Claude: UMA linha cinza com o resumo em português, o
// saldo de diff e o chevron. O trabalho está a um toque, nunca na cara.
//
// O AUTO-ABERTO é o micro-momento 6 do contrato aplicado ao grupo: enquanto a
// corrida trabalha, o grupo nasce aberto — o Rica vê as linhas individuais
// passando, que é a prova de vida da máquina. Quando a corrida termina, o
// grupo fecha sozinho e vira o resumo. A partir do PRIMEIRO toque, a
// preferência é dele para sempre (a chave `gf-` é estável enquanto o grupo
// cresce, então o estado sobrevive ao stream).

import { useMemo, useState } from 'react';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { Chevron, SaldoDoRendimento } from '../renderers/linha-execucao';
import { Execucao } from './execucao';
import type { GrupoFerramentas } from './grupo-ferramentas.ts';
import { entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';

const COR_DO_ESTADO = {
  rodando: 'var(--ck-state-running)',
  aguarda: 'var(--ck-state-attention)',
  falhou: 'var(--ck-state-fail)',
  feito: 'var(--ck-text-secondary)',
} as const;

export function GrupoFerramentasView({
  grupo,
  lookup,
}: {
  grupo: GrupoFerramentas;
  lookup?: ToolResultLookup;
}) {
  const entradas = useMemo(() => entradasDoGrupo(grupo.itens, lookup), [grupo.itens, lookup]);
  const resumo = useMemo(() => resumeGrupo(entradas), [entradas]);

  const [preferencia, setPreferencia] = useState<boolean | null>(null);
  const emVoo = resumo.estado === 'rodando' || resumo.estado === 'aguarda';
  const aberto = preferencia ?? emVoo;

  const cor = COR_DO_ESTADO[resumo.estado];

  return (
    <div
      style={{
        // O filete de estado, mesma régua da linha individual: existe enquanto
        // há estado ou enquanto aberto; feito e fechado é transparente.
        borderLeft: `2px solid ${
          resumo.estado !== 'feito' ? cor : aberto ? 'var(--ck-edge-hairline)' : 'transparent'
        }`,
      }}
    >
      <button
        type="button"
        onClick={() => setPreferencia(!aberto)}
        aria-expanded={aberto}
        className="ck-veil flex w-full items-center text-left"
        style={{
          gap: 'var(--ck-space-2)',
          minHeight: '32px',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          fontFamily: 'var(--ck-font-sans)',
          fontSize: 'var(--ck-text-sm)',
          lineHeight: 'var(--ck-leading-body)',
        }}
      >
        <span
          className="ck-pulso min-w-0 flex-1 truncate"
          data-estado={emVoo ? 'trabalhando' : undefined}
          style={{ color: cor }}
        >
          {emVoo && resumo.atual
            ? `${resumo.atual.verbo} ${resumo.atual.alvo}`
            : resumo.frase}
        </span>

        {resumo.rendimento ? (
          <SaldoDoRendimento
            rendimento={resumo.rendimento}
            falhou={resumo.estado === 'falhou'}
          />
        ) : null}

        <Chevron aberto={aberto} />
      </button>

      {aberto ? (
        <div>
          {entradas.map((entrada, indice) => (
            <Execucao key={indice} entrada={entrada} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
