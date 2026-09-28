/**
 * A instância do cliente da espera de troca — uma por aba, viva entre as
 * rotas — ligada à rede de verdade. A regra mora em `esperas-de-troca.ts` e
 * `executor-de-troca.ts`, testáveis sem `fetch`.
 */
import { fetchAgentPainel } from '@grupo_borges/cockpit-core/api';
import { patchAgentEffort, postAgentModel } from '../../lib/acoes-no-agente.ts';

import { criaEsperasDeTroca } from './esperas-de-troca.ts';
import { criaExecutorDeTroca } from './executor-de-troca.ts';
import { fecharSePronto } from './operacao-de-motor.ts';
import { definirTrocaEmCurso, esquecerPainel, publicarPainel } from './sincronizacao-painel';

export const executorDeTroca = criaExecutorDeTroca({
  postModel: (slug, valor) => postAgentModel(slug, valor),
  patchEffort: (slug, valor) => patchAgentEffort(slug, valor),
  lePainel: (slug) => fetchAgentPainel(slug),
  // Tudo que o executor publica é de segundo plano: ver `ContextoDoPainel`.
  publicar: (painel) => publicarPainel(painel, { fundo: true }),
  fecharSePronto: (slug, tambem) => fecharSePronto(slug, tambem),
});

export const esperasDeTroca = criaEsperasDeTroca({
  // Todo envio ESQUECE o painel guardado do agente: o que estava lá é o motor
  // de antes da troca, e o chip que montar depois não pode nascer com ele.
  executar: (slug, pedido, recado) => {
    esquecerPainel(slug);
    return executorDeTroca(slug, pedido, recado);
  },
});

// Esperando ou trocando, o painel guardado não vale — ver `sincronizacao-painel.ts`.
definirTrocaEmCurso((slug) => {
  const estado = esperasDeTroca.ler(slug);
  return Boolean(estado.espera || estado.voando);
});
