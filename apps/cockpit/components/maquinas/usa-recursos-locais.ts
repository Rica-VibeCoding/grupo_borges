/**
 * Uma leitura só do `/api/vps` — a máquina que o próprio cockpit mede ("VPS",
 * ou "Arsenal" no cockpit do Arsenal) — para a linha da tropa e a aba local da
 * tela Abertos. Mesmo desenho do `usa-resumo-da-maquina`: um ciclo de 10 s
 * dividido por todos, liga no primeiro assinante, para no último, pausa com a
 * aba escondida. Leitura que falha DEPOIS da primeira mantém a última.
 *
 * `comSensor` gruda: uma leitura com temperatura basta, para a linha e a grade
 * não voltarem à Swap quando o sensor falha numa rodada.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useSyncExternalStore } from 'react';

import { temSensor, type RecursosDaVps } from '@/components/shell/recursos-da-vps';

const INTERVALO_MS = 10_000;

/** `null` antes da 1ª resposta; `dados: null` quando a 1ª leitura falhou. */
export type RecursosLocais = { dados: RecursosDaVps | null; comSensor: boolean } | null;

let atual: RecursosLocais = null;
let parar: (() => void) | null = null;
const ouvintes = new Set<() => void>();

async function le(): Promise<RecursosDaVps> {
  const resposta = await fetch('/api/vps', { cache: 'no-store' });
  if (!resposta.ok) throw new Error(`/api/vps ${resposta.status}`);
  return resposta.json();
}

function liga(): () => void {
  let emVoo = false;
  const rodada = () => {
    // Aba escondida não mede: a leitura varre o `/proc` inteiro da máquina.
    if (document.hidden || emVoo) return;
    emVoo = true;
    le()
      .then((dados) => {
        atual = { dados, comSensor: temSensor(dados, atual?.comSensor ?? false) };
        ouvintes.forEach((avisa) => avisa());
      })
      .catch(() => {
        // A próxima rodada tenta de novo e a última leitura fica; sem nenhuma,
        // registra que respondeu, para a linha da tropa não esperar para sempre.
        if (atual === null) {
          atual = { dados: null, comSensor: false };
          ouvintes.forEach((avisa) => avisa());
        }
      })
      .finally(() => {
        emVoo = false;
      });
  };
  rodada();
  const ronda = window.setInterval(rodada, INTERVALO_MS);
  document.addEventListener('visibilitychange', rodada);
  return () => {
    window.clearInterval(ronda);
    document.removeEventListener('visibilitychange', rodada);
  };
}

function assina(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (!parar) parar = liga();
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0 && parar) {
      parar();
      parar = null;
    }
  };
}

const semLeitura = (): RecursosLocais => null;

/** A última leitura da máquina local, ou `null` antes da primeira. */
export function usaRecursosLocais(): RecursosLocais {
  return useSyncExternalStore(assina, () => atual, semLeitura);
}
