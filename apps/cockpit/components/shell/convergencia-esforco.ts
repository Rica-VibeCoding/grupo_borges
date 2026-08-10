/**
 * A convergência do rótulo de esforço depois de uma troca `pendente` — o
 * PATCH devolveu `confirmed: false` (agente no meio de um turno, troca
 * enfileirada). `SeletorMotor` busca o `/painel` uma vez por `agentSlug`
 * (efeito com dependência fixa) e o ramo `pendente` só mostrava aviso: nada
 * refazia a leitura, e o rótulo travava no valor da montagem até o
 * componente desmontar — achado [3] da auditoria (09/08).
 *
 * Função pura de propósito, com relógio/agendamento injetáveis — mesma razão
 * do `compact.ts`: um `useEffect` que faz poll dentro do componente não é
 * observável por teste nenhum.
 */

export type DependenciasConvergencia = {
  agendar?: (callback: () => void, atrasoMs: number) => ReturnType<typeof setTimeout>;
  cancelar?: (timer: ReturnType<typeof setTimeout>) => void;
  intervaloMs?: number;
  /** Teto de tentativas — sem ele, um turno que nunca confirma pollaria para
   *  sempre. Esgotado, desiste em silêncio: reabrir o seletor já lê o painel
   *  de novo pela montagem normal do componente. */
  tentativasMax?: number;
};

export type ControleConvergencia = {
  parar(): void;
};

const INTERVALO_PADRAO_MS = 3_000;
const TENTATIVAS_MAX_PADRAO = 20; // ~60s no intervalo padrão

export function esperaConvergenciaDoEsforco<T extends { effort: { value: string | null } }>(
  valorPedido: string,
  lerPainel: () => Promise<T>,
  aoConvergir: (painel: T) => void,
  dependencias: DependenciasConvergencia = {},
): ControleConvergencia {
  const agendar = dependencias.agendar ?? setTimeout;
  const cancelarTimer = dependencias.cancelar ?? clearTimeout;
  const intervaloMs = dependencias.intervaloMs ?? INTERVALO_PADRAO_MS;
  const tentativasMax = dependencias.tentativasMax ?? TENTATIVAS_MAX_PADRAO;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let parado = false;
  let tentativas = 0;

  function passo(): void {
    timer = agendar(() => {
      timer = undefined;
      lerPainel()
        .then((painel) => {
          if (parado) return;
          if (painel.effort.value === valorPedido) {
            aoConvergir(painel);
            return;
          }
          tentativas += 1;
          if (tentativas >= tentativasMax) return;
          passo();
        })
        .catch(() => {
          // Rede caiu no meio do poll: não é o back dizendo "ainda não" — é
          // ausência de resposta. Conta como tentativa e tenta de novo, em
          // vez de desistir na primeira falha transitória.
          if (parado) return;
          tentativas += 1;
          if (tentativas >= tentativasMax) return;
          passo();
        });
    }, intervaloMs);
  }

  passo();

  return {
    parar() {
      parado = true;
      if (timer !== undefined) cancelarTimer(timer);
      timer = undefined;
    },
  };
}
