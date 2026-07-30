'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { AgentInputResponse } from '@grupo_borges/cockpit-core/api';
import type {
  ContentPart,
  MessagePayload,
} from '@grupo_borges/cockpit-core/messages-types';

import {
  estadoInicialEnvio,
  PRAZO_ECO_MS,
  reduzEnvio,
  type EstadoEnvio,
  type EventoEnvio,
  type FronteiraEnvio,
} from './envio.ts';

type RespostaComFronteira = AgentInputResponse & {
  event_boundary_id: number;
};

type EventoSse = { data: string };
type OuvinteSse = (evento: EventoSse) => void;

export interface FonteEventosEnvio {
  addEventListener(tipo: string, ouvinte: OuvinteSse): void;
  close(): void;
  onerror: (() => void) | null;
}

export interface ConstrutorFonteEventosEnvio {
  new (url: string): FonteEventosEnvio;
}

type Timer = ReturnType<typeof setTimeout>;

export type DependenciasEnvio = {
  postar?: (agentSlug: string, texto: string) => Promise<RespostaComFronteira>;
  FonteEventos?: ConstrutorFonteEventosEnvio;
  agora?: () => number;
  agendar?: (callback: () => void, atrasoMs: number) => Timer;
  cancelar?: (timer: Timer) => void;
  atrasoReconexaoMs?: number;
};

export type ControleEnvio = {
  getEstado(): EstadoEnvio;
  subscribe(ouvinte: () => void): () => void;
  enviar(texto: string): Promise<void>;
  reenviar(): Promise<void>;
  dispose(): void;
};

function respostaTemFronteira(
  resposta: AgentInputResponse,
): resposta is RespostaComFronteira {
  const id = (resposta as Partial<RespostaComFronteira>).event_boundary_id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;
}

function textoDaMensagem(payload: MessagePayload): string | null {
  if (payload.message?.role !== 'user') return null;
  const conteudo = payload.message.content;
  if (typeof conteudo === 'string') return conteudo;
  return conteudo
    .filter(
      (parte): parte is Extract<ContentPart, { type: 'text' }> =>
        parte.type === 'text',
    )
    .map((parte) => parte.text)
    .join('');
}

function fronteiraDo(id: number): FronteiraEnvio {
  return { id, origem: 'barreira-do-servidor' };
}

export function createControleEnvio(
  agentSlug: string,
  dependencias: DependenciasEnvio = {},
): ControleEnvio {
  const postar =
    dependencias.postar ??
    (async (slug, texto) => {
      const { postAgentInput } = await import('@grupo_borges/cockpit-core/api');
      const resposta = await postAgentInput(slug, texto);
      if (!respostaTemFronteira(resposta)) {
        throw new Error('Resposta de envio sem event_boundary_id válido');
      }
      return resposta;
    });
  const FonteEventos =
    dependencias.FonteEventos ??
    (globalThis.EventSource as unknown as
      | ConstrutorFonteEventosEnvio
      | undefined);
  const agora = dependencias.agora ?? Date.now;
  const agendar = dependencias.agendar ?? setTimeout;
  const cancelar = dependencias.cancelar ?? clearTimeout;
  const atrasoReconexaoMs = dependencias.atrasoReconexaoMs ?? 1_000;

  let estado = estadoInicialEnvio;
  let descartado = false;
  let fonte: FonteEventosEnvio | null = null;
  let timerPrazo: Timer | undefined;
  let timerReconexao: Timer | undefined;
  let cursor = 0;
  const ouvintes = new Set<() => void>();

  function publicar(evento: EventoEnvio): void {
    if (descartado) return;
    const proximo = reduzEnvio(estado, evento);
    if (proximo === estado) return;
    estado = proximo;
    for (const ouvinte of ouvintes) ouvinte();
  }

  function limparTimerPrazo(): void {
    if (timerPrazo === undefined) return;
    cancelar(timerPrazo);
    timerPrazo = undefined;
  }

  function limparTimerReconexao(): void {
    if (timerReconexao === undefined) return;
    cancelar(timerReconexao);
    timerReconexao = undefined;
  }

  function fecharFonte(): void {
    fonte?.close();
    fonte = null;
  }

  function observar(fronteira: FronteiraEnvio): void {
    if (descartado || !FonteEventos) return;
    fecharFonte();
    cursor = Math.max(cursor, fronteira.id);
    const parametros = new URLSearchParams({ since_id: String(cursor), limit: '500' });
    const atual = new FonteEventos(
      `/api/agents/${encodeURIComponent(agentSlug)}/messages/stream?${parametros}`,
    );
    fonte = atual;

    atual.addEventListener('message', (evento) => {
      if (descartado || fonte !== atual) return;
      try {
        const payload = JSON.parse(evento.data) as MessagePayload;
        if (!Number.isSafeInteger(payload.id) || payload.id <= cursor) return;
        cursor = payload.id;
        const texto = textoDaMensagem(payload);
        if (texto === null) return;
        publicar({
          tipo: 'item-do-stream',
          item: { id: payload.id, papel: 'user', texto },
        });
        if (estado.fase === 'confirmado') {
          limparTimerPrazo();
          limparTimerReconexao();
          fecharFonte();
        }
      } catch {
        // Evento malformado não move o cursor nem derruba a observação.
      }
    });

    atual.onerror = () => {
      if (descartado || fonte !== atual || timerReconexao !== undefined) return;
      fecharFonte();
      timerReconexao = agendar(() => {
        timerReconexao = undefined;
        // O endpoint reexecuta o replay a partir deste cursor. Ainda assim, se
        // o servidor algum dia não conseguir reter/replayar o intervalo da
        // queda, um eco pode ser perdido e o envio ficará `pendurado`. Não há
        // reconciliação adicional nesta rodada.
        if (
          (estado.fase === 'aceito' || estado.fase === 'pendurado') &&
          estado.fronteira !== undefined
        ) {
          observar(estado.fronteira);
        }
      }, atrasoReconexaoMs);
    };
  }

  function armarPrazo(): void {
    limparTimerPrazo();
    if (estado.fase !== 'aceito') return;
    timerPrazo = agendar(() => {
      timerPrazo = undefined;
      publicar({ tipo: 'tempo-passou', agoraMs: agora() });
    }, Math.max(0, estado.aceitoEmMs + PRAZO_ECO_MS - agora()));
  }

  async function executar(texto: string): Promise<void> {
    if (
      descartado ||
      !texto.trim() ||
      estado.fase === 'enviando' ||
      estado.fase === 'aceito'
    ) {
      return;
    }
    limparTimerPrazo();
    limparTimerReconexao();
    fecharFonte();
    publicar({ tipo: 'enviar', texto });
    try {
      const resposta = await postar(agentSlug, texto);
      if (descartado) return;
      const fronteira = fronteiraDo(resposta.event_boundary_id);
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira });
      observar(fronteira);
      armarPrazo();
    } catch (erro) {
      if (descartado) return;
      publicar({
        tipo: 'falhar',
        erro,
        entregaIncerta:
          typeof erro !== 'object' ||
          erro === null ||
          !('status' in erro) ||
          typeof erro.status !== 'number',
      });
    }
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    enviar: executar,
    async reenviar() {
      if (estado.fase !== 'pendurado') return;
      await executar(estado.texto);
    },
    dispose() {
      if (descartado) return;
      descartado = true;
      limparTimerPrazo();
      limparTimerReconexao();
      fecharFonte();
      ouvintes.clear();
    },
  };
}

export function usaEnvio(agentSlug: string): {
  estado: EstadoEnvio;
  enviar: (texto: string) => Promise<void>;
  reenviar: () => Promise<void>;
} {
  const controle = useMemo(() => createControleEnvio(agentSlug), [agentSlug]);
  const estado = useSyncExternalStore(
    controle.subscribe,
    controle.getEstado,
    controle.getEstado,
  );

  useEffect(() => {
    return () => controle.dispose();
  }, [controle]);

  return {
    estado,
    enviar: controle.enviar,
    reenviar: controle.reenviar,
  };
}
