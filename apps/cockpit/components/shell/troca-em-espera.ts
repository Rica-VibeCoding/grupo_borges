/**
 * A troca de modelo/esforço que ESPERA o agente ficar ocioso (27/09).
 *
 * O Rica ficava preso no "trocar mesmo?" do Claude Code quando trocava com o
 * agente no meio do turno. Agora o back recusa a troca com turno em voo
 * (409 `agent_busy_wait`, nada vai ao tmux), e o chip guarda a escolha e a
 * reenvia sozinho quando a frota mostra o agente ocioso — sem pedir
 * confirmação a ele. Lógica pura: o relógio e o status entram por argumento.
 */

export type PedidoDeTroca = { tipo: 'modelo' | 'esforco'; valor: string };

/** No que o envio de UM pedido desaguou, do ponto de vista da espera. */
export type DesfechoDoPedido = 'feito' | 'esperar' | 'falhou';

export type EsperaDaTroca = { pedido: PedidoDeTroca; desdeMs: number };

/** Entre duas tentativas: a frota relê de 5 em 5 s, e o back pode julgar o
 *  agente ocupado um instante depois de a frota dizer ocioso. */
export const INTERVALO_DE_REENVIO_MS = 3_000;
/** Turno que não acaba em 15 min não segura a escolha para sempre. */
export const TETO_DA_ESPERA_MS = 15 * 60_000;

/** No chip cabe uma palavra: a 390px, com o ■ na fileira, a frase inteira
 *  ("esperando o agente terminar") sumia com o nome do modelo e ainda cortava.
 *  A frase inteira vai no rótulo acessível. */
export const TEXTO_ESPERANDO = 'esperando…';
export const TEXTO_ESPERANDO_LONGO = 'esperando o agente terminar';
export const TEXTO_TROCANDO = 'trocando…';

type ErroComCodigo = { status?: unknown; detail?: unknown };

/** O 409 do back, lido pelo código: `agent_busy_wait` é "espere e reenvie";
 *  `pergunta_motor_aberta` é outra troca aguardando resposta na barra do chat. */
export function classificaErroDaTroca(erro: unknown): 'esperar' | 'pergunta-aberta' | 'falhou' {
  const e = erro as ErroComCodigo | null;
  if (e?.status !== 409) return 'falhou';
  if (e.detail === 'agent_busy_wait') return 'esperar';
  if (e.detail === 'pergunta_motor_aberta') return 'pergunta-aberta';
  return 'falhou';
}

/** `ja_estava` é sucesso silencioso: o valor pedido já era o da sessão. Vem
 *  com `tmux_delivered: false`, e sem esta porta o desfecho antigo leria
 *  "entrega falhou". */
export function jaEstava(resposta: { ja_estava?: boolean | null }): boolean {
  return resposta.ja_estava === true;
}

export function podeReenviar(entrada: {
  espera: EsperaDaTroca | null;
  emVoo: boolean;
  status: string | null | undefined;
  ultimaTentativaMs: number;
  agoraMs: number;
  intervaloMs?: number;
}): boolean {
  if (!entrada.espera || entrada.emVoo) return false;
  // Só `ocioso`: `aguardando` é o agente esperando o Rica (uma permissão, uma
  // pergunta) — mandar `/model` ali seria digitar na resposta dele.
  if (entrada.status !== 'ocioso') return false;
  return entrada.agoraMs - entrada.ultimaTentativaMs >= (entrada.intervaloMs ?? INTERVALO_DE_REENVIO_MS);
}

export function esperaVenceu(espera: EsperaDaTroca, agoraMs: number, tetoMs = TETO_DA_ESPERA_MS): boolean {
  return agoraMs - espera.desdeMs >= tetoMs;
}

/** O pedido reenviado que volta "ocupado" continua a MESMA espera: o relógio
 *  do teto não recomeça a cada tentativa. Pedido novo começa espera nova. */
export function proximaEspera(
  atual: EsperaDaTroca | null,
  pedido: PedidoDeTroca,
  desfecho: DesfechoDoPedido,
  agoraMs: number,
): EsperaDaTroca | null {
  if (desfecho !== 'esperar') return null;
  if (atual && atual.pedido.tipo === pedido.tipo && atual.pedido.valor === pedido.valor) return atual;
  return { pedido, desdeMs: agoraMs };
}

/** O que o chip diz ao lado do rótulo — nada, quando não há troca em curso.
 *  `longo` é a frase do rótulo acessível. */
export function andamentoDoChip(
  entrada: { espera: EsperaDaTroca | null; emVoo: boolean },
  longo = false,
): string | null {
  if (entrada.emVoo) return TEXTO_TROCANDO;
  if (entrada.espera) return longo ? TEXTO_ESPERANDO_LONGO : TEXTO_ESPERANDO;
  return null;
}
