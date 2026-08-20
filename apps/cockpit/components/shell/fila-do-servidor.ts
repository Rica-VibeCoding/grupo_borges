/**
 * O ESPELHO DA FILA DO SERVIDOR — o que o painel decide sozinho, e só isso.
 *
 * A fila mora no banco (`@grupo_borges/cockpit-core/fila-types`). Este módulo
 * não a gerencia: ele traduz o que o servidor manda para o que a tela desenha.
 * A fronteira importa porque a §10 mudou de ideia no meio e as duas versões
 * ficaram escritas — a primeira dava ao painel o casamento por
 * `client_request_id`; a segunda, que vale, dá isso ao SERVIDOR, porque só ele
 * tem o instante e a ORDEM de cada entrega e pode casar posicionalmente. O
 * painel não casa nada. Ele renderiza `estado`.
 *
 * Sobram três decisões, e todas são de LEITURA — nenhuma escreve, nenhuma
 * precisa de processo em pé:
 *
 * 1. **Quem aparece.** `entregue` e `cancelada` saem. O item some no instante
 *    em que o servidor diz que ele foi substituído — a troca fica limpa por
 *    construção, sem piscar e sem duplicar.
 * 2. **Que posição.** Derivada do `id` v7, que é ordenável por tempo, e NUNCA
 *    da ordem do array — payload reordenado por qualquer motivo (JSON de outra
 *    origem, merge de páginas) renumeraria a fila do Rica sem ninguém notar.
 * 3. **Quem venceu o prazo.** `drenando` há mais de `PRAZO_DRENANDO_MS` vira
 *    falho AQUI, na hora de desenhar, sem esperar carimbo. Varredor seria mais
 *    uma peça para morrer calada; a gravação do `motivo_falha` acontece na
 *    próxima escrita que passar por ali, idempotente.
 *
 * Puro de propósito, e recebendo `agoraMs` de fora: prazo lido do relógio do
 * módulo não é testável sem congelar o tempo do processo inteiro.
 */
import type {
  EstadoDoItemDaFila,
  ItemDaFilaDoServidor,
  OrigemDaFila,
} from '@grupo_borges/cockpit-core/fila-types';

/**
 * O teto do `drenando`. Escolha de projeto, não medição — como os 1,2s e 3s da
 * retentativa. O raciocínio importa mais que o número: `drenando` cobre só o
 * intervalo entre pegar o item e o POST ser aceito, NÃO o turno do agente; com
 * a retentativa do 409 somando 4,2s mais latência, 30s é folga larga.
 *
 * Se um dia `drenando` passar a cobrir o eco, este número muda junto.
 */
export const PRAZO_DRENANDO_MS = 30_000;

const MOTIVO_PRAZO_VENCIDO = 'passou de 30s entregando — nao saiu';

/** O que a tela desenha. `falho` não é estado do banco: é leitura do prazo. */
export type SituacaoEspelhada = 'pendente' | 'drenando' | 'falho';

export type ItemEspelhado = {
  id: string;
  /** 1-based, derivada. Ver a decisão 2 do cabeçalho. */
  posicao: number;
  texto: string;
  origem: OrigemDaFila;
  situacao: SituacaoEspelhada;
  /** Só em `falho`. O carimbo do servidor vence a frase genérica do prazo: ele
   *  sabe o que aconteceu, o prazo só sabe que demorou. */
  motivo: string | null;
};

const VISIVEIS: ReadonlySet<EstadoDoItemDaFila> = new Set(['pendente', 'drenando']);

function venceuOPrazo(item: ItemDaFilaDoServidor, agoraMs: number): boolean {
  if (item.estado !== 'drenando' || item.drenando_desde === null) return false;
  const desde = Date.parse(item.drenando_desde);
  // Carimbo ilegível não condena o item: `NaN` em qualquer comparação é falso,
  // mas dizer isso em código é mais barato que descobrir na tela do Rica.
  if (Number.isNaN(desde)) return false;
  return agoraMs - desde > PRAZO_DRENANDO_MS;
}

function situacaoDe(item: ItemDaFilaDoServidor, agoraMs: number): SituacaoEspelhada {
  if (item.motivo_falha !== null) return 'falho';
  if (venceuOPrazo(item, agoraMs)) return 'falho';
  return item.estado === 'drenando' ? 'drenando' : 'pendente';
}

function motivoDe(item: ItemDaFilaDoServidor, situacao: SituacaoEspelhada): string | null {
  if (situacao !== 'falho') return null;
  return item.motivo_falha ?? MOTIVO_PRAZO_VENCIDO;
}

/**
 * A fila que o Rica vê, na ordem em que ele escreveu.
 *
 * `agoraMs` entra por parâmetro para que o prazo seja testável — ver o
 * cabeçalho.
 */
export function espelhaFila(
  itens: readonly ItemDaFilaDoServidor[],
  agoraMs: number,
): ItemEspelhado[] {
  return itens
    .filter((item) => VISIVEIS.has(item.estado))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item, indice) => {
      const situacao = situacaoDe(item, agoraMs);
      return {
        id: item.id,
        posicao: indice + 1,
        texto: item.texto,
        origem: item.origem,
        situacao,
        motivo: motivoDe(item, situacao),
      };
    });
}
