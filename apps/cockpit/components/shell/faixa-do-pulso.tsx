'use client';

/**
 * A FAIXA DO PULSO — topo da gaveta, acima de Destravar/Desligar. A régua
 * (o que é trabalho, descanso ou travamento) mora em `pulso-do-agente.ts`;
 * aqui ficam rede, relógio e pixel.
 *
 * Lê o `/pulso` a cada `LEITURA_MS` só com a gaveta aberta: fechada, ninguém
 * olha, e o painel já tem gente demais batendo na API.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchAgentPulso, type AgentPulsoResponse } from '@grupo_borges/cockpit-core/api';

import { assinaTurnoVivo, leTurnoVivo } from '../../lib/turno-vivo';
import { alturasDoPulso, leiaPulso, type LeituraDoPulso, type TomDoPulso } from './pulso-do-agente';
import { usaEstadoDaPilula } from './usa-estado-da-pilula';

const LEITURA_MS = 15_000;

const COR: Record<TomDoPulso, string> = {
  ativo: 'var(--ck-pulso-ouro)',
  parado: 'var(--ck-text-tertiary)',
  'sem-sinal': 'var(--ck-state-attention)',
};

/** Caixa do desenho. `preserveAspectRatio="none"` estica na largura da gaveta;
 *  o traço não engrossa junto por causa do `non-scaling-stroke`. */
const LARGURA = 300;
const ALTURA = 40;
const PISO = 38;
const TOPO = 4;

/** O fio: passa pelos pontos médios com cada balde de controle. Nunca
 *  ultrapassa o maior vizinho — Catmull-Rom desenharia pico que não existiu
 *  e vale abaixo do chão. */
function caminhoDoPulso(alturas: number[]): { linha: string; area: string } {
  const n = alturas.length;
  const pts = alturas.map((h, i) => [
    n === 1 ? LARGURA : (i / (n - 1)) * LARGURA,
    PISO - h * (PISO - TOPO),
  ]);
  let linha = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    linha += ` Q${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`;
  }
  linha += ` L${pts[n - 1][0]},${pts[n - 1][1]}`;
  return { linha, area: `${linha} L${LARGURA},${ALTURA} L0,${ALTURA} Z` };
}

export function usaPulso(slug: string, aberto: boolean): {
  leitura: LeituraDoPulso | null;
  alturas: number[];
} {
  const [pulso, setPulso] = useState<AgentPulsoResponse | null>(null);
  // O relógio anda entre leituras: "há 4 min" não pode congelar 15 s.
  const [agora, setAgora] = useState(() => Math.floor(Date.now() / 1000));
  const turnoVivo = useSyncExternalStore(
    (fn) => assinaTurnoVivo(slug, fn),
    () => leTurnoVivo(slug),
    () => false,
  );

  useEffect(() => {
    setPulso(null);
    if (!aberto) return;
    const controlador = new AbortController();
    const ler = () =>
      fetchAgentPulso(slug, controlador.signal)
        .then((novo) => {
          setPulso(novo);
          setAgora(Math.floor(Date.now() / 1000));
        })
        // Falhou a leitura: a faixa some em vez de mostrar pulso velho como vivo.
        .catch(() => { if (!controlador.signal.aborted) setPulso(null); });
    ler();
    const leitor = setInterval(ler, LEITURA_MS);
    const relogio = setInterval(() => setAgora(Math.floor(Date.now() / 1000)), 1_000);
    return () => {
      controlador.abort();
      clearInterval(leitor);
      clearInterval(relogio);
    };
  }, [slug, aberto]);

  if (!pulso) return { leitura: null, alturas: [] };
  return {
    leitura: leiaPulso({ agora, ultimoEvento: pulso.ultimo_evento, turnoVivo }),
    alturas: alturasDoPulso(pulso.baldes),
  };
}

export function FaixaDoPulso({ slug, leitura, alturas }: { slug: string; leitura: LeituraDoPulso; alturas: number[] }) {
  const cor = COR[leitura.tom];
  // O rótulo é o estado da pílula (mesma palavra, mesmo tom); o fio segue dourado, é gráfico.
  // "Sem sinal" fica: é o motivo escrito do "!" da gaveta, não um estado do agente.
  const estado = usaEstadoDaPilula(slug);
  const semSinal = leitura.tom === 'sem-sinal';
  const frase = semSinal ? leitura.frase : estado.rotulo.charAt(0).toUpperCase() + estado.rotulo.slice(1);
  const corDoEstado = semSinal ? cor : `var(--ck-tom-${estado.tom})`;
  const minutos = alturas.length;
  const desenho = alturas.length > 1 ? caminhoDoPulso(alturas) : { linha: '', area: '' };
  return (
    <div
      role="status"
      aria-label={`${frase} ${leitura.ha}`.trim()}
      className="flex flex-col"
      style={{ gap: 'var(--ck-space-2)' }}
    >
      <p className="flex items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: '8px', height: '8px', background: corDoEstado, transform: 'translateY(-1px)' }}
        />
        <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
          {frase}
        </span>
        {leitura.ha ? (
          <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>{leitura.ha}</span>
        ) : null}
      </p>
      {/* O FIO DE ENERGIA — pedido do Rica em 28/09: *"um raio dourado
          mostrando o desempenho da gente, mais futurístico, pra casar com a
          tela de voz"*. Área em degradê por baixo, traço com brilho, e o ponto
          do agora na ponta. Parado, o fio apaga pro cinza: ouro é só pra vida. */}
      <div aria-hidden className="relative" style={{ height: '40px' }}>
        {alturas.length > 1 ? (
          <svg
            viewBox={`0 0 ${LARGURA} ${ALTURA}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            style={{ filter: leitura.tom === 'parado' ? undefined : `drop-shadow(0 0 4px ${cor})` }}
          >
            <defs>
              <linearGradient id={`pulso-area-${leitura.tom}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={cor} stopOpacity={0.28} />
                <stop offset="1" stopColor={cor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`pulso-linha-${leitura.tom}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={cor} stopOpacity={0.25} />
                <stop offset="0.7" stopColor={cor} stopOpacity={0.9} />
                <stop offset="1" stopColor={cor} stopOpacity={1} />
              </linearGradient>
            </defs>
            <line
              x1={0} y1={PISO} x2={LARGURA} y2={PISO}
              stroke="var(--ck-edge-hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
            <path d={desenho.area} fill={`url(#pulso-area-${leitura.tom})`} />
            <path
              d={desenho.linha}
              fill="none"
              stroke={`url(#pulso-linha-${leitura.tom})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
        {alturas.length > 0 ? (
          <span
            className="ck-pulso-agora absolute rounded-full"
            data-vivo={String(leitura.tom === 'ativo')}
            style={{
              right: '-3px',
              // O ponto senta na ponta do fio: mesma conta do caminho, em %.
              top: `calc(${((PISO - alturas[alturas.length - 1] * (PISO - TOPO)) / ALTURA) * 100}% - 3px)`,
              width: '6px',
              height: '6px',
              background: leitura.tom === 'ativo' ? 'var(--ck-pulso-ouro-claro)' : cor,
            }}
          />
        ) : null}
      </div>
      <p
        aria-hidden
        className="flex justify-between"
        style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}
      >
        <span>{minutos} min atrás</span>
        <span>agora</span>
      </p>
    </div>
  );
}
