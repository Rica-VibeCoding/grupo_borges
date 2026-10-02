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
// em `@grupo_borges/cockpit-core/compact-eta`; a coreografia (fases, relógios,
// escape, retomada) em `maquina-do-compact.ts`. Aqui ficam o registry e o hook.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createControleCompact,
  type ControleCompact,
  type EstadoCompact,
} from './maquina-do-compact.ts';

export {
  HOLD_CONCLUSAO_MS,
  createControleCompact,
  type EstadoCompact,
} from './maquina-do-compact.ts';
export type { ArmazenamentoCompact } from './memoria-do-compact.ts';

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
  registrarRelogioDoServidor: (tsMs: number) => void;
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
    // A RETOMADA MORA AQUI, não na construção da máquina. Efeito só roda no
    // cliente e só DEPOIS da hidratação, então o primeiro render bate com o
    // HTML do servidor — que é o que o `getServerSnapshot` exige ("must be the
    // same between the client and the server"). Ler o storage antes disto era
    // o hydration mismatch de estrutura da tropa_task 3c58b8ec: a barra do
    // compact existia no cliente e não existia no servidor.
    controle.retomarDoStorage();
    // O useMemo acima já contou uma referência; o efeito só agenda a saída.
    // StrictMode monta→desmonta→monta: o dispose no zero é imediato, mas a
    // remontagem recria a máquina e a retomada recompõe a espera.
    return () => soltar(agentSlug);
  }, [agentSlug, controle]);

  return {
    estado,
    iniciar: controle.iniciar,
    registrarRelogioDoServidor: controle.registrarRelogioDoServidor,
    concluir: controle.concluir,
    cancelar: controle.cancelar,
  };
}
