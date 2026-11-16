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
import type { Troca, EtapaEmCurso } from '../../lib/regua-da-troca.ts';
export type { Troca, EtapaEmCurso } from '../../lib/regua-da-troca.ts';
export { SEM_CONTATO } from '../../lib/regua-da-troca.ts';

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

export function trocaEmCurso(estado: EstadoDaAcao): estado is Extract<EstadoDaAcao, { fase: 'esperando' | 'conferindo' }> {
  return estado.fase === 'esperando' || estado.fase === 'conferindo';
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
