/**
 * A RÉGUA DAS AÇÕES DO HISTÓRICO — sem React, sem rede (F10 das conversas).
 *
 * Continuar esta, Nova conversa e 🗑 passam por uma máquina só, de um estado por
 * vez: a tela nunca mostra dois pedidos abertos, e durante a troca nenhum botão
 * de troca fica livre. O texto de cada estado mora aqui para ser testado sem DOM.
 *
 * Rodada 2 (Rica, 01/10): trocar não confirma. Parado, um toque troca; no meio
 * de um turno, uma linha diz quem está trabalhando e o botão já nasce âmbar,
 * interrompendo. A espera é uma barra, sem etapa nem contagem.
 */
import type { FaseDaOperacao, OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';

export type Troca = {
  tipo: 'retomar' | 'nova';
  /** Conversa pedida no Retomar; `null` na Nova. */
  alvo: string | null;
  forcar: boolean;
  /** Agente desligado: o Retomar sobe direto, sem estacionar. */
  desligado: boolean;
  /** A atual no pedido: a Nova se prova quando o cartão sai dela. */
  antes?: string | null;
};

export type EtapaEmCurso = Extract<FaseDaOperacao, 'estacionando' | 'religando'>;

export type EstadoDaAcao =
  | { fase: 'livre' }
  /** A API recusou com `ocupado` (a frota ainda dizia parado): o botão vira
   *  âmbar, com `forcar`, e o próximo toque interrompe. */
  | { fase: 'ocupado'; troca: Troca }
  | { fase: 'esperando'; troca: Troca | null; etapa: EtapaEmCurso; inicio: number }
  /** A API terminou; a espera segue até a lista mostrar a troca (ou o prazo). */
  | { fase: 'conferindo'; troca: Troca; inicio: number; ate: number; erro: string | null }
  | { fase: 'confirmando-exclusao'; id: string }
  | { fase: 'excluindo'; id: string }
  | { fase: 'falhou'; onde: string; texto: string };

/** Onde a ação aparece: no id da conversa, ou em `ATUAL` — o cartão "Em uso
 *  agora", que recebe a Nova e a espera de origem desconhecida (tela que
 *  recarregou sem saber qual era o alvo). */
export const ATUAL = 'atual';

export function ondeMostra(estado: EstadoDaAcao): string | null {
  switch (estado.fase) {
    case 'livre':
      return null;
    case 'ocupado':
      return estado.troca.alvo ?? ATUAL;
    case 'esperando':
      return estado.troca?.alvo ?? ATUAL;
    case 'conferindo':
      return estado.troca.alvo ?? ATUAL;
    case 'confirmando-exclusao':
    case 'excluindo':
      return estado.id;
    case 'falhou':
      return estado.onde;
  }
}

export function trocaEmCurso(estado: EstadoDaAcao): boolean {
  return estado.fase === 'esperando' || estado.fase === 'conferindo';
}

/** A linha de cima do botão, quando ele vai interromper. */
export function linhaDeOcupado(nome: string): string {
  return `${nome} está trabalhando`;
}

/** O nome do botão de troca: claro parado, âmbar no meio de um turno. */
export function textoDaTroca(tipo: Troca['tipo'], interrompe: boolean): string {
  if (tipo === 'nova') return interrompe ? 'Interromper e abrir nova' : 'Nova conversa';
  return interrompe ? 'Interromper e continuar esta' : 'Continuar esta';
}

/** A frase em cima da barra da espera. Sem alvo conhecido (a tela recarregou
 *  no meio), ela não promete para onde vai. */
export function textoDaEspera(troca: Troca | null, nome: string): string {
  if (!troca) return `Trocando a conversa de ${nome}…`;
  if (troca.tipo === 'nova') return 'Abrindo a conversa nova…';
  return troca.desligado ? `Ligando ${nome} nesta conversa…` : 'Abrindo esta conversa…';
}

/** O 409 em palavras. Os de trava (`É a conversa atual…`, `Conversa aberta…`)
 *  já chegam em português e passam como vieram; `ocupado` e
 *  `operacao_em_curso` não chegam aqui: a máquina trata. */
export function explicaRecusa(codigo: string, nome: string): string {
  switch (codigo) {
    case 'desligado':
      return `${nome} está desligado. Ligue pelo interruptor da gaveta e abra a conversa nova depois.`;
    case 'motor_sem_conversas':
      return 'O motor deste agente não guarda conversas que o cockpit saiba ler.';
    case 'Conversa não encontrada':
      return 'Essa conversa não existe mais no servidor. A lista foi lida de novo.';
    default:
      return codigo;
  }
}

export const SEM_CONTATO =
  'Perdi o contato com o servidor no meio da troca. Ela pode ter seguido: abra o Histórico de novo em instantes.';

/** O que fazer com a leitura do `/operacao` durante a espera. */
export type Leitura =
  | { tipo: 'segue'; etapa: EtapaEmCurso }
  | { tipo: 'pronta' }
  | { tipo: 'erro'; texto: string }
  /** `fase: null` — a API reiniciou e a operação morreu junto. */
  | { tipo: 'sumiu' };

export function leOperacao(op: OperacaoDeConversa): Leitura {
  if (op.fase === 'estacionando' || op.fase === 'religando') return { tipo: 'segue', etapa: op.fase };
  if (op.fase === 'pronta') return { tipo: 'pronta' };
  if (op.fase === 'erro') return { tipo: 'erro', texto: op.detalhe ?? 'A troca de conversa falhou.' };
  return { tipo: 'sumiu' };
}

// A CONFERÊNCIA (F12). O fim da troca na API não é o fim na tela: o cartão
// "Em uso agora" só muda quando a lista relida aponta a conversa nova, e a
// primeira releitura pode vir velha. E a API às vezes dá erro com a troca
// feita — o envio do `/clear` volta "não confirmado" e o `/clear` chegou (F11).
// Então a espera fica na tela relendo a lista até ela mostrar a troca; mostrou,
// vale a lista, com ou sem erro. Não mostrou no prazo, o erro aparece.
export const CONFERE_PRONTA_MS = 20_000;
export const CONFERE_ERRO_MS = 10_000;

/** A lista já mostra a troca? `atual` `undefined` = lista ainda não lida. */
export function trocaRefletida(troca: Troca, atual: string | null | undefined): boolean {
  if (!atual) return false;
  if (troca.tipo === 'retomar') return atual === troca.alvo;
  return atual !== (troca.antes ?? null);
}

type Fim = Exclude<Leitura, { tipo: 'segue' }>;

/** Depois do fim na API: conferir na lista, ou encerrar já (troca sem alvo
 *  conhecido — a tela recarregou sem saber o que foi pedido). */
export function depoisDaTroca(leitura: Fim, troca: Troca | null, inicio: number, agora: number): EstadoDaAcao {
  const erro = leitura.tipo === 'erro' ? leitura.texto : null;
  if (!troca || (troca.tipo === 'nova' && troca.antes === undefined)) {
    return erro ? { fase: 'falhou', onde: troca?.alvo ?? ATUAL, texto: erro } : { fase: 'livre' };
  }
  return { fase: 'conferindo', troca, inicio, ate: agora + (erro ? CONFERE_ERRO_MS : CONFERE_PRONTA_MS), erro };
}

/** O fim da conferência, ou `null` enquanto ela segue. */
export function fimDaConferencia(
  estado: Extract<EstadoDaAcao, { fase: 'conferindo' }>,
  atual: string | null | undefined,
  agora: number,
): EstadoDaAcao | null {
  if (trocaRefletida(estado.troca, atual)) return { fase: 'livre' };
  if (agora < estado.ate) return null;
  return estado.erro ? { fase: 'falhou', onde: estado.troca.alvo ?? ATUAL, texto: estado.erro } : { fase: 'livre' };
}

// A troca pedida fica guardada na aba: se a tela recarregar no meio, a espera
// volta no lugar certo (a linha da conversa pedida) e um erro que chegue
// depois ainda é mostrado. Sem ela, a espera volta no cartão "Em uso agora".
const CHAVE = (slug: string) => `ck-conversa-troca:${slug}`;

type Guarda = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function guardaTroca(guarda: Guarda | null, slug: string, troca: Troca | null): void {
  try {
    if (troca) guarda?.setItem(CHAVE(slug), JSON.stringify(troca));
    else guarda?.removeItem(CHAVE(slug));
  } catch {
    // Safari privado recusa escrita; a espera só perde o lugar ao recarregar.
  }
}

export function trocaGuardada(guarda: Guarda | null, slug: string): Troca | null {
  try {
    const cru = guarda?.getItem(CHAVE(slug));
    if (!cru) return null;
    const t = JSON.parse(cru) as Partial<Troca>;
    if (t.tipo !== 'retomar' && t.tipo !== 'nova') return null;
    const troca: Troca = { tipo: t.tipo, alvo: typeof t.alvo === 'string' ? t.alvo : null, forcar: !!t.forcar, desligado: !!t.desligado };
    if (typeof t.antes === 'string' || t.antes === null) troca.antes = t.antes;
    return troca;
  } catch {
    return null;
  }
}
