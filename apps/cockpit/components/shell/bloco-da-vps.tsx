/**
 * O bloco da VPS — CPU, RAM, swap e disco no rodapé da tropa.
 *
 * Ordem do Rica (07/09): *"na sidebar do cockpit tivesse os consumos mais
 * importantes da vps, tipo ram e cpu e espaço"*. Mora na tropa porque ela
 * aparece nas três superfícies (rota `/`, gaveta do celular, faixa do desktop)
 * e o bloco tem que estar onde a lista de agentes estiver.
 *
 * Mesma gramática visual do "Cota usada" da gaveta do agente: overline, linha
 * de rótulo + barra de 4px + percentual tabular. A barra aqui é LINEAR (0 a 100
 * é a escala inteira), diferente da régua de contexto que dobra no teto.
 *
 * Tem ciclo próprio (`GET /api/vps` a cada 10s) em vez de pegar carona no
 * `/api/fleet`: o snapshot da frota é dos AGENTES e o tipo dele é contrato
 * compartilhado no `cockpit-core`. Máquina é outro assunto.
 *
 * A altura é reservada antes da primeira leitura — quatro linhas com barra
 * vazia e traço no lugar do número —, para a coluna não pular quando o dado
 * chega. Leitura que falha DEPOIS da primeira mantém a última na tela: número
 * de dez segundos atrás vale mais que um buraco.
 *
 * A régua (tetos, formatadores, tipos) mora em `recursos-da-vps.ts`, o par
 * puro deste arquivo — mesmo desenho de `cota.ts` + `bloco-de-cota.tsx`.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useState } from 'react';

import {
  descreve,
  emAlerta,
  formataCarga,
  formataNoAr,
  formataTamanho,
  fracaoDaBarra,
  type Medida,
  type RecursosDaVps,
} from './recursos-da-vps';

const INTERVALO_MS = 10_000;

const LINHAS: Array<{ medida: Medida; rotulo: string }> = [
  { medida: 'cpu', rotulo: 'CPU' },
  { medida: 'ram', rotulo: 'RAM' },
  { medida: 'swap', rotulo: 'Swap' },
  { medida: 'disco', rotulo: 'Disco' },
];

function pctDe(medida: Medida, dados: RecursosDaVps | null): number | null {
  if (!dados) return null;
  switch (medida) {
    case 'cpu':
      return dados.cpu_pct;
    case 'ram':
      return dados.ram.pct;
    case 'swap':
      return dados.swap?.pct ?? null;
    case 'disco':
      return dados.disco.pct;
  }
}

function Linha({
  medida,
  rotulo,
  dados,
}: {
  medida: Medida;
  rotulo: string;
  dados: RecursosDaVps | null;
}) {
  const pct = pctDe(medida, dados);
  const alerta = emAlerta(medida, pct);
  const detalhe = dados ? descreve(medida, dados) : 'sem leitura ainda';
  return (
    <li className="flex items-center" style={{ gap: 'var(--ck-space-2)' }} title={detalhe}>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-secondary)',
          minWidth: '5ch',
        }}
      >
        {rotulo}
      </span>
      <span
        role="meter"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? detalhe : `${Math.round(pct)}%, ${detalhe}`}
        className="block flex-1 overflow-hidden"
        style={{
          height: '4px',
          borderRadius: 'var(--ck-radius-pill)',
          background: 'var(--ck-surface-composer)',
        }}
      >
        <span
          className="block"
          style={{
            width: `${fracaoDaBarra(pct) * 100}%`,
            height: '100%',
            borderRadius: 'var(--ck-radius-pill)',
            background: alerta ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)',
          }}
        />
      </span>
      {/* O número é o dado; a barra é o resumo. Mesma coluna de 4ch do contexto
          da tropa, pra os quatro percentuais alinharem na vertical. */}
      <span
        className="ck-tabular shrink-0"
        aria-hidden
        style={{
          width: '4ch',
          textAlign: 'right',
          fontSize: 'var(--ck-text-xs)',
          color: alerta
            ? 'var(--ck-state-attention)'
            : pct === null
              ? 'var(--ck-text-tertiary)'
              : 'var(--ck-text-primary)',
        }}
      >
        {pct === null ? '—' : `${Math.round(pct)}%`}
      </span>
    </li>
  );
}

async function leRecursos(): Promise<RecursosDaVps> {
  const resposta = await fetch('/api/vps', { cache: 'no-store' });
  if (!resposta.ok) throw new Error(`/api/vps ${resposta.status}`);
  return resposta.json();
}

export function BlocoDaVps() {
  const [dados, setDados] = useState<RecursosDaVps | null>(null);

  useEffect(() => {
    let vivo = true;
    const le = () =>
      leRecursos()
        .then((novo) => {
          if (vivo) setDados(novo);
        })
        .catch(() => {
          /* a próxima rodada tenta de novo; a última leitura fica na tela */
        });
    void le();
    const ronda = window.setInterval(le, INTERVALO_MS);
    return () => {
      vivo = false;
      window.clearInterval(ronda);
    };
  }, []);

  return (
    <section
      aria-label="Recursos da VPS"
      className="flex shrink-0 flex-col border-t"
      style={{
        gap: 'var(--ck-space-2)',
        marginTop: 'auto',
        padding: 'var(--ck-space-4) var(--ck-space-2) 0',
        borderColor: 'var(--ck-edge-light)',
      }}
    >
      <div className="flex items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          VPS
        </span>
        {dados ? (
          <span
            className="ml-auto"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}
          >
            no ar {formataNoAr(dados.no_ar_segundos)}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col" style={{ gap: 'var(--ck-space-1)' }}>
        {LINHAS.map((linha) => (
          <Linha key={linha.medida} medida={linha.medida} rotulo={linha.rotulo} dados={dados} />
        ))}
      </ul>

      {/* Os dois absolutos que decidem alguma coisa: a carga diz se o percentual
          de CPU é pico ou fila (2,6 em 2 núcleos é fila), e o disco livre é o
          número que ele olha antes de mandar limpar. O resto mora no `title`.
          Sempre no DOM: a linha reserva a própria altura antes da leitura. */}
      <p
        className="ck-tabular"
        style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}
      >
        {dados
          ? `carga ${formataCarga(dados.carga_1m)} · ${formataTamanho(dados.disco.livre_mb)} livres`
          : '\u00a0'}
      </p>
    </section>
  );
}
