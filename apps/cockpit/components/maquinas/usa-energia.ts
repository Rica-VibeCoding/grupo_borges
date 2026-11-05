/**
 * Uma leitura só do `/api/energia` para a tela inteira — a faixa de Ligar e
 * Desligar na Abertos e as linhas da home. A cada 15 s com a aba visível; com
 * uma ação em curso (ligando/desligando), a cada 5 s, para acompanhar o
 * desfecho. Liga no primeiro assinante e para no último, como os outros stores
 * das máquinas.
 *
 * `null` até a 1ª resposta; falha antes dela vale como lista vazia (quem espera
 * para desenhar não fica preso). Falha depois mantém a última leitura.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useSyncExternalStore } from 'react';

import { fetchEnergia, intervaloDaEnergia, type EnergiaMaquina } from '@/lib/energia';

let lista: EnergiaMaquina[] | null = null;
let parar: (() => void) | null = null;
let releAgora: (() => void) | null = null;
const ouvintes = new Set<() => void>();

function avisa() {
  ouvintes.forEach((o) => o());
}

function liga(): () => void {
  let emVoo = false;
  // Pedido de releitura com outra em voo: a em voo traz o estado de antes da
  // ação, então lê de novo assim que ela termina.
  let releDepois = false;
  let relogio: number | undefined;
  const agenda = () => {
    window.clearTimeout(relogio);
    relogio = window.setTimeout(rodada, intervaloDaEnergia(lista));
  };
  const rodada = () => {
    if (document.hidden) return agenda();
    if (emVoo) {
      releDepois = true;
      return;
    }
    emVoo = true;
    fetchEnergia()
      .then((nova) => {
        lista = nova;
        avisa();
      })
      .catch(() => {
        if (lista === null) {
          lista = [];
          avisa();
        }
      })
      .finally(() => {
        emVoo = false;
        if (releDepois) {
          releDepois = false;
          rodada();
        } else agenda();
      });
  };
  const aoVoltar = () => {
    if (!document.hidden) rodada();
  };
  releAgora = rodada;
  rodada();
  document.addEventListener('visibilitychange', aoVoltar);
  return () => {
    window.clearTimeout(relogio);
    document.removeEventListener('visibilitychange', aoVoltar);
    releAgora = null;
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

const semLeitura = (): EnergiaMaquina[] | null => null;

/** As máquinas com energia; `null` até a API responder. */
export function usaEnergia(): EnergiaMaquina[] | null {
  return useSyncExternalStore(assina, () => lista, semLeitura);
}

/** Depois de pedir Ligar/Desligar: relê já, sem esperar o ciclo. */
export function releEnergia(): void {
  releAgora?.();
}
