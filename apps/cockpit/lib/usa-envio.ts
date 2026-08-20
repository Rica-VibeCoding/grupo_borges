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
import { assinaEntrega, temPendencia } from './codex/eco-pendente.ts';
import { atrasoDaRetentativa, ehRecusaTransitoria } from './recusa-transitoria.ts';

/** Com que frequência reperguntar se o rollout já entregou. Um pouco acima do
 *  tique do poll do feed (3 s), que é quem descobre. */
const REEXAME_ROLLOUT_MS = 3_500;

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

/** O literal que o back prepende na transcrição antes de entregar ao agente —
 *  nos DOIS executores (`post_agent_voice`). O front precisa dele porque a
 *  bolha otimista do Codex casa por texto EXATO com o que chega no rollout
 *  (`reconciliaPendentes`): registrar sem a marca deixaria a pendência sem par
 *  e o composer preso em `aceito` até o prazo de 3 min expirar. */
export const MARCA_VOZ = '🎙 ';

export type OrigemEnvio = 'text' | 'stt';

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
  postar?: (
    agentSlug: string,
    texto: string,
    origem: OrigemEnvio,
  ) => Promise<RespostaComFronteira>;
  FonteEventos?: ConstrutorFonteEventosEnvio;
  agora?: () => number;
  agendar?: (callback: () => void, atrasoMs: number) => Timer;
  cancelar?: (timer: Timer) => void;
  atrasoReconexaoMs?: number;
};

export type ControleEnvio = {
  getEstado(): EstadoEnvio;
  subscribe(ouvinte: () => void): () => void;
  /** `aoFalhar` roda só quando o POST rejeita com erro HTTP real (fase
   *  `falhou`) — é o gancho para quem registrou uma pendência otimista ANTES
   *  do envio (`registraEcoPendente`, só Codex) desfazê-la, já que a máquina
   *  acabou de provar que o texto não saiu daqui. */
  enviar(texto: string, aoFalhar?: () => void, origem?: OrigemEnvio): Promise<void>;
  reenviar(aoFalhar?: () => void): Promise<void>;
  /** Recibo vindo de FORA do stream SSE. Existe porque o agente Codex não tem
   *  eco em `/messages/stream` (responde `total: 0`): quem prova a entrega dele
   *  é o texto aparecendo no rollout, visto pelo poll do feed
   *  (`lib/codex/eco-pendente.ts`). Sem isto, TODA mensagem pra Tara expirava o
   *  prazo de 12 s e terminava em âmbar, dizendo que podia não ter entrado. */
  confirmarPorEco(texto: string): void;
  dispose(): void;
};

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
    (async (slug, texto, origem) => {
      const { postAgentInput } = await import('@grupo_borges/cockpit-core/api');
      const resposta = await postAgentInput(slug, texto, { origin: origem });
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
  let timerRetentativa: Timer | undefined;
  let cursor = 0;
  /** A tentativa corrente preserva a origem STT até o eco voltar. */
  let vozEmVoo = false;
  let origemEmVoo: OrigemEnvio = 'text';
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

  function limparTimerRetentativa(): void {
    if (timerRetentativa === undefined) return;
    cancelar(timerRetentativa);
    timerRetentativa = undefined;
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
      // ENTREGA AINDA EM CURSO: os 12 s foram calibrados sobre uma amostra
      // local de 30/07 cujo pior caso era 1,434 s, e nenhum dos dois motores
      // cabe nisso. No Codex a prova leva ~12 s (o `codex exec` subindo) mais o
      // tique do poll; no Claude Code o eco medido em 15/08 é de **18,9 s**. O
      // alarme disparava sempre, e o texto dele manda o Rica reenviar — é assim
      // que se produz a duplicata que ele existe para avisar.
      //
      // Daqui em diante os 12 s são só a CADÊNCIA do reexame; quem decide o
      // alarme é o teto da pendência, e ele é por motor: 45 s no Claude Code,
      // 3 min no Codex (`PRAZO_CC_MS` / `PRAZO_CODEX_MS`, com o porquê da
      // diferença escrito lá). Expirou a pendência, o alarme volta a ser
      // verdadeiro.
      if (temPendencia(agentSlug)) {
        armarPrazoDeRollout();
        return;
      }
      publicar({ tipo: 'tempo-passou', agoraMs: agora() });
    }, Math.max(0, estado.aceitoEmMs + PRAZO_ECO_MS - agora()));
  }

  /** Reexame curto enquanto o rollout não entrega — não é um prazo novo, é o
   *  mesmo prazo perguntando de novo. */
  function armarPrazoDeRollout(): void {
    limparTimerPrazo();
    if (estado.fase !== 'aceito') return;
    timerPrazo = agendar(() => {
      timerPrazo = undefined;
      if (temPendencia(agentSlug)) {
        armarPrazoDeRollout();
        return;
      }
      publicar({ tipo: 'tempo-passou', agoraMs: agora() });
    }, REEXAME_ROLLOUT_MS);
  }

  async function executar(
    texto: string,
    aoFalhar?: () => void,
    origem: OrigemEnvio = 'text',
  ): Promise<void> {
    if (
      descartado ||
      !texto.trim() ||
      estado.fase === 'enviando' ||
      estado.fase === 'aceito'
    ) {
      return;
    }
    origemEmVoo = origem;
    vozEmVoo = origem === 'stt';
    limparTimerPrazo();
    limparTimerReconexao();
    limparTimerRetentativa();
    fecharFonte();
    publicar({ tipo: 'enviar', texto });
    await entregar(texto, aoFalhar, 0, origem);
  }

  /**
   * O POST em si, separado de `executar` para que a retentativa não precise
   * atravessar a guarda de entrada — que recusa `enviando`, exatamente a fase
   * em que a espera acontece.
   *
   * Ficar em `enviando` durante a espera é o ponto: a porta continua recusando
   * `envio-em-voo`, e o que o Rica escrever nesses segundos vai para a FILA, à
   * vista, em vez de bater num vermelho que já não vale. Era esse o defeito.
   */
  async function entregar(
    texto: string,
    aoFalhar: (() => void) | undefined,
    jaTentadas: number,
    origem: OrigemEnvio,
  ): Promise<void> {
    try {
      const resposta = await postar(agentSlug, texto, origem);
      if (descartado) return;
      // O 202: o servidor guardou o texto na fila dele. Tem de vir ANTES da
      // guarda de baixo, porque nesse caminho `tmux_delivered` vem `false` — e
      // lido como ausência de prova ele levaria a máquina a `nao-confirmado`,
      // que é vermelho na tela por uma entrega que está garantida.
      //
      // Sem `armarPrazo`: o recibo JÁ é a confirmação e não há eco a esperar
      // agora. Mas com `observar`, porque o eco chega quando a fila drenar —
      // minutos depois — e é ele que apaga a marca `fila`.
      if (resposta.enfileirada === true) {
        const fronteira = fronteiraDo(resposta.event_boundary_id);
        publicar({ tipo: 'enfileirar', fronteira });
        observar(fronteira);
        return;
      }
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
      const entregaIncerta =
        rejeicaoHttp &&
        'deliveryOutcome' in erro &&
        erro.deliveryOutcome === 'uncertain';
      // A RECUSA QUE PASSA SOZINHA. O back afirmou que não entregou, e a
      // condição costuma já não valer no instante seguinte — insistir aqui é
      // o que evita cobrar do Rica um gesto de conserto por algo que se
      // resolve em segundos. O porquê de ser seguro, e por que só nestes dois
      // detalhes, está em `recusa-transitoria.ts`.
      const atraso =
        !entregaIncerta && ehRecusaTransitoria(erro)
          ? atrasoDaRetentativa(jaTentadas)
          : null;
      if (atraso !== null) {
        timerRetentativa = agendar(() => {
          timerRetentativa = undefined;
          // A fase pode ter mudado na espera — outro envio, um dispose, uma
          // retomada. Quem saiu de `enviando` já não é esta tentativa.
          if (descartado || estado.fase !== 'enviando') return;
          void entregar(texto, aoFalhar, jaTentadas + 1, origem);
        }, atraso);
        return;
      }
      // Só aqui a máquina SABE que não saiu — é o único gatilho correto para
      // desfazer uma pendência otimista registrada antes do POST. Em
      // `nao-confirmado` o texto pode ter entrado mesmo assim (ver o
      // comentário longo acima, em `!resposta.tmux_delivered`), então a
      // pendência segue esperando o rollout confirmar ou expirar sozinha.
      if (rejeicaoHttp && !entregaIncerta) aoFalhar?.();
      publicar(
        rejeicaoHttp && !entregaIncerta
          ? { tipo: 'falhar', erro }
          : { tipo: 'nao-confirmar', erro },
      );
    }
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    enviar: executar,
    async reenviar(aoFalhar?: () => void) {
      if (estado.fase !== 'nao-confirmado') return;
      await executar(estado.texto, aoFalhar, origemEmVoo);
    },
    confirmarPorEco(texto) {
      // Mesmo evento que o SSE publicaria — o redutor faz o resto, inclusive
      // aceitar recibo TARDIO: `nao-confirmado` está na lista de fases que o
      // eco ainda confirma. Por isso o âmbar da Tara se desfaz sozinho quando
      // o rollout entrega, em vez de exigir que o Rica reenvie.
      //
      // `Date.now()` como id: o redutor exige `item.id > fronteira.id`, e a
      // fronteira é o `event_boundary_id` do back (contador de eventos, ordens
      // de grandeza menor que um instante em ms). Não vem do stream, então não
      // pode colidir com o `cursor`.
      publicar({
        tipo: 'item-do-stream',
        item: {
          id: Date.now(),
          papel: 'user',
          texto: vozEmVoo ? texto.replace(PREFIXO_VOZ, '') : texto,
        },
      });
    },
    dispose() {
      if (descartado) return;
      descartado = true;
      limparTimerPrazo();
      limparTimerReconexao();
      limparTimerRetentativa();
      fecharFonte();
      ouvintes.clear();
    },
  };
}

export function usaEnvio(agentSlug: string): {
  estado: EstadoEnvio;
  enviar: (texto: string, aoFalhar?: () => void, origem?: OrigemEnvio) => Promise<void>;
  reenviar: (aoFalhar?: () => void) => Promise<void>;
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

  // O recibo que não vem do SSE. Nasceu para o Codex, que não tem eco no
  // stream (`total: 0`), e desde 15/08 o Claude Code também registra pendência
  // — o eco dele leva 18,9 s medidos, e a bolha otimista não podia esperar por
  // isso. Assinar vale para os dois; quem não tiver pendência não publica nada.
  useEffect(
    () => assinaEntrega(agentSlug, (texto) => controle.confirmarPorEco(texto)),
    [agentSlug, controle],
  );

  return {
    estado,
    enviar: controle.enviar,
    reenviar: controle.reenviar,
  };
}
