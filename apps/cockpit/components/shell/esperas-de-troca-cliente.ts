/**
 * A instância do cliente da espera de troca — uma por aba, viva entre as
 * rotas — ligada à rede de verdade. A regra mora em `esperas-de-troca.ts` e
 * `executor-de-troca.ts`, testáveis sem `fetch`.
 */
import { fetchAgentPainel, patchAgentEffort, postAgentModel } from '@grupo_borges/cockpit-core/api';

import { criaEsperasDeTroca } from './esperas-de-troca.ts';
import { criaExecutorDeTroca } from './executor-de-troca.ts';
import { fecharSePronto } from './operacao-de-motor.ts';
import { publicarPainel } from './sincronizacao-painel';

export const executorDeTroca = criaExecutorDeTroca({
  postModel: (slug, valor) => postAgentModel(slug, valor),
  patchEffort: (slug, valor) => patchAgentEffort(slug, valor),
  lePainel: (slug) => fetchAgentPainel(slug),
  publicar: publicarPainel,
  fecharSePronto: (slug, tambem) => fecharSePronto(slug, tambem),
});

export const esperasDeTroca = criaEsperasDeTroca({ executar: executorDeTroca });
