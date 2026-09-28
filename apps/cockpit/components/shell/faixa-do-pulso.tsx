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

const LEITURA_MS = 15_000;

const COR: Record<TomDoPulso, string> = {
  ativo: 'var(--ck-state-running)',
  parado: 'var(--ck-text-tertiary)',
  'sem-sinal': 'var(--ck-state-attention)',
};

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

export function FaixaDoPulso({ leitura, alturas }: { leitura: LeituraDoPulso; alturas: number[] }) {
  const cor = COR[leitura.tom];
  const minutos = alturas.length;
  return (
    <div
      role="status"
      aria-label={`${leitura.frase} ${leitura.ha}`.trim()}
      className="flex flex-col"
      style={{ gap: 'var(--ck-space-2)' }}
    >
      <p className="flex items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: '8px', height: '8px', background: cor, transform: 'translateY(-1px)' }}
        />
        <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
          {leitura.frase}
        </span>
        {leitura.ha ? (
          <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>{leitura.ha}</span>
        ) : null}
      </p>
      <div aria-hidden className="flex items-end" style={{ gap: '2px', height: '28px' }}>
        {alturas.map((h, i) => (
          <span
            key={i}
            className="flex-1"
            style={{
              // Minuto vazio é chão de 2px na cor do fio: o vazio vira eixo,
              // não buraco — é a linha reta que mostra o travamento.
              height: h === 0 ? '2px' : `${Math.round(h * 100)}%`,
              borderRadius: '1px',
              background: h === 0 ? 'var(--ck-edge-hairline)' : cor,
            }}
          />
        ))}
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
