// A máquina do `/compact` de UM agente, sem React: fases, relógios, escape e
// retomada. Quem a compartilha entre as peças da tela é `compact.ts` (registry
// por slug + `usaCompact`); os números moram em
// `@grupo_borges/cockpit-core/compact-eta`.

import {
  ESCAPE_COMPACT_MS,
  JANELA_DURACOES_COMPACT,
  etaDoCompact,
} from '@grupo_borges/cockpit-core/compact-eta';

import {
  duracoesDe,
  gravarRegistro,
  lerRegistro,
  type ArmazenamentoCompact,
} from './memoria-do-compact.ts';

/** Quanto o 100% fica na tela antes de a barra sumir — o resumo chegou, a
 *  barra completa, respira um instante e vai embora. */
export const HOLD_CONCLUSAO_MS = 400;

/** Pane parou de compactar sem resumo: quanto ainda se espera o feed entregá-lo. */
export const GRACA_FIM_DO_PANE_MS = 10_000;

export type ConcluidoCompact = { uuid: string; duracaoMs: number };

/** Snapshot plano de propósito: `useSyncExternalStore` compara por identidade,
 *  e um objeto novo por transição (nunca por render) é o contrato. */
export type EstadoCompact = {
  fase: 'ocioso' | 'compactando' | 'concluindo' | 'sem-retorno';
  /** Início do compact corrente (relógio do cliente, no envio). Serve ao
   *  CRONÔMETRO da barra e a nada mais. */
  desdeMs: number | null;
  /**
   * A mesma largada, mas no relógio DO SERVIDOR — o timestamp da mensagem mais
   * recente que o feed tinha visto quando o `/compact` saiu.
   *
   * Existe porque a conclusão comparava `Date.parse(m.timestamp)` (servidor,
   * escrito no JSONL pela máquina do agente) com `desdeMs` (browser, o iPhone
   * do Rica). Dois relógios. Com o celular adiantado mais do que a duração do
   * compact, a guarda ficava falsa para sempre, `concluir` nunca disparava e o
   * composer ficava travado até o escape de 6 min — e voltava travado a cada
   * refresh, porque a retomada abaixo relê o início do storage. Foi assim que
   * uma mensagem do Rica sumiu em 05/08.
   *
   * `null` quando o feed ainda não viu mensagem nenhuma: aí não há linha de
   * base e qualquer resumo é novo por definição.
   */
  marcoServidorMs: number | null;
  /** ETA usado nesta rodada — calculado no `iniciar`, fixo durante a espera. */
  etaMs: number;
  /** Duração medida, preenchida na fase `concluindo`. */
  duracaoMs: number | null;
  /** O último resumo concluído NESTA aba — é dele que o cartão lê a duração
   *  medida. Sobrevive à volta pro `ocioso` de propósito. */
  ultimoConcluido: ConcluidoCompact | null;
};

export type DependenciasCompact = {
  agora?: () => number;
  agendar?: (callback: () => void, atrasoMs: number) => ReturnType<typeof setTimeout>;
  cancelar?: (timer: ReturnType<typeof setTimeout>) => void;
  storage?: ArmazenamentoCompact | null;
};

export type ControleCompact = {
  getEstado(): EstadoCompact;
  subscribe(ouvinte: () => void): () => void;
  /** Aplica a espera guardada no storage. Chamada DEPOIS da hidratação, nunca
   *  na construção — ver o corpo da função. */
  retomarDoStorage(): void;
  /** O composer mandou um `/compact`. Rearma se já havia um em voo — o segundo
   *  `/compact` substitui o primeiro, e o relógio é do segundo. */
  iniciar(): void;
  /** O feed avisa a hora do SERVIDOR que ele acabou de ver (timestamp da
   *  mensagem mais nova). Monotônico: só sobe. É daqui que sai o
   *  `marcoServidorMs` congelado no `iniciar`. */
  registrarRelogioDoServidor(tsMs: number): void;
  /** O resumo chegou no stream. `fimMs` é o timestamp DA MENSAGEM-resumo:
   *  a duração medida é do envio ao nascimento do resumo, não ao instante em
   *  que a aba reparou (importa quando ela estava em segundo plano). */
  concluir(uuid: string, fimMs?: number): void;
  /** Leitura do pane (`null` = sem leitura). Compactava e parou sem resumo →
   *  `sem-retorno` após a graça; `false` sem ter visto `true` não conta (fila). */
  reconciliar(emAndamento: boolean | null): void;
  /** Volta ao ocioso sem registrar duração — envio que falhou, destrava
   *  confirmado, dismiss do "sem retorno". */
  cancelar(): void;
  dispose(): void;
};

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
  /** A retomada é uma vez só por máquina — ver `retomarDoStorage`. */
  let retomou = false;
  let timerEscape: ReturnType<typeof setTimeout> | undefined;
  let timerHold: ReturnType<typeof setTimeout> | undefined;
  let visto = false, emGraca = false; // `visto`: o pane já acusou ESTE compact
  let duracoes = duracoesDe(lerRegistro(storage, agentSlug));
  /** Última hora do servidor que o feed reportou. Só sobe. */
  let relogioDoServidorMs: number | null = null;

  let estado: EstadoCompact = {
    fase: 'ocioso',
    desdeMs: null,
    marcoServidorMs: null,
    etaMs: etaDoCompact(duracoes),
    duracaoMs: null,
    ultimoConcluido: null,
  };

  function persistir(proximo: { inicio: number | null; marco: number | null }): void {
    gravarRegistro(storage, agentSlug, { duracoes, ...proximo });
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
    if (timerEscape !== undefined) cancelarTimer(timerEscape);
    emGraca = false;
    timerEscape = agendar(() => {
      timerEscape = undefined;
      // O sinal se perdeu: destrava o composer e diz a verdade. Se o resumo
      // chegar depois disto, o `concluir` ainda acolhe — ver lá.
      transicionar({ ...estado, fase: 'sem-retorno', duracaoMs: null });
    }, Math.max(0, restanteMs));
  }

  function registrarRelogioDoServidor(tsMs: number): void {
    if (!Number.isFinite(tsMs)) return;
    if (relogioDoServidorMs !== null && tsMs <= relogioDoServidorMs) return;
    relogioDoServidorMs = tsMs;
  }

  function iniciar(): void {
    if (descartado) return;
    limparTimers();
    visto = false;
    const desdeMs = agora();
    const marcoServidorMs = relogioDoServidorMs;
    persistir({ inicio: desdeMs, marco: marcoServidorMs });
    transicionar({
      ...estado,
      fase: 'compactando',
      desdeMs,
      marcoServidorMs,
      etaMs: etaDoCompact(duracoes),
      duracaoMs: null,
    });
    armarEscape(ESCAPE_COMPACT_MS);
  }

  function concluir(uuid: string, fimMs?: number): void {
    if (descartado) return;
    if (estado.fase !== 'compactando' && estado.fase !== 'sem-retorno') return;
    limparTimers();
    // A duração sai de um PAR COERENTE de relógios: marco e resumo são ambos
    // do servidor; largada e `agora()` são ambos do browser. Misturar os dois
    // é o que envenenava a mediana que alimenta o ETA.
    const duracaoMs =
      estado.marcoServidorMs !== null && fimMs !== undefined
        ? Math.max(0, fimMs - estado.marcoServidorMs)
        : Math.max(0, agora() - (estado.desdeMs ?? agora()));
    duracoes = [...duracoes, duracaoMs].slice(-JANELA_DURACOES_COMPACT);
    persistir({ inicio: null, marco: null });
    transicionar({
      ...estado,
      fase: 'concluindo',
      duracaoMs,
      ultimoConcluido: { uuid, duracaoMs },
    });
    timerHold = agendar(() => {
      timerHold = undefined;
      transicionar({
        ...estado,
        fase: 'ocioso',
        desdeMs: null,
        marcoServidorMs: null,
        duracaoMs: null,
      });
    }, HOLD_CONCLUSAO_MS);
  }

  function reconciliar(emAndamento: boolean | null): void {
    if (descartado || estado.fase !== 'compactando' || emAndamento === null) return;
    if (emAndamento) {
      visto = true;
      if (emGraca) armarEscape(ESCAPE_COMPACT_MS - (agora() - (estado.desdeMs ?? agora())));
    } else if (visto && !emGraca) {
      armarEscape(GRACA_FIM_DO_PANE_MS);
      emGraca = true;
    }
  }

  function cancelar(): void {
    if (descartado) return;
    limparTimers();
    persistir({ inicio: null, marco: null });
    transicionar({
      ...estado,
      fase: 'ocioso',
      desdeMs: null,
      marcoServidorMs: null,
      duracaoMs: null,
    });
  }

  /**
   * RETOMADA após navegação/refresh: se um compact começou há menos de 6min e
   * ninguém concluiu, a espera continua de onde estava — o feed reconclui
   * assim que o resumo aparecer no replay, e o escape cobre o caso do sinal
   * ter se perdido de verdade.
   *
   * NÃO roda na construção, e isso é o conserto de um hydration mismatch de
   * ESTRUTURA (tropa_task 3c58b8ec). Lendo o storage aqui, a máquina nascia
   * `compactando` no cliente e `ocioso` no servidor — que não tem
   * `localStorage` —, e a `BarraCompact` existia num lado e não no outro. A
   * doc do `useSyncExternalStore` é explícita: o `getServerSnapshot` "will be
   * used only during server rendering and during hydration of server-rendered
   * content on the client. The server snapshot must be the same between the
   * client and the server."
   *
   * Por isso ela é chamada por `usaCompact` num EFEITO, depois da hidratação,
   * e por isso passa por `transicionar` em vez de atribuir `estado` direto:
   * `transicionar` notifica os ouvintes, e sem essa notificação o React não
   * re-renderizaria (react#26095 — quando `subscribe` nunca chama o callback,
   * a divergência entre snapshot de cliente e de servidor não é reconciliada).
   *
   * Idempotente: o registry compartilha a máquina entre quatro peças e o
   * StrictMode monta duas vezes.
   */
  function retomarDoStorage(): void {
    if (descartado || retomou) return;
    retomou = true;
    const registro = lerRegistro(storage, agentSlug);
    const inicio = registro.inicio;
    if (typeof inicio !== 'number' || !Number.isFinite(inicio)) return;
    const decorrido = agora() - inicio;
    if (decorrido < 0 || decorrido >= ESCAPE_COMPACT_MS) {
      persistir({ inicio: null, marco: null });
      return;
    }
    // O marco do servidor volta junto: sem ele a espera retomada não teria
    // linha de base e o primeiro resumo VELHO do replay concluiria na hora.
    const marco = registro.marco;
    transicionar({
      ...estado,
      fase: 'compactando',
      desdeMs: inicio,
      marcoServidorMs: typeof marco === 'number' && Number.isFinite(marco) ? marco : null,
    });
    armarEscape(ESCAPE_COMPACT_MS - decorrido);
  }

  return {
    retomarDoStorage,
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    iniciar,
    reconciliar,
    registrarRelogioDoServidor,
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
