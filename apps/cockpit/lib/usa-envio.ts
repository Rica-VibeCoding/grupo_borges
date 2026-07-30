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

/**
 * O back NÃO entrega a transcrição crua: `agents.py` faz
 * `send_message(sessão, f"🎙 {transcribed}")`. O eco volta pelo stream com esse
 * prefixo, e o texto que a UI conhece é a transcrição limpa — sem descascar,
 * a comparação do redutor nunca casa e TODO áudio termina em `pendurado`.
 *
 * Só descasca quando a tentativa corrente veio de voz. Descascar sempre
 * quebraria o caso legítimo de alguém digitar uma mensagem que começa com o
 * próprio emoji: o eco viria igual ao digitado, e tirar o prefixo de um lado só
 * criaria a falha que este código existe para evitar.
 */
export const PREFIXO_VOZ = /^🎙\s*/u;

export type RespostaVoz = {
  transcribed: string;
  /** Ausente hoje: `POST /{slug}/voice` não devolve a barreira que `/input`
   *  devolve. Enquanto não devolver, ela é sondada no servidor antes do POST —
   *  ver `sondarFronteira`. O campo já é lido para que a troca no back seja
   *  suficiente, sem tocar no cliente. */
  event_boundary_id?: number;
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
  postarVoz?: (agentSlug: string, audio: Blob) => Promise<RespostaVoz>;
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
  /** Sobe o áudio, e o que o servidor TRANSCREVEU entra na mesma máquina de
   *  seis fases do texto. Devolve a transcrição para a tela mostrar o que o
   *  agente recebeu — STT erra, e descobrir isso pela resposta errada do
   *  agente três minutos depois é caro. */
  enviarVoz(audio: Blob): Promise<string | null>;
  reenviar(): Promise<void>;
  dispose(): void;
};

/** Teto da sondagem de fronteira. Estourou, segue sem barreira do servidor:
 *  perder a confirmação é ruim, travar o áudio do Rica é pior. */
const PRAZO_SONDA_MS = 4_000;

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

  const postarVoz =
    dependencias.postarVoz ??
    (async (slug, audio) => {
      const { postAgentVoice } = await import('@grupo_borges/cockpit-core/api');
      return (await postAgentVoice(slug, audio)) as RespostaVoz;
    });

  let estado = estadoInicialEnvio;
  let descartado = false;
  let fonte: FonteEventosEnvio | null = null;
  let timerPrazo: Timer | undefined;
  let timerReconexao: Timer | undefined;
  let cursor = 0;
  /** A tentativa corrente veio de voz — só nela o prefixo do back é descascado. */
  let vozEmVoo = false;
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
          item: {
            id: payload.id,
            papel: 'user',
            texto: vozEmVoo ? texto.replace(PREFIXO_VOZ, '') : texto,
          },
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

  /**
   * Fronteira do servidor quando o POST não a devolve — o caso da voz hoje.
   *
   * Não é o mesmo que "o último evento que o cliente viu": o `id` sai do
   * servidor, lido do servidor, antes de o áudio sequer subir. `recentes=1&
   * limit=1` existe no endpoint justamente para entregar a PONTA do histórico
   * em vez do começo, então isto é uma leitura curta, não um replay.
   *
   * A janela entre a leitura e a entrega é grande de propósito e inofensiva: o
   * STT roda no servidor e leva segundos, e a barreira só serve para descartar
   * ecos ANTERIORES ao envio. Um item que entre no meio só confundiria se
   * tivesse exatamente o mesmo texto da transcrição.
   */
  function sondarFronteira(): Promise<FronteiraEnvio | null> {
    if (!FonteEventos) return Promise.resolve(null);
    return new Promise((resolve) => {
      let maior = 0;
      let respondeu = false;
      const sonda = new FonteEventos(
        `/api/agents/${encodeURIComponent(agentSlug)}/messages/stream?since_id=0&limit=1&recentes=1`,
      );
      // `completa` separa "o servidor respondeu e o histórico acabou" de "a
      // sonda morreu no meio". Só o primeiro caso autoriza a fronteira 0 —
      // agente sem nenhum evento tem barreira legítima em 0, e tratar isso como
      // falha penduraria todo primeiro áudio de uma sessão nova.
      const terminar = (completa: boolean) => {
        if (respondeu) return;
        respondeu = true;
        cancelar(timerSonda);
        sonda.close();
        resolve(completa || maior > 0 ? fronteiraDo(maior) : null);
      };
      const timerSonda = agendar(() => terminar(false), PRAZO_SONDA_MS);
      sonda.addEventListener('message', (evento) => {
        try {
          const payload = JSON.parse(evento.data) as MessagePayload;
          if (Number.isSafeInteger(payload.id)) maior = Math.max(maior, payload.id);
        } catch {
          // Evento malformado não invalida a sonda.
        }
      });
      sonda.addEventListener('replay-end', () => terminar(true));
      sonda.onerror = () => terminar(false);
    });
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
    vozEmVoo = false;
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

  /**
   * O áudio entra na MESMA máquina de seis fases do texto — não é economia de
   * código: o `/voice` devolve o mesmo `tmux_delivered` literal que mente para
   * o texto (prova a colagem no pane, não que o agente recebeu). Dar à voz uma
   * confirmação própria reproduziria o defeito num lugar novo.
   *
   * A ordem aqui é a única possível: só existe texto DEPOIS do STT. Por isso a
   * fronteira é sondada ANTES do POST — depois dele o eco já pode ter passado.
   */
  async function executarVoz(audio: Blob): Promise<string | null> {
    if (descartado || estado.fase === 'enviando' || estado.fase === 'aceito') {
      return null;
    }
    limparTimerPrazo();
    limparTimerReconexao();
    fecharFonte();

    const fronteiraSondada = await sondarFronteira();
    if (descartado) return null;

    let transcrito: string;
    let fronteira: FronteiraEnvio | null;
    try {
      const resposta = await postarVoz(agentSlug, audio);
      transcrito = resposta.transcribed;
      fronteira =
        typeof resposta.event_boundary_id === 'number'
          ? fronteiraDo(resposta.event_boundary_id)
          : fronteiraSondada;
    } catch (erro) {
      // Não sujar a máquina de envio: sem transcrição não existe texto, e um
      // `falhou` com texto vazio ofereceria "reenviar"/"copiar" sobre nada —
      // botão que não responde, o defeito da §9 com outra roupa. Falha de STT
      // é problema da CAPTURA e é a captura que sabe explicá-la, então o erro
      // sobe para quem gravou.
      throw erro;
    }

    if (descartado) return transcrito;
    vozEmVoo = true;
    publicar({ tipo: 'enviar', texto: transcrito, fronteira: fronteira ?? undefined });
    if (fronteira) {
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira });
      observar(fronteira);
      armarPrazo();
    } else {
      // Sem barreira não há como distinguir o eco do envio de um item anterior.
      // Confirmar assim mesmo seria adivinhar, e adivinhar aqui é exatamente o
      // "enviado" mentiroso que esta máquina existe para matar. Fica pendurado:
      // entregue, sem confirmação observável — que é a verdade.
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira: fronteiraDo(0) });
      publicar({ tipo: 'tempo-passou', agoraMs: agora() + PRAZO_ECO_MS });
    }
    return transcrito;
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    enviar: executar,
    enviarVoz: executarVoz,
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
  enviarVoz: (audio: Blob) => Promise<string | null>;
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
    enviarVoz: controle.enviarVoz,
    reenviar: controle.reenviar,
  };
}
