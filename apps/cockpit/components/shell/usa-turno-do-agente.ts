'use client';

/**
 * O agente está gerando? — e o `■` que o interrompe. Saiu de `composer.tsx`
 * (02/10) com o histórico das três rodadas: a frota, o turno vivo do stream, a
 * escrita viva da bolinha e o estado do toque de parar.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { assinaTurnoVivo, leTurnoVivo } from '../../lib/turno-vivo';
import { assinaEscritaViva, leEscritaViva } from '../../lib/escrita-viva';
import { usaFrota } from './frota-provider';

export function usaTurnoDoAgente(agentSlug: string) {
  // A frota já está montada acima (o feed a lê pelo mesmo hook); ler daqui
  // evita prop nova em `app/agente/[slug]/page.tsx`.
  const { agents } = usaFrota();
  // Positivo, e não uma negação: com a frota ainda não carregada isto é falso e
  // a porta continua segurando. Errar fechado aqui é o comportamento de ontem;
  // errar aberto manda um POST que o back recusa.
  const motorEnfileiraSozinho = agents.some(
    (a) => a.slug === agentSlug && (a.executor_kind ?? a.cli_default) === 'claude_code',
  );
  // O AGENTE ESTÁ GERANDO? Duas fontes, e escolher as duas certas levou três
  // rodadas em 15/08. O histórico, porque cada uma caiu por um motivo diferente:
  //
  // 1. `lifecycle_status` sozinho, que era o original. Ele é alimentado por hook
  //    e por vigia de JSONL, e chega no tempo do PAINEL: com um agente Claude
  //    Code ocioso recebendo mensagem, **o ■ não apareceu na tela em 100 s**.
  //    O freio não existia durante o turno inteiro.
  // 2. `lifecycle_status` com guarda de `status !== 'offline'`. Pegou os cinco
  //    agentes MORTOS que o `/api/fleet` jurava estarem `trabalhando`, e não
  //    pegou os VIVOS E OCIOSOS: o canarinho ficou `status=ocioso` com
  //    `lifecycle=trabalhando` preso, e o ■ pendurado no repouso — comendo o
  //    lugar do microfone no chat que o Rica mais usa. Achado do Daniel.
  //
  // O que os dois casos têm em comum: `lifecycle_status` é histórico de EVENTO e
  // não expira. Turno que morre sem despedida limpa — agente desligado, limite
  // de uso, sessão derrubada — deixa `trabalhando` para sempre. Ele serve para
  // pintar card; não serve para decidir se um controle existe.
  //
  // Então a fonte lenta passou a ser o `status`, que cruza sessão e processo e
  // sabe dizer `offline` e `ocioso`; e a fonte RÁPIDA é o `isRunning` do stream,
  // publicado pelo feed em `lib/turno-vivo.ts` — o mesmo booleano que acende o
  // "Pensando há 12 s" três centímetros acima. Uma cobre o que a outra atrasa, e
  // nenhuma das duas herda o campo que não expira.
  const daFrota = agents.find((a) => a.slug === agentSlug);
  const vivo = daFrota !== undefined && daFrota.status !== 'offline';
  const trabalhando = vivo && daFrota.status === 'trabalhando';
  const assinaTurno = useMemo(() => (fn: () => void) => assinaTurnoVivo(agentSlug, fn), [agentSlug]);
  const leTurno = useMemo(() => () => leTurnoVivo(agentSlug), [agentSlug]);
  // No servidor não há turno nenhum: o valor nasce de um stream do browser.
  const turnoVivo = useSyncExternalStore(assinaTurno, leTurno, () => false);
  // O segundo sinal do feed, só para a bolinha: pensar e responder têm caras
  // diferentes, e é a troca de cara que a faz valer sozinha.
  const assinaEscrita = useMemo(() => (fn: () => void) => assinaEscritaViva(agentSlug, fn), [agentSlug]);
  const leEscrita = useMemo(() => () => leEscritaViva(agentSlug), [agentSlug]);
  const escrevendo = useSyncExternalStore(assinaEscrita, leEscrita, () => false);
  const [parando, setParando] = useState(false);
  // O ■ SOME NO TOQUE, não quando o painel concorda. `lifecycle_status` é
  // alimentado por evento (JSONL) e chega atrasado. Botão que continua
  // oferecendo uma ação já executada é a mentira de UI da §9, e aqui ela
  // convida a um segundo toque num agente que já parou.
  const [interrompido, setInterrompido] = useState(false);
  const gerando = !interrompido && vivo && (trabalhando || turnoVivo);

  /** O `■`. Não pede confirmação: interromper é reversível — o texto continua no
   *  feed e mandar de novo recomeça — e um modal entre o dedo e o botão, no meio
   *  de uma geração que já desandou, é obstáculo, não proteção. */
  async function interromper(): Promise<void> {
    setParando(true);
    try {
      const { postAgentInterromper } = await import('@grupo_borges/cockpit-core/api');
      await postAgentInterromper(agentSlug);
      setInterrompido(true);
    } catch {
      // Sem recibo: o sinal honesto é o próprio agente parando de trabalhar, que
      // o `lifecycle_status` já reporta. Uma faixa de erro aqui competiria com
      // ele e envelheceria sozinha.
    } finally {
      setParando(false);
    }
  }

  return {
    daFrota,
    motorEnfileiraSozinho,
    turnoVivo,
    escrevendo,
    parando,
    setInterrompido,
    gerando,
    interromper,
  };
}
