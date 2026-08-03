'use client';

// A máquina do `/compact`, UMA POR AGENTE, compartilhada entre as quatro peças
// que precisam dela ao mesmo tempo: o composer (destrava/trava), a barra
// (desenha a espera), o feed (avisa que o resumo chegou) e o destrava do
// painel (pede confirmação antes de interromper).
//
// Por que store de módulo e não estado dentro do composer: quem sabe que o
// compact COMEÇOU é o composer (foi ele que mandou o texto), mas quem sabe que
// ele TERMINOU é o stream do feed (chegou o resumo). São dois componentes
// sem ancestral comum cliente — a página é Server Component. O registry por
// slug é a mesma receita do `usaEnvio`, só que compartilhada em vez de por
// componente, com refcount: o último a sair apaga, e o que precisa sobreviver
// à navegação (o início e as durações) vai para o localStorage.
//
// Os números (ETA 140s, teto 90%, escape 6min, mediana das últimas 5) moram
// em `@grupo_borges/cockpit-core/compact-eta` — aqui fica só a coreografia.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  ESCAPE_COMPACT_MS,
  JANELA_DURACOES_COMPACT,
  etaDoCompact,
} from '@grupo_borges/cockpit-core/compact-eta';

/** Quanto o 100% fica na tela antes de a barra sumir — o resumo chegou, a
 *  barra completa, respira um instante e vai embora. */
export const HOLD_CONCLUSAO_MS = 400;

export type ConcluidoCompact = { uuid: string; duracaoMs: number };

/** Snapshot plano de propósito: `useSyncExternalStore` compara por identidade,
 *  e um objeto novo por transição (nunca por render) é o contrato. */
export type EstadoCompact = {
  fase: 'ocioso' | 'compactando' | 'concluindo' | 'sem-retorno';
  /** Início do compact corrente (relógio do cliente, no envio). */
  desdeMs: number | null;
  /** ETA usado nesta rodada — calculado no `iniciar`, fixo durante a espera. */
  etaMs: number;
  /** Duração medida, preenchida na fase `concluindo`. */
  duracaoMs: number | null;
  /** O último resumo concluído NESTA aba — é dele que o cartão lê a duração
   *  medida. Sobrevive à volta pro `ocioso` de propósito. */
  ultimoConcluido: ConcluidoCompact | null;
};

export type ArmazenamentoCompact = Pick<Storage, 'getItem' | 'setItem'>;

export type DependenciasCompact = {
  agora?: () => number;
  agendar?: (callback: () => void, atrasoMs: number) => ReturnType<typeof setTimeout>;
  cancelar?: (timer: ReturnType<typeof setTimeout>) => void;
  storage?: ArmazenamentoCompact | null;
};

export type ControleCompact = {
  getEstado(): EstadoCompact;
  subscribe(ouvinte: () => void): () => void;
  /** O composer mandou um `/compact`. Rearma se já havia um em voo — o segundo
   *  `/compact` substitui o primeiro, e o relógio é do segundo. */
  iniciar(): void;
  /** O resumo chegou no stream. `fimMs` é o timestamp DA MENSAGEM-resumo:
   *  a duração medida é do envio ao nascimento do resumo, não ao instante em
   *  que a aba reparou (importa quando ela estava em segundo plano). */
  concluir(uuid: string, fimMs?: number): void;
  /** Volta ao ocioso sem registrar duração — envio que falhou, destrava
   *  confirmado, dismiss do "sem retorno". */
  cancelar(): void;
  dispose(): void;
};

type RegistroStorage = { duracoes?: unknown; inicio?: unknown };

function chaveStorage(agentSlug: string): string {
  return `cockpit:compact:v1:${agentSlug}`;
}

function lerRegistro(storage: ArmazenamentoCompact | null, slug: string): RegistroStorage {
  if (!storage) return {};
  try {
    const cru = storage.getItem(chaveStorage(slug));
    if (!cru) return {};
    const parsed: unknown = JSON.parse(cru);
    return parsed && typeof parsed === 'object' ? (parsed as RegistroStorage) : {};
  } catch {
    return {};
  }
}

function duracoesDe(registro: RegistroStorage): number[] {
  if (!Array.isArray(registro.duracoes)) return [];
  return registro.duracoes.filter(
    (d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0,
  );
}

export function createControleCompact(
  agentSlug: string,
  dependencias: DependenciasCompact = {},
): ControleCompact {
  const agora = dependencias.agora ?? Date.now;
  const agendar = dependencias.agendar ?? setTimeout;
  const cancelarTimer = dependencias.cancelar ?? clearTimeout;
  const storage =
    dependencias.storage !== undefined
      ? dependencias.storage
      : typeof globalThis.localStorage !== 'undefined'
        ? globalThis.localStorage
        : null;

  const ouvintes = new Set<() => void>();
  let descartado = false;
  let timerEscape: ReturnType<typeof setTimeout> | undefined;
  let timerHold: ReturnType<typeof setTimeout> | undefined;
  let duracoes = duracoesDe(lerRegistro(storage, agentSlug));

  let estado: EstadoCompact = {
    fase: 'ocioso',
    desdeMs: null,
    etaMs: etaDoCompact(duracoes),
    duracaoMs: null,
    ultimoConcluido: null,
  };

  function persistir(proximo: { inicio: number | null }): void {
    if (!storage) return;
    try {
      storage.setItem(
        chaveStorage(agentSlug),
        JSON.stringify({ duracoes, inicio: proximo.inicio }),
      );
    } catch {
      // Storage cheio/bloqueado não pode derrubar a espera — só a retomada
      // após navegação é perdida.
    }
  }

  function transicionar(proximo: EstadoCompact): void {
    if (descartado) return;
    estado = proximo;
    for (const ouvinte of ouvintes) ouvinte();
  }

  function limparTimers(): void {
    if (timerEscape !== undefined) cancelarTimer(timerEscape);
    if (timerHold !== undefined) cancelarTimer(timerHold);
    timerEscape = undefined;
    timerHold = undefined;
  }

  function armarEscape(restanteMs: number): void {
    timerEscape = agendar(() => {
      timerEscape = undefined;
      // O sinal se perdeu: destrava o composer e diz a verdade. Se o resumo
      // chegar depois disto, o `concluir` ainda acolhe — ver lá.
      transicionar({ ...estado, fase: 'sem-retorno', duracaoMs: null });
    }, Math.max(0, restanteMs));
  }

  function iniciar(): void {
    if (descartado) return;
    limparTimers();
    const desdeMs = agora();
    persistir({ inicio: desdeMs });
    transicionar({
      ...estado,
      fase: 'compactando',
      desdeMs,
      etaMs: etaDoCompact(duracoes),
      duracaoMs: null,
    });
    armarEscape(ESCAPE_COMPACT_MS);
  }

  function concluir(uuid: string, fimMs?: number): void {
    if (descartado) return;
    if (estado.fase !== 'compactando' && estado.fase !== 'sem-retorno') return;
    limparTimers();
    const desdeMs = estado.desdeMs ?? agora();
    const duracaoMs = Math.max(0, (fimMs ?? agora()) - desdeMs);
    duracoes = [...duracoes, duracaoMs].slice(-JANELA_DURACOES_COMPACT);
    persistir({ inicio: null });
    transicionar({
      ...estado,
      fase: 'concluindo',
      duracaoMs,
      ultimoConcluido: { uuid, duracaoMs },
    });
    timerHold = agendar(() => {
      timerHold = undefined;
      transicionar({ ...estado, fase: 'ocioso', desdeMs: null, duracaoMs: null });
    }, HOLD_CONCLUSAO_MS);
  }

  function cancelar(): void {
    if (descartado) return;
    limparTimers();
    persistir({ inicio: null });
    transicionar({ ...estado, fase: 'ocioso', desdeMs: null, duracaoMs: null });
  }

  // RETOMADA após navegação/refresh: se um compact começou há menos de 6min e
  // ninguém concluiu, a espera continua de onde estava — o feed reconclui
  // assim que o resumo aparecer no replay (o timestamp dele é posterior ao
  // início), e o escape cobre o caso do sinal ter se perdido de verdade.
  const inicio = lerRegistro(storage, agentSlug).inicio;
  if (typeof inicio === 'number' && Number.isFinite(inicio)) {
    const decorrido = agora() - inicio;
    if (decorrido >= 0 && decorrido < ESCAPE_COMPACT_MS) {
      estado = { ...estado, fase: 'compactando', desdeMs: inicio };
      armarEscape(ESCAPE_COMPACT_MS - decorrido);
    } else {
      persistir({ inicio: null });
    }
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    iniciar,
    concluir,
    cancelar,
    dispose() {
      if (descartado) return;
      descartado = true;
      limparTimers();
      ouvintes.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Registry por slug — uma máquina por agente, com refcount                    */
/* -------------------------------------------------------------------------- */

const registry = new Map<string, { controle: ControleCompact; referencias: number }>();

function adquirir(agentSlug: string): ControleCompact {
  let entrada = registry.get(agentSlug);
  if (!entrada) {
    entrada = { controle: createControleCompact(agentSlug), referencias: 0 };
    registry.set(agentSlug, entrada);
  }
  entrada.referencias += 1;
  return entrada.controle;
}

function soltar(agentSlug: string): void {
  const entrada = registry.get(agentSlug);
  if (!entrada) return;
  entrada.referencias -= 1;
  if (entrada.referencias > 0) return;
  entrada.controle.dispose();
  registry.delete(agentSlug);
}

export function usaCompact(agentSlug: string): {
  estado: EstadoCompact;
  iniciar: () => void;
  concluir: (uuid: string, fimMs?: number) => void;
  cancelar: () => void;
} {
  // A aquisição no render é deliberada e segura: `adquirir` é idempotente
  // para o mesmo slug (o segundo chamador recebe a MESMA máquina) e o
  // refcount fecha no efeito — um render descartado antes do commit nunca
  // incrementa, então nunca desbalanceia.
  const controle = useMemo(() => adquirir(agentSlug), [agentSlug]);
  const estado = useSyncExternalStore(
    controle.subscribe,
    controle.getEstado,
    controle.getEstado,
  );

  useEffect(() => {
    // O useMemo acima já contou uma referência; o efeito só agenda a saída.
    // StrictMode monta→desmonta→monta: o dispose no zero é imediato, mas a
    // remontagem recria a máquina e a retomada pelo storage recompõe a espera.
    return () => soltar(agentSlug);
  }, [agentSlug]);

  return {
    estado,
    iniciar: controle.iniciar,
    concluir: controle.concluir,
    cancelar: controle.cancelar,
  };
}
