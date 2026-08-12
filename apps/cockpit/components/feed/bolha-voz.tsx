'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BARRAS,
  PISO_BARRA_PX,
  TETO_BARRA_PX,
  alturasDasBarras,
  aparenciaDaBolha,
  barrasReais,
  emRepouso,
  faseDaRevelacao,
  indiceDoPlayhead,
  type EstadoRevelacao,
  type FaseReproducao,
} from './bolha-voz.ts';
import { IconeAltoFalante } from '../shell/icones.tsx';

import { destravaNoGesto, iniciaSequencia, pausa, retoma } from './reprodutor-unico.ts';
import { pedeFala, type FalaEmCurso } from './stream-voz.ts';

/**
 * A resposta do agente, falada. O texto continua na tela — a bolha é o áudio
 * ao lado dele, não no lugar dele (decisão do Rica, 11/08).
 *
 * EM REPOUSO É SÓ O ÍCONE, e ele CRESCE PRO LADO. A primeira versão era a bolha
 * cheia em toda resposta: 52px de altura por mensagem, e o Rica leu isso como
 * *"deixa a UI bem fracionada"* (11/08). Ele pediu um ícone de uma linha que
 * *"clicou, desenvolve"* — e desenvolver pro lado, não pra baixo, é o que
 * mantém a altura da linha igual cheia e vazia. Clicar no meio do feed não
 * empurra o que está embaixo. Uma forma só: ele descartou ter duas variantes
 * conforme a mensagem tenha vindo por voz ou por teclado.
 *
 * A síntese só começa no toque: nada é gerado pra mensagem que ninguém pediu
 * pra ouvir. E o toque é o mesmo gesto que destrava o áudio no iPhone, então o
 * caminho feliz não precisa de um "permitir som" separado.
 *
 * NÃO tem seek nesta versão. O modelo puro suporta (`destinoDeSeek`), mas o
 * áudio chega em sentenças separadas e buscar no meio exige mapear segundo →
 * sentença; sem isso, tocar na onda mentiria sobre onde iria parar.
 */

const VAZIO: EstadoRevelacao = {
  peaks: [],
  duracaoEstimada: 0,
  duracoesReais: [],
  estimativasPorSentenca: [],
  duracaoReal: null,
  peaksPorSegundo: 20,
};

export function BolhaVoz({ texto, agentSlug }: { texto: string; agentSlug: string }) {
  const [est, setEst] = useState<EstadoRevelacao>(VAZIO);
  const [faseRep, setFaseRep] = useState<FaseReproducao>('parada');
  const [posicao, setPosicao] = useState(0);
  const [degradada, setDegradada] = useState(false);
  const falaRef = useRef<FalaEmCurso | null>(null);
  const urlsRef = useRef<string[]>([]);

  // As URLs de objeto seguram o MP3 na memória até serem revogadas.
  useEffect(
    () => () => {
      falaRef.current?.cancela();
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const começa = useCallback(() => {
    // SÍNCRONO no gesto: é o que compra a ativação do áudio no Safari.
    destravaNoGesto();
    setFaseRep('tocando');
    setEst(VAZIO);
    setPosicao(0);

    const sequencia = iniciaSequencia({
      aoProgredir: setPosicao,
      aoTerminar: () => setFaseRep('parada'),
      aoFalhar: () => setFaseRep('falha'),
    });

    falaRef.current = pedeFala(texto, agentSlug, {
      aoMeta: (meta) => {
        setDegradada(meta.degraded);
        setEst((atual) => ({
          ...atual,
          duracaoEstimada: meta.duration_estimate,
          peaksPorSegundo: meta.peaks_per_second,
          estimativasPorSentenca: meta.segments.map((s) => s.duration_estimate),
        }));
      },
      aoPeaks: (_id, duracao, peaks) => {
        setEst((atual) => ({
          ...atual,
          peaks: [...atual.peaks, ...peaks],
          duracoesReais: [...atual.duracoesReais, duracao],
        }));
      },
      aoAudio: (_id, url) => {
        urlsRef.current.push(url);
        sequencia.enfileira(url);
      },
      aoFim: (duracaoReal) => {
        setEst((atual) => ({ ...atual, duracaoReal }));
        sequencia.fecha();
      },
      aoErro: () => {
        sequencia.para();
        setFaseRep('falha');
      },
    });
  }, [texto, agentSlug]);

  const aoTocar = useCallback(() => {
    if (faseRep === 'tocando') {
      pausa();
      setFaseRep('pausada');
      return;
    }
    if (faseRep === 'pausada') {
      void retoma();
      setFaseRep('tocando');
      return;
    }
    começa();
  }, [faseRep, começa]);

  const faseRev = faseDaRevelacao(est);
  const repouso = emRepouso(faseRev, faseRep);
  const pele = aparenciaDaBolha(faseRev, faseRep, { posicaoSeg: posicao, est, nome: agentSlug });
  const alturas = alturasDasBarras(est);
  const reais = barrasReais(est);
  const cabeça = repouso ? -1 : indiceDoPlayhead(posicao, est);

  return (
    <div className="flex w-fit max-w-full items-center gap-2">
      <button
        type="button"
        onClick={aoTocar}
        aria-label={pele.anuncio}
        className="grid shrink-0 place-items-center rounded-full"
        style={{
          // 28px é a altura da onda (TETO_BARRA_PX). Igualar os dois é o que faz
          // a linha ter a MESMA altura vazia e cheia: crescer pro lado não
          // empurra nada pra baixo, e o Rica pode clicar no meio do feed sem a
          // página pular embaixo do olho dele.
          width: TETO_BARRA_PX,
          height: TETO_BARRA_PX,
          color: repouso ? 'var(--ck-text-secondary)' : 'var(--ck-text-primary)',
        }}
      >
        <Icone botao={pele.botao} />
      </button>

      {repouso ? null : (
        <>
          <svg
            width={BARRAS * 3}
            height={TETO_BARRA_PX}
            viewBox={`0 0 ${BARRAS * 3} ${TETO_BARRA_PX}`}
            className="min-w-0 shrink"
            aria-hidden="true"
          >
            {alturas.map((altura, i) => {
              const h = Math.max(PISO_BARRA_PX, altura * TETO_BARRA_PX);
              const revelada = i < reais;
              return (
                <rect
                  key={i}
                  x={i * 3}
                  y={(TETO_BARRA_PX - h) / 2}
                  width={2}
                  height={h}
                  rx={1}
                  fill={
                    i <= cabeça && revelada
                      ? 'var(--ck-text-primary)'
                      : revelada
                        ? 'var(--ck-text-secondary)'
                        : 'var(--ck-text-tertiary)'
                  }
                  opacity={revelada ? 1 : 0.35}
                />
              );
            })}
          </svg>

          <span
            className="shrink-0 tabular-nums"
            style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-xs)' }}
          >
            {pele.rotuloTempo}
          </span>
        </>
      )}

      {degradada ? (
        <span
          className="shrink-0"
          style={{ color: 'var(--ck-text-tertiary)', fontSize: 'var(--ck-text-xs)' }}
          title="a voz de sempre falhou; esta é a de emergência"
        >
          voz alternativa
        </span>
      ) : null}

      {pele.instrucao ? (
        <span
          className="shrink-0"
          style={{ color: 'var(--ck-text-tertiary)', fontSize: 'var(--ck-text-xs)' }}
        >
          {pele.instrucao}
        </span>
      ) : null}
    </div>
  );
}

function Icone({ botao }: { botao: 'ouvir' | 'tocar' | 'pausar' | 'falha' }) {
  // Em repouso o áudio ainda NÃO existe — o toque é que manda gerar. Triângulo
  // de play prometeria um arquivo pronto; o alto-falante oferece a leitura.
  if (botao === 'ouvir') return <IconeAltoFalante tamanho={17} />;
  if (botao === 'pausar') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
        <rect x="2" y="1" width="4" height="12" rx="1" />
        <rect x="8" y="1" width="4" height="12" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 1.5v11l9-5.5z" />
    </svg>
  );
}
