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
import { duracaoCurta, duracaoDoGrupo, entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';

// Em voo, o dourado do pulso — texto e filete da mesma cor (02/10, §6.3).
const COR_DO_ESTADO = {
  rodando: 'var(--ck-pulso-ouro)',
  aguarda: 'var(--ck-state-attention)',
  falhou: 'var(--ck-state-fail)',
  feito: 'var(--ck-text-secondary)',
} as const;

/** O mesmo vocabulário de pulso da linha individual: esperar o Rica chama
 *  (`aguardando`), trabalhar respira (`trabalhando`). */
const PULSO_DO_ESTADO: Partial<Record<keyof typeof COR_DO_ESTADO, string>> = {
  rodando: 'trabalhando',
  aguarda: 'aguardando',
};

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
  const duracao = useMemo(() => duracaoDoGrupo(grupo.itens), [grupo.itens]);
  // Terminou bem (28/09): linha neutra em cápsula, ✓ verde, passos + frase +
  // duração. Erro que o agente refez e seguiu é selo âmbar, não a linha em
  // coral — a cor de falha fica só pra quem TERMINOU falhando.
  const terminouBem = resumo.estado === 'feito';
  const frase = terminouBem
    ? [
        `${resumo.passos} passos`,
        resumo.frase.charAt(0).toLowerCase() + resumo.frase.slice(1),
        ...(duracao !== null ? [duracaoCurta(duracao)] : []),
      ].join(' · ')
    : resumo.frase;

  return (
    <div
      style={{
        // O filete de estado, mesma régua da linha individual: existe enquanto
        // há estado ou enquanto aberto; feito vira cápsula sem filete. Em voo,
        // o dourado do pulso — o mesmo da linha individual.
        borderLeft: terminouBem
          ? undefined
          : `2px solid ${cor}`,
        background: terminouBem ? 'var(--ck-surface-nav)' : undefined,
        borderRadius: terminouBem ? 'var(--ck-radius-caixa)' : undefined,
        // O véu do hover é dos botões de dentro, que são retos: sem o recorte,
        // ele pinta um retângulo de canto vivo por cima da cápsula. `clip` e
        // não `hidden` — não vira contêiner de rolagem.
        overflow: terminouBem ? 'clip' : undefined,
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
        {terminouBem ? (
          <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-state-ok)' }}>
            ✓
          </span>
        ) : null}

        {/* FECHADO, o cabeçalho diz o que acontece agora (o item em voo, que
            não está à vista). ABERTO, o item em voo já é a última linha logo
            abaixo — repetir no cabeçalho era dizer a mesma coisa duas vezes
            (Rica, 02/10). Aí o cabeçalho é só o resumo e o saldo, parado e
            neutro: quem pulsa e tem cor é a linha viva. */}
        <span
          className="ck-pulso min-w-0 flex-1 truncate"
          data-estado={emVoo && !aberto ? PULSO_DO_ESTADO[resumo.estado] : undefined}
          style={{ color: aberto ? 'var(--ck-text-secondary)' : cor }}
        >
          {emVoo && !aberto && resumo.atual ? resumo.atual.frase : frase}
        </span>

        {terminouBem && resumo.retentativas > 0 ? (
          <span
            className="shrink-0"
            style={{ color: 'var(--ck-state-attention)', fontSize: 'var(--ck-text-xs)', whiteSpace: 'nowrap' }}
          >
            {resumo.retentativas === 1 ? '1 retentativa' : `${resumo.retentativas} retentativas`}
          </span>
        ) : null}

        {resumo.rendimento ? (
          <SaldoDoRendimento
            rendimento={resumo.rendimento}
            falhou={resumo.estado === 'falhou'}
          />
        ) : null}

        <Chevron aberto={aberto} />
      </button>

      {/* `.ck-chega` só quando o DEDO abriu (`preferencia === true`): o grupo
          que abre sozinho por estar em voo, e o que remonta ao rolar, aparecem
          parados. Recolher segue seco — altura não se anima (§9.4). */}
      {aberto ? (
        <div className={preferencia === true ? 'ck-chega' : undefined}>
          {entradas.map((entrada, indice) => (
            <Execucao key={indice} entrada={entrada} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
