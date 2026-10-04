'use client';

/**
 * A frota viva do painel do cliente: o par do `useFrotaAoVivo`, com a fonte que
 * o portão serve (`lib/frota-do-cliente.ts` explica a montagem).
 *
 * O estado é EMPURRADO: um `EventSource` no `/api/agents/{slug}/events` (route
 * handler com `no-transform`, senão o gzip segura os eventos). Cada `state` é
 * um retrato completo — agente, vida, contexto e o status já derivado pelo
 * back —, então não há cursor a guardar: reconectar é receber outro retrato.
 *
 * Três regras de conexão:
 * - queda de rede (`CONNECTING`) é do navegador, que religa sozinho;
 * - resposta recusada (`CLOSED`: 401, 403, 502) encerra o `EventSource` de vez.
 *   Aí o `/auth/me` decide: sem sessão vai ao `/entrar`, senha a trocar vai
 *   ao `/senha`, sessão boa é queda do lado de lá e a tela religa com espera
 *   crescente;
 * - aba escondida fecha a conexão, e voltar à aba abre outra.
 *
 * O `/painel` que Ligar/Desligar publicam (`ouvirPainel`) entra na hora, com o
 * status recalculado aqui: o portão faz a troca de energia e o próximo `state`
 * pode levar até a reconciliação do back para sair.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentStatus, FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { ouvirPainel } from '../components/shell/sincronizacao-painel';
import { agenteDoCliente, esperaParaReligar, frotaDoCliente, leEstado, type AgenteCru, type PainelDoEstado } from './frota-do-cliente';
import { mesmaFrota } from './frota-releitura';
import { confereSessao } from './sessao-no-navegador';

type Retrato = { cru: AgenteCru; painel: PainelDoEstado | null; status?: AgentStatus };

export function useFrotaDoCliente(inicial: FleetResponse): FleetResponse {
  const [frota, setFrota] = useState(inicial);
  const atual = useRef(inicial);
  const primeiro = inicial.agents[0];
  const ultimo = useRef<Retrato | null>(primeiro ? { cru: primeiro, painel: null } : null);
  const slug = primeiro?.slug ?? null;

  const monta = useCallback((retrato: Retrato) => {
    ultimo.current = retrato;
    const agoraS = Math.floor(Date.now() / 1_000);
    const nova = frotaDoCliente([agenteDoCliente(retrato.cru, retrato.painel, agoraS, retrato.status)], agoraS);
    if (mesmaFrota(atual.current, nova)) return;
    atual.current = nova;
    setFrota(nova);
  }, []);

  useEffect(() => {
    if (!slug) return;
    const url = `/api/agents/${encodeURIComponent(slug)}/events`;
    let vivo = true;
    let fonte: EventSource | null = null;
    let religar: ReturnType<typeof setTimeout> | null = null;
    let tentativa = 0;

    const fecha = () => {
      fonte?.close();
      fonte = null;
      if (religar) clearTimeout(religar);
      religar = null;
    };

    const abre = () => {
      if (!vivo || fonte || document.hidden) return;
      const esta = new EventSource(url);
      fonte = esta;
      esta.addEventListener('open', () => {
        tentativa = 0;
      });
      esta.addEventListener('state', (evento) => {
        const estado = leEstado((evento as MessageEvent<string>).data);
        if (!estado || estado.agent.slug !== slug) return;
        monta({ cru: estado.agent, painel: estado.painel, status: estado.status });
      });
      esta.addEventListener('error', () => {
        if (esta.readyState !== EventSource.CLOSED || fonte !== esta) return;
        fonte = null;
        void confereSessao().then((rumo) => {
          if (!vivo) return;
          if (rumo) {
            window.location.assign(rumo);
            return;
          }
          religar = setTimeout(() => {
            religar = null;
            abre();
          }, esperaParaReligar(tentativa++));
        });
      });
    };

    const aoMudarAba = () => {
      if (document.hidden) fecha();
      else abre();
    };
    const paraDeOuvir = ouvirPainel(slug, (painel) => {
      if (ultimo.current) monta({ cru: ultimo.current.cru, painel });
    });
    document.addEventListener('visibilitychange', aoMudarAba);
    abre();
    return () => {
      vivo = false;
      fecha();
      paraDeOuvir();
      document.removeEventListener('visibilitychange', aoMudarAba);
    };
  }, [slug, monta]);

  return frota;
}
