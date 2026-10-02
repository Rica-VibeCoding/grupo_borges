'use client';

// O grupo de ferramentas na tela — §7 do contrato na forma que o Rica
// fotografou no app do Claude: UMA linha cinza com o resumo em português, o
// saldo de diff e o chevron. O trabalho está a um toque, nunca na cara.
//
// NASCE FECHADO (02/10): a prova de vida da máquina é a linha do agora, com a
// esfera, e o passo rodando mora só lá. Aqui ele surge quando termina. A
// partir do PRIMEIRO toque, a preferência é do Rica (a chave `gf-` é estável
// enquanto o grupo cresce, então o estado sobrevive ao stream).

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
  aguarda: 'aguardando',
};

// Abrir e fechar no ritmo dos tokens (§5): `--ck-dur-enter` com `--ck-ease` na
// entrada e `--ck-ease-exit` na saída. A Motion quer número, não token.
const ABRE = { duration: 0.2, ease: [0.2, 0, 0.2, 1] } as const;
const FECHA = { duration: 0.2, ease: [0.4, 0, 1, 1] } as const;
const SECO = { duration: 0 } as const;

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
  // O `reducedMotion="user"` da Motion só para transform e layout; altura e
  // opacidade seguiriam animando. Aqui se para à mão (§5).
  const semMovimento = useReducedMotion();
  const emVoo = resumo.estado === 'rodando' || resumo.estado === 'aguarda';
  // Nasce SEMPRE fechado (Rica, 02/10): o trabalho em voo já está na linha do
  // agora, com a esfera. Abrir é gesto dele.
  const aberto = preferencia ?? false;

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
          style={{ color: aberto || resumo.estado === 'rodando' ? 'var(--ck-text-secondary)' : cor }}
        >
          {resumo.estado === 'aguarda' && !aberto && resumo.atual ? resumo.atual.frase : frase}
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

      {/* A lista entra e sai pela Motion (§5): altura de 0 ao natural e
          opacidade. O virtualizador não pula porque mede o envelope do item
          por `ResizeObserver` (border-box) a cada quadro — os itens de baixo
          acompanham a altura em voo, e o último quadro é a altura natural
          (`height: auto` ao fim). `initial={false}`: o grupo que remonta ao
          rolar aparece parado. `clip` e não `hidden` — não vira contêiner de
          rolagem. */}
      <AnimatePresence initial={false}>
        {aberto ? (
          <motion.div
            key="passos"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: semMovimento ? SECO : ABRE }}
            exit={{ height: 0, opacity: 0, transition: semMovimento ? SECO : FECHA }}
            style={{ overflow: 'clip' }}
          >
            {entradas.map((entrada, indice) => (
              <Execucao key={indice} entrada={entrada} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
