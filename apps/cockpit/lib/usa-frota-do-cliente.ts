'use client';

/**
 * A frota viva do painel do cliente: o par do `useFrotaAoVivo`, com a fonte que
 * o portão serve (`lib/frota-do-cliente.ts` explica a montagem).
 *
 * Sem SSE de frota no portão, o que resta é a mesma rede de segurança que a
 * frota já roda ao lado do SSE: releitura a cada 5 s, parada com a aba
 * escondida, imediata ao voltar e a cada `pedeReleituraDaFrota`. É a lacuna que
 * o relatório da tela do cliente aponta — evento de estado por SSE no portão
 * trocaria isto por empurrão.
 *
 * Sessão expirada (401) leva ao `/entrar`: a releitura é o primeiro pedido a
 * descobrir, e sem isto a tela ficaria parada com o último retrato.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentPainelResponse, FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { agenteDoCliente, frotaDoCliente, type AgenteCru } from './frota-do-cliente';
import { EVENTO_RELEIA_FROTA, mesmaFrota } from './frota-releitura';

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
  const slug = inicial.agents[0]?.slug ?? null;

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
      const agoraS = Math.floor(Date.now() / 1_000);
      const nova = frotaDoCliente([agenteDoCliente(cru, painel, agoraS)], agoraS);
      if (mesmaFrota(atual.current, nova)) return;
      atual.current = nova;
      setFrota(nova);
    } catch (erro) {
      if (erro instanceof SemSessao) window.location.assign('/entrar');
      // Rede caída: fica o último retrato, a próxima rodada tenta de novo.
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
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
    const aoPedido = () => void releia();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener(EVENTO_RELEIA_FROTA, aoPedido);
    // O retrato do servidor não traz o `/painel`: a primeira leitura completa já.
    void releia();
    agenda();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener(EVENTO_RELEIA_FROTA, aoPedido);
    };
  }, [slug, releia]);

  return frota;
}
