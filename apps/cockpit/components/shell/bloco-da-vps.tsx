/**
 * O bloco da VPS — CPU, RAM, swap e disco no rodapé da tropa.
 *
 * Ordem do Rica (07/09): *"na sidebar do cockpit tivesse os consumos mais
 * importantes da vps, tipo ram e cpu e espaço"*. Mora na tropa porque ela
 * aparece nas três superfícies (rota `/`, gaveta do celular, faixa do desktop)
 * e o bloco tem que estar onde a lista de agentes estiver.
 *
 * Desde 01/10 é CARTÃO, na linguagem do "Motor e conta" da gaveta: quatro
 * medidas em grade 2×2 (rótulo e número na linha, barra fina embaixo, LINEAR
 * de 0 a 100), cor só acima do teto, "no ar há" e carga como texto secundário,
 * e os processos atrás de uma pílula. Era número solto em faixa, outra língua
 * que a da gaveta.
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
  linhasDeVilao,
  nomeLegivel,
  type Medida,
  type RecursosDaVps,
} from './recursos-da-vps';
import { usaFrota } from './frota-provider';

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

/**
 * Uma medida do cartão: rótulo e número na mesma linha, barra fina embaixo.
 * A barra preenche por `scaleX` (§5: só `transform` anima). Cor só acima do
 * teto (`emAlerta`) — o CSS lê o `data-alerta`.
 */
function Medidor({
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
    <div
      role="meter"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct === null ? detalhe : `${Math.round(pct)}%, ${detalhe}`}
      data-medida={medida}
      data-alerta={alerta ? 'true' : undefined}
      className="ck-vps-medida flex min-w-0 flex-col"
      style={{ gap: 'var(--ck-space-1)' }}
      title={detalhe}
    >
      <span aria-hidden className="flex items-baseline justify-between" style={{ gap: 'var(--ck-space-2)' }}>
        <span className="ck-vps-rotulo" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {rotulo}
        </span>
        <span
          className="ck-vps-valor ck-tabular"
          style={{
            fontSize: 'var(--ck-text-sm)',
            fontWeight: 500,
            color: pct === null ? 'var(--ck-text-tertiary)' : 'var(--ck-text-primary)',
          }}
        >
          {pct === null ? '—' : `${Math.round(pct)}%`}
        </span>
      </span>
      <span
        aria-hidden
        className="ck-vps-trilho block overflow-hidden"
        style={{ height: '4px', borderRadius: 'var(--ck-radius-pill)' }}
      >
        <span
          className="ck-vps-preenche block"
          style={{
            height: '100%',
            borderRadius: 'var(--ck-radius-pill)',
            transform: `scaleX(${fracaoDaBarra(pct)})`,
          }}
        />
      </span>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      className="ck-divulga-chevron"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      focusable="false"
    >
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
      // Aba escondida não mede: a leitura varre o `/proc` inteiro na VPS.
      !document.hidden &&
      leRecursos()
        .then((novo) => {
          if (vivo) setDados(novo);
        })
        .catch(() => {
          /* a próxima rodada tenta de novo; a última leitura fica na tela */
        });
    void le();
    const ronda = window.setInterval(le, INTERVALO_MS);
    const aoVoltar = () => void le();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      vivo = false;
      window.clearInterval(ronda);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  const [processosAbertos, setProcessosAbertos] = useState(false);
  const { agents } = usaFrota();
  const linhas = dados ? linhasDeVilao(dados) : [];

  return (
    <section
      aria-label="Recursos da VPS"
      className="ck-vps flex shrink-0 flex-col"
      style={{
        gap: 'var(--ck-space-3)',
        marginTop: 'auto',
        padding: 'var(--ck-space-3) var(--ck-space-4) var(--ck-space-2)',
      }}
    >
      <div className="flex items-baseline" style={{ gap: 'var(--ck-space-2)', minHeight: '24px' }}>
        <h2 style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
          VPS
        </h2>
        {/* Carga e disco livre: os dois absolutos que decidem alguma coisa. */}
        <span
          className="ck-tabular ml-auto min-w-0 truncate"
          style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
        >
          {dados
            ? `carga ${formataCarga(dados.carga_1m)} · ${formataTamanho(dados.disco.livre_mb)} livres`
            : '\u00a0'}
        </span>
      </div>

      {/* Grade 2×2 e altura reservada antes da primeira leitura (traço no
          lugar do número): a coluna não pula quando o dado chega. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--ck-space-3) var(--ck-space-4)' }}
      >
        {LINHAS.map((linha) => (
          <Medidor key={linha.medida} medida={linha.medida} rotulo={linha.rotulo} dados={dados} />
        ))}
      </div>

      {/* Os processos (QUEM come, ordem do Rica de 07/09) ficam atrás da pílula. */}
      <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <p
          className="ck-tabular min-w-0 flex-1 truncate"
          style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
        >
          {dados ? `no ar ${formataNoAr(dados.no_ar_segundos)}` : '\u00a0'}
        </p>
        {linhas.length > 0 ? (
          <button
            type="button"
            aria-expanded={processosAbertos}
            aria-controls="vps-processos"
            onClick={() => setProcessosAbertos((aberto) => !aberto)}
            className="ck-vps-botao flex shrink-0 items-center"
            style={{ minHeight: 'var(--ck-touch-min)', marginRight: 'calc(var(--ck-space-2) * -1)', paddingInline: 'var(--ck-space-2)' }}
          >
            <span
              className="ck-vps-pilula flex items-center"
              style={{
                gap: 'var(--ck-space-1)',
                minHeight: '28px',
                padding: '0 var(--ck-space-3)',
                borderRadius: 'var(--ck-radius-pill)',
                fontSize: 'var(--ck-text-xs)',
                fontWeight: 500,
                color: 'var(--ck-text-primary)',
              }}
            >
              processos
              <Chevron />
            </span>
          </button>
        ) : null}
      </div>

      {linhas.length > 0 && processosAbertos ? (
        <div
          id="vps-processos"
          role="table"
          aria-label="Processos que mais consomem"
          className="ck-vps-bloco ck-tabular grid items-baseline"
          style={{
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            gap: 'var(--ck-space-1) var(--ck-space-3)',
            padding: 'var(--ck-space-2) var(--ck-space-3)',
            marginBottom: 'var(--ck-space-2)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {/* Rótulo CPU/RAM uma vez só, no cabeçalho: sobra linha para o nome
              inteiro, que quebra em vez de ganhar reticências. */}
          <div role="row" className="contents">
            <span role="columnheader">processo</span>
            <span role="columnheader" style={{ textAlign: 'right' }}>CPU</span>
            <span role="columnheader" style={{ textAlign: 'right' }}>RAM</span>
          </div>
          {linhas.map((linha) => (
            <div key={linha.nome} role="row" className="contents">
              <span role="cell" style={{ color: 'var(--ck-text-primary)', overflowWrap: 'anywhere' }} title={linha.nome}>
                {nomeLegivel(linha.nome, agents)}
              </span>
              <span role="cell" style={{ textAlign: 'right' }}>{linha.cpu ?? '—'}</span>
              <span role="cell" style={{ textAlign: 'right' }}>{linha.ram ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
