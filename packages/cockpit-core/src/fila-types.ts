/**
 * A FILA DO SERVIDOR — a forma do item, acordada na §10 de
 * `docs/cockpit-v2-composer.md`.
 *
 * Não confundir com `components/shell/fila-de-envio.ts`, que é a fila LOCAL da
 * aba: aquela segura texto durante o `/compact` e o eco da mensagem anterior e
 * morre com o reload. Esta mora no banco, atravessa canal e sobrevive à aba.
 *
 * Quatro decisões que a forma carrega, e que parecem cosméticas até quebrarem:
 *
 * 1. `ancora` é por CANAL, não global. Quem escreve do celular tem como última
 *    mensagem visível a do Telegram, não a do painel — carimbar o id do painel
 *    num item nascido no Telegram produz âncora confiantemente errada, pior que
 *    âncora nenhuma.
 * 2. `origem` e `endereco_retorno` viajam SEPARADOS. Origem é de onde veio;
 *    endereço é para onde a resposta volta. Item do Telegram drenado sem
 *    `chat_id` responde no painel, e o Rica nunca vê.
 * 3. `posicao` NÃO existe aqui — é derivada na leitura, a partir do `id` v7,
 *    que já é ordenável por tempo. Posição gravada obriga a reescrever todos os
 *    itens de baixo a cada cancelamento.
 * 4. `drenando` é estado de primeira classe. Sem ele, processo que morre no
 *    meio da entrega reentrega no próximo boot.
 *
 * `client_request_id` serve para dedupe de retentativa e para o painel saber qual
 * item é qual. NÃO serve para saber que a mensagem chegou ao feed: nenhum id
 * atravessa o tmux — a API cola texto puro num terminal, e o agente grava no
 * JSONL o que leu. Quem casa fila com feed é o servidor, por conteúdo.
 *
 * Campos em snake_case de propósito: espelham o JSON da API sem camada de
 * tradução, como `messages-types.ts` e `cockpit-types.ts` já fazem.
 */

/** De onde o item nasceu. */
export type OrigemDaFila = 'telegram' | 'web' | 'whatsapp';

export type EstadoDoItemDaFila =
  /** Esperando a vez. */
  | 'pendente'
  /** O servidor pegou o item e está entregando. Cobre só o intervalo até o
   *  POST ser aceito — NÃO o turno do agente. */
  | 'drenando'
  /** O servidor casou o item com o feed. Sai do espelho. */
  | 'entregue'
  /** O Rica tirou da fila. Sai do espelho. */
  | 'cancelada';

/** Para onde a resposta volta. A invariante da casa é que ela sai pelo canal de
 *  entrada — por isso este campo não é derivável de `origem`. */
export type EnderecoRetorno = {
  chat_id: string;
  /** `null` quando não há mensagem a citar. */
  reply_to: number | null;
};

/** O id da conversa de QUEM ESCREVEU, resolvido por quem drena no espaço dele. */
export type AncoraDaFila = {
  canal: string;
  ref: string;
};

export type AnexoDaFila = {
  tipo: string;
  caminho: string;
};

export type ItemDaFilaDoServidor = {
  /** UUID v7 — ordenável por tempo, é dele que a posição sai. */
  id: string;
  sessao: string;
  origem: OrigemDaFila;
  endereco_retorno: EnderecoRetorno | null;
  texto: string;
  anexos: readonly AnexoDaFila[];
  ancora: AncoraDaFila | null;
  client_request_id: string | null;
  estado: EstadoDoItemDaFila;
  /** ISO 8601 em UTC. */
  criado_em: string;
  /** ISO 8601 em UTC, ou `null` fora de `drenando`. */
  drenando_desde: string | null;
  motivo_falha: string | null;
};

export type RespostaDaFilaDoServidor = {
  itens: readonly ItemDaFilaDoServidor[];
};
