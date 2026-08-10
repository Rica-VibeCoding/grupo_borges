/**
 * OS COMANDOS DO PAINEL — a régua, sem React, sem DOM, sem rede.
 *
 * Em 09/08 o Rica mandou TIRAR o slot "Comandos do painel" com o placeholder e
 * tudo: *"quando ele passar a lista, a gente cria de novo"* — reservar espaço
 * para uma lista que não existe é ocupar tela com promessa. Em 10/08 ele passou
 * a lista, com essas palavras: *"podemos colocar 3 botões, compactar, clear,
 * encerrar (comando) depois vou ver os outros"*. Este arquivo é a lista, e o
 * *"depois vou ver os outros"* é o motivo de ela ser um array e não três
 * constantes soltas.
 *
 * TRÊS COISAS QUE ESTE MÓDULO DECIDE:
 *
 * 1. **O rótulo é o comando literal.** `/compact`, não "Compactar". O botão
 *    manda exatamente esse texto para o terminal do agente, e escrever a versão
 *    traduzida obrigaria a explicar embaixo qual comando ela dispara — texto
 *    explicativo que ele mandou tirar da gaveta em 30/07. Nome de comando é nome
 *    próprio: não traduz (R.1), e é o que ele já digita no campo hoje.
 *
 * 2. **A ORDEM É A ESCADA DE CUSTO, crescente da esquerda para a direita** — a
 *    mesma régua da linha de ações (`Destravar · Resume · Desligar`, ordem dele
 *    em 03/08). Compactar não perde nada; encerrar gasta um turno longo; o
 *    `/clear` apaga o contexto e não volta. Ele listou "compactar, clear,
 *    encerrar" de cabeça — a troca põe o irreversível na ponta, longe do dedo
 *    que escorrega, que é a régua que ele mesmo cravou para a linha de cima.
 *
 * 3. **Só o `/clear` pede confirmação.** Ele é o único que destrói. Pedir
 *    segundo toque no `/compact` seria copiar a proteção sem o perigo — o mesmo
 *    erro que a pressão longa de 2s do cockpit antigo cometia com o destrava.
 */
import type { Impedimento } from './acoes-rapidas';

export type ComandoId = 'compact' | 'encerrar' | 'clear';

export type Comando = {
  id: ComandoId;
  /** O texto que sai no terminal do agente — e, letra por letra, o rótulo do
   *  botão. Ver a decisão 1 do cabeçalho. */
  comando: string;
  /** O que ele faz, por extenso. Vira `title` e entra no `aria-label` somado ao
   *  rótulo (2.5.3: o nome acessível tem que CONTER o texto visível). */
  descricao: string;
  /** Segundo toque obrigatório antes de sair. */
  confirma: boolean;
  /** A frase de largura cheia enquanto a confirmação está armada. `null` em quem
   *  não confirma. O rótulo dentro do botão é sempre o curto "Confirmar?" — a
   *  frase que diz o que se perde não cabe em ~110px (auditoria 03/08). */
  aviso: string | null;
};

export const COMANDOS: readonly Comando[] = [
  {
    id: 'compact',
    comando: '/compact',
    descricao:
      'resume a conversa para liberar contexto — o agente continua de onde parou, e a barra acima do campo mostra a espera',
    confirma: false,
    aviso: null,
  },
  {
    id: 'encerrar',
    comando: '/encerrar',
    descricao:
      'fecha a sessão pela régua da casa: salva memória, registra pendência e sobe o que ficou por commitar',
    confirma: false,
    aviso: null,
  },
  {
    id: 'clear',
    comando: '/clear',
    descricao:
      'apaga o contexto desta conversa — o agente recomeça sem lembrar nada do que foi dito',
    confirma: true,
    aviso: 'Confirmar? O contexto desta conversa vai embora — tocar de novo confirma',
  },
];

/**
 * `aguardando` não é fase do POST: é o `/compact` já entregue, com a espera do
 * resumo correndo na máquina compartilhada (`lib/compact.ts`). Ela dura minutos
 * e o botão não pode voltar a "clicável" nesse meio — um segundo `/compact`
 * rearma a espera e joga fora o resumo em produção.
 */
export type FaseComando = 'ocioso' | 'confirmando' | 'enviando' | 'entregue' | 'aguardando';

export function rotulaComando(comando: Comando, fase: FaseComando): string {
  if (fase === 'confirmando') return 'Confirmar?';
  if (fase === 'enviando') return 'Enviando…';
  if (fase === 'entregue') return 'Enviado';
  if (fase === 'aguardando') return 'Compactando…';
  return comando.comando;
}

/** O que o leitor de tela anuncia. Fora do ocioso o rótulo já é a frase inteira
 *  — repetir a descrição ali diria "Enviando… apaga o contexto desta conversa",
 *  que é a promessa errada no instante errado. */
export function descreveComando(comando: Comando, fase: FaseComando): string {
  const rotulo = rotulaComando(comando, fase);
  if (fase === 'confirmando') return comando.aviso ?? rotulo;
  if (fase !== 'ocioso') return rotulo;
  return `${rotulo}: ${comando.descricao}`;
}

/** Toque em botão inerte não é recusa silenciosa — ele simplesmente não existe
 *  como alvo. O `/compact` é o único que sai de circulação sozinho, e sai porque
 *  a espera dele ainda corre. */
export function comandoInerte(fase: FaseComando): boolean {
  return fase === 'enviando' || fase === 'aguardando';
}

/**
 * Traduz a recusa do `POST /{slug}/input`. Casa por substring do detail que o
 * `postAgentInput` preserva — frágil de propósito: detail novo cai no caso
 * geral, que continua acionável.
 */
export function diagnosticaComando(erro: unknown, comando: Comando): Impedimento {
  const texto =
    typeof erro === 'string' ? erro : erro instanceof Error ? erro.message : String(erro ?? '');

  if (texto.includes('agent_pane_unavailable')) {
    return {
      resumo: `o terminal do agente não aceitou o ${comando.comando}`,
      saida: 'o pane pode estar fora do CLI — use o Destravar acima e tente de novo',
    };
  }
  if (texto.includes('404')) {
    return {
      resumo: 'o agente sumiu da frota',
      saida: 'volte para a lista e abra de novo',
    };
  }
  if (texto.includes('500') || texto.includes('503')) {
    return {
      resumo: `o servidor falhou ao mandar o ${comando.comando}`,
      saida: 'tente de novo; se repetir, é infra — avise o Pavan',
    };
  }
  return {
    resumo: `não consegui mandar o ${comando.comando}`,
    saida: 'nada foi entregue ao agente — tente de novo',
  };
}
