/**
 * A RÉGUA DA OPERAÇÃO ÚNICA — os tipos, os textos que a tela mostra e as
 * perguntas puras que a máquina de `operacao-de-motor.ts` faz ao painel e ao
 * erro. Saiu de lá inteira (02/10) para o arquivo caber no teto de 300 linhas;
 * quem importa continua importando de `operacao-de-motor.ts`, que reexporta.
 */
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

export type FaseDaOperacao =
  | 'ocioso'
  | 'agrupando'
  | 'confirmando'
  | 'aplicando'
  | 'concluido'
  | 'falhou';

export type EstadoDaOperacao = {
  fase: FaseDaOperacao;
  /** A frase de largura cheia que a tela mostra. Já pronta — o componente não
   *  decide palavra nenhuma. */
  aviso: string | null;
};

export const OCIOSO: EstadoDaOperacao = { fase: 'ocioso', aviso: null };

/** O turno em voo morre com o desligamento: o `--continue` devolve a conversa,
 *  mas o raciocínio em andamento e a ferramenta rodando não voltam. Por isso a
 *  operação PARA e pergunta, em vez de assumir. */
export const TEXTO_CONFIRMA_TURNO =
  'O agente está no meio de um turno — aplicar agora encerra o que ele está fazendo. Tocar de novo confirma.';

/** O instante entre gravar a escolha e ler o painel que diz o que falta. A
 *  releitura vem em seguida; este texto existe para a linha não piscar vazia. */
export const TEXTO_GUARDANDO = 'Guardando a escolha…';

/** O que a tela diz enquanto o pacote não fechou. Curto e específico, porque é
 *  ele que explica por que o agente AINDA não religou — o Rica fotografou o
 *  aviso antigo de 62 caracteres em duas linhas e pediu o contrário (09/09). */
export function textoFalta(campos: readonly string[]): string {
  return `Falta escolher ${campos.join(' e ')}.`;
}

/**
 * OS CAMPOS DE MOTOR QUE A TELA AINDA MOSTRA EM BRANCO.
 *
 * Quem responde é o back, não a UI: `_build_painel_model` devolve `value: null`
 * quando o modelo gravado não pertence ao motor escolhido (`agents.py`), e o
 * esforço faz o mesmo quando a sessão viva é de outra família. Trocar o motor,
 * então, esvazia os dois — e é esse estado, não um gesto de tela, que diz se
 * ele terminou de escolher.
 *
 * `allowed` vazio não é campo em branco: a família OpenCode tem um modelo só, e
 * esperar escolha num controle que não existe travaria a operação para sempre.
 */
export function faltaEscolher(painel: PainelDoMotor): string[] {
  const falta: string[] = [];
  if (painel.model?.allowed.length && !painel.model.value) falta.push('o modelo');
  if (painel.effort?.allowed.length && !painel.effort.value) falta.push('o esforço');
  return falta;
}

/**
 * O aviso da trava, em DUAS etapas e com o nome de quem está religando.
 *
 * [09/09] Era uma frase só: "Aplicando — desligando e religando o agente. Leva
 * uns 15 segundos." O Rica fotografou ela ocupando duas linhas e pediu o
 * contrário do que ela fazia: mais curta, dizendo *quem* e *o que está
 * acontecendo agora*. Anunciar as duas etapas de uma vez é o que a fazia estar
 * sempre meio errada — no primeiro segundo o agente ainda nem tinha caído, e
 * nos últimos catorze ele já estava subindo.
 *
 * Sem nome não se inventa um: o painel é aberto por slug em lugares que não
 * carregam o nome, e "o agente" é verdade em todos eles.
 */
export const textoDesligando = (nome?: string) => `Desligando ${nome ?? 'o agente'}…`;

export const textoSubindo = (nome?: string) => `Subindo ${nome ?? 'o agente'} — uns 15s.`;

/** O único desfecho que deixa a máquina em estado pior do que começou: o
 *  desligamento passou e o boot não. Dizer "tente de novo" aqui esconderia que
 *  o agente está fora do ar AGORA. */
export const TEXTO_NO_CHAO =
  'Desliguei, mas o religar não passou — o agente está fora do ar. O botão Ligar sobe ele de volta.';

export const TEXTO_FALHOU = 'Não consegui aplicar a troca — tente de novo.';

type Erro = { status?: number; detail?: string };

/** 409 `agent_busy_confirm_required` do `/aplicar-motor` (religar é
 *  destrutivo, então aqui o turno em voo pede confirmação). O `POST /model` e o
 *  `PATCH /effort` deixaram esse código em 27/09 — lá é `agent_busy_wait`, e o
 *  chip espera sozinho. Só ele arma a confirmação; outro 409 é falha de verdade. */
export function pedeConfirmacaoDeTurno(erro: unknown): boolean {
  const e = erro as Erro | null;
  return e?.status === 409 && e?.detail === 'agent_busy_confirm_required';
}

export function traduzFalha(erro: unknown): string {
  const detail = (erro as Erro | null)?.detail ?? '';
  return detail.startsWith('religar_falhou_agente_desligado') ? TEXTO_NO_CHAO : TEXTO_FALHOU;
}

/** A operação terminou de verdade? O agente voltou E a escolha está em vigor.
 *
 *  `session_may_diverge === false` é a régua certa porque é ela que o back
 *  responde à pergunta concreta "a sessão viva já assumiu a família escolhida?".
 *  `!== false` (e não `=== true`) do lado do aviso existe por causa de API
 *  antiga; aqui é o contrário — só o `false` explícito solta a trava. */
export function convergiu(painel: AgentPainelResponse): boolean {
  return painel.vida.processo === true && painel.motor?.session_may_diverge === false;
}

/**
 * O piso da trava. `[MEDIDO 09/09]` O POST volta em **1,6s** — ele dispara o
 * boot e não espera o fim dele —, e a sessão nova só está pronta **14s** depois
 * (unit `cockpit-ligar-canario` 21:47:32 → 21:47:46).
 *
 * Sem este piso a trava sairia na primeira releitura, aos 3s: o painel de um
 * agente que troca só de MODELO dentro da mesma família já vem convergido
 * ANTES do religamento, então `convergiu()` diria "pronto" sobre a sessão
 * velha, ainda morrendo. A tela mostraria o agente de volta com ele no chão.
 */
export const ESPERA_MINIMA_DO_BOOT_MS = 12_000;

/** O pedaço do painel que a régua do pacote lê. */
export type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort'> &
  Partial<Pick<AgentPainelResponse, 'motor'>>;

export type Rede = {
  /** O POST da operação única. Ele DISPARA o desligar e o ligar e responde
   *  logo — o boot continua correndo depois da resposta. */
  aplicar: (force: boolean) => Promise<unknown>;
  /** Releitura do painel — é ela que troca a tela sem F5. */
  reler: () => void;
  /** O painel AGORA, lido na hora da decisão. É o que distingue "ele acabou de
   *  escolher" de "chegou uma leitura qualquer": a gravação já voltou quando esta
   *  leitura sai, então ela descreve o motor com a escolha dentro. */
  lePainel: () => Promise<PainelDoMotor>;
};

/** A escolha gravada que ainda espera o pacote fechar. */
export type EscolhaPendente = {
  rede: Rede;
  nome?: string;
  /** Reconhece o painel que já viu esta escolha. O PATCH voltar não garante que
   *  a próxima leitura do painel já a mostre, e decidir sobre o painel de antes
   *  é religar com a conta errada do que falta. */
  confere?: (painel: PainelDoMotor) => boolean;
};

const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms));

/** O painel que JÁ mostra as escolhas em questão, insistindo enquanto o back não
 *  as publica. Oito tentativas de 250ms: a janela medida é de um ciclo só, e
 *  passar disso é sinal de que a gravação não pegou — aí não se religa nada. */
export async function painelQueJaViu(
  pendente: EscolhaPendente,
  tambem?: (painel: PainelDoMotor) => boolean,
): Promise<PainelDoMotor | null> {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const painel = await pendente.rede.lePainel().catch(() => null);
    if (!painel) return null;
    const viu = (!pendente.confere || pendente.confere(painel))
      && (!tambem || tambem(painel));
    if (viu) return painel;
    await espera(250);
  }
  return null;
}
