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
 * a comparação do redutor nunca casa e TODO áudio termina em `nao-confirmado`.
 *
 * Só descasca quando a tentativa corrente veio de voz. Descascar sempre
 * quebraria o caso legítimo de alguém digitar uma mensagem que começa com o
 * próprio emoji: o eco viria igual ao digitado, e tirar o prefixo de um lado só
 * criaria a falha que este código existe para evitar.
 */
export const PREFIXO_VOZ = /^🎙\s*/u;

export type RespostaVoz = {
  transcribed: string;
  /** `false` é sinal negativo do próprio backend, não mera falta de eco. */
  tmux_delivered?: boolean;
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

/**
 * O `kind: "queued"` do backend (commit 640282c): quando o agente está no
 * meio de um turno, o CLI enfileira a mensagem (`queue-operation`/`enqueue`)
 * e o stream emite este evento — com `message: null` e o texto no `content`
 * de fora. É o recibo de entrega da fila: chega em segundos, enquanto o eco
 * `user` só nasce quando a fila drena — minutos depois.
 */
function textoEnfileirado(payload: MessagePayload): string | null {
  if (payload.kind !== 'queued') return null;
  return typeof payload.content === 'string' && payload.content.length > 0 ? payload.content : null;
}

function textoDaMensagem(
  payload: MessagePayload,
): { texto: string; papel: 'user' | 'fila' } | null {
  const daFila = textoEnfileirado(payload);
  if (daFila !== null) return { texto: daFila, papel: 'fila' };
  if (payload.kind === 'queued') return null;
  if (payload.message?.role !== 'user') return null;
  const conteudo = payload.message.content;
  const texto =
    typeof conteudo === 'string'
      ? conteudo
      : conteudo
          .filter(
            (parte): parte is Extract<ContentPart, { type: 'text' }> =>
              parte.type === 'text',
          )
          .map((parte) => parte.text)
          .join('');
  return { texto, papel: 'user' };
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
        const extraido = textoDaMensagem(payload);
        if (extraido === null) return;
        publicar({
          tipo: 'item-do-stream',
          item: {
            id: payload.id,
            papel: extraido.papel,
            texto: vozEmVoo ? extraido.texto.replace(PREFIXO_VOZ, '') : extraido.texto,
          },
        });
        // Confirmado pela fila NÃO encerra a observação: o eco `user` da
        // drenagem ainda precisa chegar para apagar a marca `fila` — senão o
        // composer fica preso no "entrou na fila" para sempre.
        if (estado.fase === 'confirmado' && estado.fila !== true) {
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
        // queda, um eco pode ser perdido e o envio ficará
        // `nao-confirmado`. Não há reconciliação adicional nesta rodada.
        // Confirmado pela fila também reconecta: a observação continua de pé
        // esperando o eco da drenagem (ver o handler de `message` acima).
        const aguardandoEco =
          estado.fase === 'aceito' ||
          estado.fase === 'nao-confirmado' ||
          (estado.fase === 'confirmado' && estado.fila === true);
        // `'fronteira' in estado` em vez de confiar na fase: o `aguardandoEco`
        // é uma disjunção composta, e o TS não estreita o union por ela.
        if (aguardandoEco && 'fronteira' in estado && estado.fronteira !== undefined) {
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
      // `tmux_delivered: false` é AUSÊNCIA DE PROVA, não erro. O `send_message`
      // só devolve `true` com prova observável no pane (input vazio ou linha
      // transcrita, tetos de 8s e 6s); pane em turno ativo não mostra essa prova
      // e o texto entra na fila do CC do mesmo jeito. Medido em 04/08 no anexo:
      // 2 de 3 envios voltaram `false` e chegaram nas duas vezes.
      //
      // Por isso o destino é `nao-confirmado` e não `falhou`. A diferença não é
      // de palavra: `falhou` afirma que a mensagem não saiu daqui e oferece
      // "tentar de novo" como o caminho óbvio — e reenviar um texto que ENTROU
      // faz o agente rodar o mesmo comando duas vezes, que é pior que arquivo
      // duplicado. `nao-confirmado` diz que não deu para confirmar, manda
      // conferir no chat antes e avisa que pode duplicar; e o redutor já conta
      // `ecosIguaisSemDono` quando o mesmo texto volta, então a máquina foi
      // desenhada para exatamente este caso.
      //
      // `falhou` continua existindo e continua sendo o destino de erro HTTP
      // real — rejeição, rede, 4xx/5xx. Só o `tmux_delivered` mudou de lado.
      if (!resposta.tmux_delivered) {
        publicar({
          tipo: 'nao-confirmar',
          erro: new Error('O backend não conseguiu provar a entrega no pane — o texto pode ter entrado'),
        });
        return;
      }
      const fronteira = fronteiraDo(resposta.event_boundary_id);
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira });
      observar(fronteira);
      armarPrazo();
    } catch (erro) {
      if (descartado) return;
      const rejeicaoHttp =
        typeof erro === 'object' &&
        erro !== null &&
        'status' in erro &&
        typeof erro.status === 'number';
      publicar(
        rejeicaoHttp ? { tipo: 'falhar', erro } : { tipo: 'nao-confirmar', erro },
      );
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
    let entregueNoTmux: boolean;
    try {
      const resposta = await postarVoz(agentSlug, audio);
      transcrito = resposta.transcribed;
      entregueNoTmux = resposta.tmux_delivered !== false;
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
    // Mesma regra do texto (ver o comentário em `executar`): `tmux_delivered`
    // falso é ausência de prova, não erro, e `falhou` afirmaria que o áudio não
    // saiu daqui. Deixar a voz gritando "não recebeu" enquanto texto e anexo já
    // falam de incerteza seria três linguagens para o mesmo fato.
    if (!entregueNoTmux) {
      publicar({
        tipo: 'nao-confirmar',
        erro: new Error('O backend não conseguiu provar a entrega no pane — o áudio pode ter entrado'),
      });
      return transcrito;
    }
    if (fronteira) {
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira });
      observar(fronteira);
      armarPrazo();
    } else {
      // Sem barreira não há como distinguir o eco do envio de um item anterior.
      // Confirmar assim mesmo seria adivinhar, e adivinhar aqui é exatamente o
      // "enviado" mentiroso que esta máquina existe para matar. Fica não
      // confirmado:
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
      if (estado.fase !== 'nao-confirmado') return;
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
