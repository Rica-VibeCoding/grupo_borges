/**
 * O que o servidor diz sobre um envio — a resposta do POST, o erro dele e o
 * texto que volta pelo stream. Tudo puro: quem age sobre a leitura é o controle
 * (`controle-envio.ts`), e quem observa o stream é `observacao-do-eco.ts`.
 */

import type { AgentInputResponse } from '@grupo_borges/cockpit-core/api';
import type {
  ContentPart,
  MessagePayload,
} from '@grupo_borges/cockpit-core/messages-types';
import { textoEnfileirado } from '@grupo_borges/cockpit-core/render-items';

import type { FronteiraEnvio } from './envio.ts';
import { atrasoDaRetentativa, ehRecusaTransitoria } from './recusa-transitoria.ts';

export type RespostaComFronteira = AgentInputResponse & {
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
 *  (`post_agent_voice`). O front precisa dele porque a bolha otimista casa por
 *  texto EXATO com o que volta no eco (`reconciliaPendentes`): registrar sem a
 *  marca deixaria a pendência sem par e o composer preso em `aceito` até o
 *  prazo expirar. */
export const MARCA_VOZ = '🎙 ';

export type OrigemEnvio = 'text' | 'stt';

export function respostaTemFronteira(
  resposta: AgentInputResponse,
): resposta is RespostaComFronteira {
  const id = (resposta as Partial<RespostaComFronteira>).event_boundary_id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;
}

/**
 * O texto do Rica que um evento do stream traz. O `kind: "queued"` do backend
 * (commit 640282c) é o recibo de entrega da fila — `message: null` e o texto no
 * `content` de fora: chega em segundos, enquanto o eco `user` só nasce quando a
 * fila drena, minutos depois.
 */
export function textoDaMensagem(
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

export function fronteiraDo(id: number): FronteiraEnvio {
  return { id, origem: 'barreira-do-servidor' };
}

export type LeituraDaResposta =
  | { tipo: 'enfileirada'; fronteira: FronteiraEnvio }
  | { tipo: 'sem-prova' }
  | { tipo: 'aceita'; fronteira: FronteiraEnvio };

/** O 2xx do POST, em três desfechos — a ordem das perguntas é o contrato. */
export function leRespostaDoEnvio(resposta: RespostaComFronteira): LeituraDaResposta {
  // O 202: o servidor guardou o texto na fila dele. Tem de vir ANTES da
  // guarda de baixo, porque nesse caminho `tmux_delivered` vem `false` — e
  // lido como ausência de prova ele levaria a máquina a `nao-confirmado`,
  // que é vermelho na tela por uma entrega que está garantida.
  if (resposta.enfileirada === true) {
    return { tipo: 'enfileirada', fronteira: fronteiraDo(resposta.event_boundary_id) };
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
  if (!resposta.tmux_delivered) return { tipo: 'sem-prova' };
  return { tipo: 'aceita', fronteira: fronteiraDo(resposta.event_boundary_id) };
}

export type LeituraDoErro =
  | { tipo: 'retentar'; atrasoMs: number }
  | { tipo: 'falhou' }
  | { tipo: 'incerto' };

/** O POST que rejeitou: insistir sozinho, falha certa ou entrega incerta. */
export function leErroDoEnvio(erro: unknown, jaTentadas: number): LeituraDoErro {
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
  if (atraso !== null) return { tipo: 'retentar', atrasoMs: atraso };
  // Só a rejeição HTTP com entrega não-incerta prova que o texto não saiu.
  // Rede caída ou entrega incerta podem ter entrado mesmo assim.
  return rejeicaoHttp && !entregaIncerta ? { tipo: 'falhou' } : { tipo: 'incerto' };
}
