/**
 * Uma leitura só do `resumo` de cada máquina para a tela inteira.
 *
 * O selo do atalho Abertos e o mini cartão da máquina na tropa aparecem na mesma
 * raiz; cada um com o seu `setInterval` seriam duas requisições a cada 30 s
 * (plano v2, ajuste do Pavan). Aqui é um módulo com um ciclo por máquina,
 * dividido por todos os assinantes: liga no primeiro, para no último, e pausa
 * com a aba escondida — o mesmo `visibilitychange` do `BlocoDaVps`.
 *
 * Leitura que falha DEPOIS da primeira mantém a última na tela. A ponte já
 * devolve `online:false` com motivo quando a máquina some; a falha daqui é a
 * própria ponte fora.
 *
 * A lista de máquinas (id e nome) também vem daqui, lida uma vez por carga de
 * página: o nome da máquina muda e o front não
 * guarda nenhum — quem sabe é o `GET /api/maquinas`.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useSyncExternalStore } from 'react';

import { fetchMaquinas, fetchResumo, type Maquina, type Resumo } from '@/lib/maquinas';

const INTERVALO_MS = 30_000;

type Ciclo = {
  dados: Resumo | null;
  ouvintes: Set<() => void>;
  parar: (() => void) | null;
  subscribe: (ouvinte: () => void) => () => void;
  getSnapshot: () => Resumo | null;
};

const ciclos = new Map<string, Ciclo>();

function cicloDe(id: string): Ciclo {
  const existente = ciclos.get(id);
  if (existente) return existente;

  const ciclo: Ciclo = {
    dados: null,
    ouvintes: new Set(),
    parar: null,
    getSnapshot: () => ciclo.dados,
    subscribe: (ouvinte) => {
      ciclo.ouvintes.add(ouvinte);
      if (!ciclo.parar) ciclo.parar = liga(id, ciclo);
      return () => {
        ciclo.ouvintes.delete(ouvinte);
        if (ciclo.ouvintes.size === 0 && ciclo.parar) {
          ciclo.parar();
          ciclo.parar = null;
        }
      };
    },
  };
  ciclos.set(id, ciclo);
  return ciclo;
}

function liga(id: string, ciclo: Ciclo): () => void {
  let emVoo = false;
  const le = () => {
    if (document.hidden || emVoo) return;
    emVoo = true;
    fetchResumo(id)
      .then((novo) => {
        ciclo.dados = novo;
        ciclo.ouvintes.forEach((avisa) => avisa());
      })
      .catch(() => {
        /* a próxima rodada tenta de novo; a última leitura fica */
      })
      .finally(() => {
        emVoo = false;
      });
  };
  le();
  const ronda = window.setInterval(le, INTERVALO_MS);
  document.addEventListener('visibilitychange', le);
  return () => {
    window.clearInterval(ronda);
    document.removeEventListener('visibilitychange', le);
  };
}

const semLeitura = () => null;

/** O último `resumo` da máquina, ou `null` antes da primeira leitura. */
export function usaResumoDaMaquina(id: string): Resumo | null {
  const ciclo = cicloDe(id);
  return useSyncExternalStore(ciclo.subscribe, ciclo.getSnapshot, semLeitura);
}

// A lista: uma leitura por carga de página, dividida por quem pedir. Falhou,
// a próxima montagem tenta de novo.
let maquinas: Maquina[] | null = null;
let lendoMaquinas = false;
const ouvintesDaLista = new Set<() => void>();

function assinaLista(ouvinte: () => void): () => void {
  ouvintesDaLista.add(ouvinte);
  if (maquinas === null && !lendoMaquinas) {
    lendoMaquinas = true;
    fetchMaquinas()
      .then((lista) => {
        maquinas = lista;
        ouvintesDaLista.forEach((avisa) => avisa());
      })
      .catch(() => {
        /* sem lista, sem selo nem mini cartão */
      })
      .finally(() => {
        lendoMaquinas = false;
      });
  }
  return () => ouvintesDaLista.delete(ouvinte);
}

const SEM_MAQUINAS: Maquina[] = [];
const listaAtual = () => maquinas ?? SEM_MAQUINAS;
const listaDoServidor = () => SEM_MAQUINAS;

/** As máquinas que a API conhece; vazia até a primeira leitura. */
export function usaMaquinas(): Maquina[] {
  return useSyncExternalStore(assinaLista, listaAtual, listaDoServidor);
}
