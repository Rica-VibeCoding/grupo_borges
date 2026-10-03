'use client';

/**
 * A frota viva do painel do cliente: o par do `useFrotaAoVivo`, com a fonte que
 * o portão serve (`lib/frota-do-cliente.ts` explica a montagem).
 *
 * Sem SSE de frota no portão, o que resta é a mesma rede de segurança que a
 * frota já roda ao lado do SSE: releitura a cada 5 s, parada com a aba
 * escondida e imediata ao voltar. Para o estado não ficar até 5 s atrás da
 * tela, dois atalhos: o `/painel` que a gaveta ou o composer publicam já traz
 * a presença (Ligar/Desligar aparecem sem pedido novo), e quem sabe que algo
 * mudou — envio, virada do turno no feed — chama `pedeReleituraDaFrota`, com
 * as releituras espaçadas pela régua da frota (`atrasoDaReleitura`). Evento de
 * estado por SSE no portão trocaria tudo isto por empurrão.
 *
 * Sessão expirada (401) leva ao `/entrar`: a releitura é o primeiro pedido a
 * descobrir, e sem isto a tela ficaria parada com o último retrato.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentPainelResponse, FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { ouvirPainel } from '../components/shell/sincronizacao-painel';
import { agenteDoCliente, frotaDoCliente, type AgenteCru } from './frota-do-cliente';
import { EVENTO_RELEIA_FROTA, atrasoDaReleitura, mesmaFrota } from './frota-releitura';

const RELEITURA_MS = 5_000;

class SemSessao extends Error {}

async function leJson<T>(url: string): Promise<T> {
  const resposta = await fetch(url, { cache: 'no-store' });
  if (resposta.status === 401) throw new SemSessao();
  if (!resposta.ok) throw new Error(`${url} ${resposta.status}`);
  return resposta.json() as Promise<T>;
}

export function useFrotaDoCliente(inicial: FleetResponse): FleetResponse {
  const [frota, setFrota] = useState(inicial);
  const atual = useRef(inicial);
  const ultimoCru = useRef<AgenteCru | null>(inicial.agents[0] ?? null);
  const slug = inicial.agents[0]?.slug ?? null;

  const monta = useCallback((cru: AgenteCru, painel: AgentPainelResponse | null) => {
    const agoraS = Math.floor(Date.now() / 1_000);
    const nova = frotaDoCliente([agenteDoCliente(cru, painel, agoraS)], agoraS);
    if (mesmaFrota(atual.current, nova)) return;
    atual.current = nova;
    setFrota(nova);
  }, []);

  const releia = useCallback(async () => {
    if (!slug) return;
    const base = `/api/agents/${encodeURIComponent(slug)}`;
    try {
      // O `/painel` falhar não apaga o agente: sem ele o status fica no lifecycle.
      const [cru, painel] = await Promise.all([
        leJson<AgenteCru>(base),
        leJson<AgentPainelResponse>(`${base}/painel`).catch((erro: unknown) => {
          if (erro instanceof SemSessao) throw erro;
          return null;
        }),
      ]);
      ultimoCru.current = cru;
      monta(cru, painel);
    } catch (erro) {
      if (erro instanceof SemSessao) window.location.assign('/entrar');
      // Rede caída: fica o último retrato, a próxima rodada tenta de novo.
    }
  }, [slug, monta]);

  useEffect(() => {
    if (!slug) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pedido: ReturnType<typeof setTimeout> | null = null;
    let ultimoPedidoMs: number | null = null;
    const agenda = () => {
      if (!vivo) return;
      timer = setTimeout(async () => {
        if (!document.hidden) await releia();
        agenda();
      }, RELEITURA_MS);
    };
    const aoVoltar = () => {
      if (!document.hidden) void releia();
    };
    // Pedido em rajada vira uma releitura só, e nunca duas a menos de 1 s.
    const aoPedido = () => {
      if (pedido || document.hidden) return;
      const agora = Date.now();
      const atraso = atrasoDaReleitura(agora, ultimoPedidoMs);
      ultimoPedidoMs = agora + atraso;
      pedido = setTimeout(() => {
        pedido = null;
        void releia();
      }, atraso);
    };
    const paraDeOuvir = ouvirPainel(slug, (painel) => {
      if (ultimoCru.current) monta(ultimoCru.current, painel);
    });
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener(EVENTO_RELEIA_FROTA, aoPedido);
    // O retrato do servidor não traz o `/painel`: a primeira leitura completa já.
    void releia();
    agenda();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      if (pedido) clearTimeout(pedido);
      paraDeOuvir();
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener(EVENTO_RELEIA_FROTA, aoPedido);
    };
  }, [slug, releia, monta]);

  return frota;
}
