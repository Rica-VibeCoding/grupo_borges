/**
 * A RÉGUA DAS AÇÕES DO HISTÓRICO — sem React, sem rede (F10 das conversas).
 *
 * Retomar, Nova conversa e 🗑 passam por uma máquina só, de um estado por vez:
 * a tela nunca mostra dois pedidos abertos, e durante a troca nenhum botão de
 * troca fica livre. O texto de cada passo mora aqui para ser testado sem DOM.
 */
import type { FaseDaOperacao, OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';

export type Troca = {
  tipo: 'retomar' | 'nova';
  /** Conversa pedida no Retomar; `null` na Nova. */
  alvo: string | null;
  forcar: boolean;
  /** Agente desligado: o Retomar sobe direto, sem estacionar. */
  desligado: boolean;
};

export type EtapaEmCurso = Extract<FaseDaOperacao, 'estacionando' | 'religando'>;

export type EstadoDaAcao =
  | { fase: 'livre' }
  | { fase: 'confirmando'; troca: Troca }
  | { fase: 'esperando'; troca: Troca | null; etapa: EtapaEmCurso; inicio: number }
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
    case 'confirmando':
      return estado.troca.alvo ?? ATUAL;
    case 'esperando':
      return estado.troca?.alvo ?? ATUAL;
    case 'confirmando-exclusao':
    case 'excluindo':
      return estado.id;
    case 'falhou':
      return estado.onde;
  }
}

export function trocaEmCurso(estado: EstadoDaAcao): boolean {
  return estado.fase === 'esperando';
}

export type Confirmacao = { aviso: string; botao: string; arrisca: boolean };

/** O que a confirmação diz antes de mexer na linha. `arrisca` = interrompe um
 *  turno em voo, e o botão ganha a cor de atenção. */
export function textoDaConfirmacao(troca: Troca, nome: string): Confirmacao {
  if (troca.tipo === 'nova') {
    return {
      aviso: `${nome} está no meio de um turno. Abrir uma conversa nova interrompe o que está rodando, e a de agora sai sem nota de onde parou.`,
      botao: 'Interromper e abrir nova',
      arrisca: true,
    };
  }
  if (troca.desligado) {
    return { aviso: `${nome} está desligado. Ele liga direto nesta conversa.`, botao: 'Ligar nesta conversa', arrisca: false };
  }
  if (troca.forcar) {
    return {
      aviso: `${nome} está no meio de um turno. Retomar interrompe o que está rodando, e a conversa de agora sai sem nota de onde parou.`,
      botao: 'Interromper e retomar',
      arrisca: true,
    };
  }
  return {
    aviso: `${nome} anota onde parou na conversa de agora e religa nesta. O que estiver rodando em segundo plano para.`,
    botao: 'Retomar',
    arrisca: false,
  };
}

export type Passo = { texto: string; estado: 'feito' | 'agora' | 'depois' };

/** Os passos da espera, na ordem em que a API anda (`/operacao`). */
export function passosDaEspera(troca: Troca | null, etapa: EtapaEmCurso, nome: string): Passo[] {
  const marca = (minha: EtapaEmCurso): Passo['estado'] =>
    minha === etapa ? 'agora' : minha === 'estacionando' ? 'feito' : 'depois';
  if (troca?.desligado) return [{ texto: `Ligando ${nome} nesta conversa`, estado: 'agora' }];
  const primeiro = troca?.forcar ? 'Interrompendo o turno' : 'Anotando onde a conversa de agora parou';
  const segundo =
    troca?.tipo === 'nova'
      ? 'Abrindo a conversa nova'
      : troca?.tipo === 'retomar'
        ? `Religando ${nome} nesta conversa`
        : `Trocando a conversa de ${nome}`;
  return [
    { texto: primeiro, estado: marca('estacionando') },
    { texto: segundo, estado: marca('religando') },
  ];
}

export const TETO_DA_ESPERA_S = 90;

export function contaEspera(inicio: number, agora: number): string {
  const s = Math.max(0, Math.floor((agora - inicio) / 1000));
  return s <= TETO_DA_ESPERA_S ? `${s} s · pode levar até ${TETO_DA_ESPERA_S} s` : `${s} s · passou do previsto, ainda acompanhando`;
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
    return { tipo: t.tipo, alvo: typeof t.alvo === 'string' ? t.alvo : null, forcar: !!t.forcar, desligado: !!t.desligado };
  } catch {
    return null;
  }
}
