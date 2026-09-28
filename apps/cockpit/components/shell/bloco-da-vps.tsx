/**
 * O bloco da VPS — CPU, RAM, swap e disco no rodapé da tropa.
 *
 * Ordem do Rica (07/09): *"na sidebar do cockpit tivesse os consumos mais
 * importantes da vps, tipo ram e cpu e espaço"*. Mora na tropa porque ela
 * aparece nas três superfícies (rota `/`, gaveta do celular, faixa do desktop)
 * e o bloco tem que estar onde a lista de agentes estiver.
 *
 * Desde 28/09 é RELANCE: uma faixa de quatro medidas (rótulo, número, fio de
 * 2px LINEAR, 0 a 100), cor só acima do teto, e a lista de processos recolhida
 * atrás de "ver processos". Antes eram quatro barras largas mais a lista
 * aberta, e o bloco empurrava a tropa pra fora da tela do celular.
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

/**
 * Uma medida da faixa: rótulo, número e um fio de 2px embaixo.
 *
 * Até 27/09 eram quatro linhas de barra larga — a VPS ocupava mais altura que
 * três agentes e o 81% de CPU saía com a mesma tinta dos 21%. Agora é uma célula
 * de uma faixa de quatro: o número é o dado, o fio é o relance, e cor só existe
 * acima do teto de cada medida (`emAlerta`).
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
  const tinta = alerta ? 'var(--ck-state-attention)' : undefined;
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
      className="flex min-w-0 flex-col"
      style={{ gap: '2px' }}
      title={detalhe}
    >
      {/* Rótulo em cima, número embaixo: na coluna de 260px cada célula tem
          ~50px, e "Disco 60%" numa linha só não cabe. */}
      <span aria-hidden style={{ fontSize: 'var(--ck-text-xs)', color: tinta ?? 'var(--ck-text-secondary)' }}>
        {rotulo}
      </span>
      <span
        aria-hidden
        className="ck-tabular"
        style={{
          fontSize: 'var(--ck-text-sm)',
          color: tinta ?? (pct === null ? 'var(--ck-text-tertiary)' : 'var(--ck-text-primary)'),
        }}
      >
        {pct === null ? '—' : `${Math.round(pct)}%`}
      </span>
      <span
        aria-hidden
        className="block overflow-hidden"
        style={{
          height: '2px',
          borderRadius: 'var(--ck-radius-pill)',
          background: 'var(--ck-surface-composer)',
        }}
      >
        <span
          className="block"
          style={{
            width: `${fracaoDaBarra(pct) * 100}%`,
            height: '100%',
            background: tinta ?? 'var(--ck-text-tertiary)',
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
  const linhas = dados ? linhasDeVilao(dados) : [];

  return (
    <section
      aria-label="Recursos da VPS"
      className="flex shrink-0 flex-col border-t"
      style={{
        gap: 'var(--ck-space-3)',
        marginTop: 'auto',
        padding: 'var(--ck-space-4) var(--ck-space-3) 0',
        borderColor: 'var(--ck-edge-light)',
      }}
    >
      <div
        className="flex items-baseline"
        style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-xs)' }}
      >
        <span style={{ color: 'var(--ck-text-secondary)' }}>VPS</span>
        {dados ? (
          <span className="ml-auto" style={{ color: 'var(--ck-text-secondary)' }}>
            no ar {formataNoAr(dados.no_ar_segundos)}
          </span>
        ) : null}
      </div>

      {/* A faixa: quatro colunas iguais, e não quatro linhas. A altura é fixa
          antes da primeira leitura (traço no lugar do número), pra coluna não
          pular quando o dado chega. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--ck-space-3)' }}
      >
        {LINHAS.map((linha) => (
          <Medidor key={linha.medida} medida={linha.medida} rotulo={linha.rotulo} dados={dados} />
        ))}
      </div>

      {/* Carga e disco livre são os dois absolutos que decidem alguma coisa
          (fila de CPU; espaço antes de mandar limpar). */}
      <p
        className="ck-tabular"
        style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
      >
        {dados
          ? `carga ${formataCarga(dados.carga_1m)}, ${formataTamanho(dados.disco.livre_mb)} livres`
          : '\u00a0'}
      </p>

      {/* QUEM está comendo — ordem do Rica (07/09) — fica recolhido atrás de um
          toque: a lista aberta empurrava a tropa, e é consulta, não relance.
          Linha inteira como alvo (44px), porque no celular é o polegar. */}
      {linhas.length > 0 ? (
        <button
          type="button"
          aria-expanded={processosAbertos}
          aria-controls="vps-processos"
          onClick={() => setProcessosAbertos((aberto) => !aberto)}
          className="ck-veil flex items-center"
          style={{
            gap: 'var(--ck-space-1)',
            minHeight: 'var(--ck-touch-min)',
            margin: 'calc(var(--ck-space-2) * -1) calc(var(--ck-space-2) * -1) 0',
            padding: '0 var(--ck-space-2)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-text-primary)',
          }}
        >
          {processosAbertos ? 'esconder processos' : 'ver processos'}
          <Chevron />
        </button>
      ) : null}

      {linhas.length > 0 && processosAbertos ? (
        <ul id="vps-processos" className="flex flex-col" style={{ gap: '2px' }}>
          {linhas.map((linha) => (
            <li
              key={linha.nome}
              className="flex items-baseline"
              style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-xs)' }}
            >
              <span className="min-w-0 truncate" style={{ color: 'var(--ck-text-primary)' }}>
                {linha.nome}
              </span>
              <span
                className="ck-tabular ml-auto shrink-0"
                style={{ color: 'var(--ck-text-secondary)' }}
              >
                {linha.detalhe}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
