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
import { DESENHA, DuracaoAoVivo, FECHA_ANEL, MarcaDaFase, NOME_DA_FASE } from './marca-do-grupo.tsx';
import {
  cabecalhoDoGrupo,
  duracaoCurta,
  duracaoDoGrupo,
  entradasDoGrupo,
  faseDoGrupo,
  inicioDoGrupo,
  resumeGrupo,
} from './resumo-do-grupo.ts';

// Abrir e fechar no ritmo dos tokens (§5): `--ck-dur-enter` com `--ck-ease` na
// entrada e `--ck-ease-exit` na saída. A Motion quer número, não token.
const ABRE = { duration: 0.2, ease: [0.2, 0, 0.2, 1] } as const;
const FECHA = { duration: 0.2, ease: [0.4, 0, 1, 1] } as const;
const SECO = { duration: 0 } as const;

export function GrupoFerramentasView({
  grupo,
  lookup,
  emCurso = false,
}: {
  grupo: GrupoFerramentas;
  lookup?: ToolResultLookup;
  /** O grupo é o fim do feed e a corrida segue (`indiceDoGrupoEmCurso`). */
  emCurso?: boolean;
}) {
  const entradas = useMemo(() => entradasDoGrupo(grupo.itens, lookup), [grupo.itens, lookup]);
  const resumo = useMemo(() => resumeGrupo(entradas), [entradas]);

  const [preferencia, setPreferencia] = useState<boolean | null>(null);
  // O `reducedMotion="user"` da Motion só para transform e layout; altura,
  // opacidade e traço seguiriam animando. Aqui se para à mão (§5).
  const semMovimento = useReducedMotion() ?? false;
  // Nasce SEMPRE fechado (Rica, 02/10): o trabalho em voo já está na linha do
  // agora, com a esfera. Abrir é gesto dele.
  const aberto = preferencia ?? false;

  const fase = faseDoGrupo(resumo.estado, emCurso);
  const fechou = fase === 'ok' || fase === 'falha';
  const cabecalho = cabecalhoDoGrupo(resumo, fase, aberto);
  const inicio = useMemo(() => inicioDoGrupo(grupo.itens), [grupo.itens]);
  const duracao = useMemo(() => duracaoDoGrupo(grupo.itens), [grupo.itens]);
  const deslize = semMovimento ? SECO : ABRE;

  return (
    // UMA forma do começo ao fim: a cápsula neutra. O que muda com o estado é
    // a marca à esquerda, o "N passos" que entra e o relógio que congela.
    // `clip` e não `hidden`: recorta o véu dos botões retos de dentro sem
    // virar contêiner de rolagem.
    <div
      style={{
        background: 'var(--ck-surface-nav)',
        borderRadius: 'var(--ck-radius-caixa)',
        overflow: 'clip',
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
        <MarcaDaFase fase={fase} semMovimento={semMovimento} />
        <span className="sr-only">{NOME_DA_FASE[fase]}: </span>

        {/* "N passos ·" entra à esquerda e a frase desliza pelo `layout` da
            Motion (transform, §9.4) — nunca pula. Na saída, `popLayout` tira
            o prefixo do fluxo na hora para a frase voltar deslizando. */}
        <span className="flex min-w-0 flex-1 items-center" style={{ gap: '0.3em' }}>
          <AnimatePresence initial={false} mode="popLayout">
            {cabecalho.passos ? (
              <motion.span
                key="passos"
                layout="position"
                layoutDependency={cabecalho.passos}
                className="shrink-0"
                style={{ color: 'var(--ck-text-secondary)', whiteSpace: 'nowrap' }}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0, transition: semMovimento ? SECO : DESENHA }}
                exit={{ opacity: 0, transition: semMovimento ? SECO : FECHA }}
              >
                {cabecalho.passos} ·
              </motion.span>
            ) : null}
          </AnimatePresence>
          <motion.span
            layout="position"
            layoutDependency={cabecalho.passos}
            transition={deslize}
            className="ck-pulso min-w-0 flex-1 truncate"
            data-estado={cabecalho.chama ? 'aguardando' : undefined}
            style={{ color: cabecalho.chama ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)' }}
          >
            {cabecalho.texto}
          </motion.span>
        </span>

        {fechou && resumo.retentativas > 0 ? (
          <span
            className="shrink-0"
            style={{ color: 'var(--ck-state-attention)', fontSize: 'var(--ck-text-xs)', whiteSpace: 'nowrap' }}
          >
            {resumo.retentativas === 1 ? '1 retentativa' : `${resumo.retentativas} retentativas`}
          </span>
        ) : null}

        {/* O relógio conta ao vivo e congela no fim. A troca é cruzada: o
            número final é medido até o último pedido de ferramenta e pode ser
            menor que o último tique — trocar de uma vez, sem contar pra trás. */}
        <span
          className="ck-tabular relative shrink-0"
          style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-xs)', whiteSpace: 'nowrap' }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {fechou ? (
              duracao !== null ? (
                <motion.span
                  key="final"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: semMovimento ? SECO : DESENHA }}
                  exit={{ opacity: 0, transition: semMovimento ? SECO : FECHA }}
                >
                  {duracaoCurta(duracao)}
                </motion.span>
              ) : null
            ) : inicio !== null ? (
              <motion.span
                key="vivo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: semMovimento ? SECO : ABRE }}
                exit={{ opacity: 0, transition: semMovimento ? SECO : FECHA_ANEL }}
              >
                <DuracaoAoVivo desdeMs={inicio} />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>

        {/* "erro"/"interrompido" só com o veredito; o saldo de diff sempre. */}
        {resumo.rendimento && (resumo.rendimento.adicoes !== undefined || fase === 'falha') ? (
          <SaldoDoRendimento rendimento={resumo.rendimento} falhou={fase === 'falha'} />
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
