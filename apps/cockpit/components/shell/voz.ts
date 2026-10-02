/**
 * A voz — o modelo puro do push-to-talk. Sem React, sem DOM, sem rede.
 *
 * POR QUE SEGURAR E NÃO TOCAR-TOCAR. A pergunta que o despacho fez é a peça
 * inteira, então a resposta mora aqui em cima: no celular, com uma mão,
 * **segurar é o único gesto em que a saída sem enviar é o movimento que a mão
 * já está fazendo** — o dedo está no botão, arrasta pro lado, acabou. Tocar
 * pra começar e tocar pra parar exige duas coisas que falham exatamente quando
 * o Rica precisa: lembrar que está gravando, e acertar um segundo alvo. O v1
 * escolheu tocar-tocar e o defeito está lá pra ver — em `use-voice-recorder.ts`
 * o segundo toque no MESMO botão CANCELA e joga o áudio fora, que é o oposto
 * do que a mão espera de "toco de novo pra parar".
 *
 * O contra legítimo do segurar é áudio longo: o Rica fala minutos, e ninguém
 * segura o dedo por dois minutos. Por isso o gesto tem DUAS saídas, e são as
 * mesmas duas que ele já tem na memória muscular do WhatsApp:
 *
 *   - arrastar PRA CIMA  → TRAVA. Solta o dedo e a gravação continua sozinha.
 *   - arrastar PRO LADO  → CANCELA. Solta e o áudio é descartado.
 *
 * E — isto é o que responde "descobrível sem manual" — os dois rótulos
 * aparecem DURANTE o gesto, não antes dele. Ninguém precisa saber que existem:
 * quem começa a segurar já está vendo as duas saídas.
 *
 * Quando trava, o gesto acabou e a tela volta a ter botões de verdade: ⏹ para
 * enviar e um X para descartar, lado a lado, sem gesto nenhum. Não há estado
 * em que a única saída seja um movimento secreto.
 *
 * E O TOQUE CURTO NÃO É UM SEGURAR QUE FALHOU — 20/08. Soltar antes do piso
 * cai na MESMA trava, com os mesmos dois botões: o toque é a porta de entrada
 * dela, não um gesto rejeitado. É o que a doc do React Aria descreve para
 * pressão curta e longa no mesmo alvo (`useLongPress`), e é o gesto do
 * claude.ai. O que o v1 fazia de errado continua fora: lá o segundo toque
 * CANCELAVA; aqui ele despacha.
 */

import type { Impedimento } from './diagnostico-da-voz.ts';

// O diagnóstico (microfone e STT) e o formato do áudio moram ao lado desde
// 02/10; continuam saindo daqui para quem importa `./voz`.
export type { Impedimento } from './diagnostico-da-voz.ts';
export { diagnosticaMicrofone, diagnosticaTranscricao, impedimentoDeContexto } from './diagnostico-da-voz.ts';
export {
  MIMES_ACEITOS,
  assinaturaDoContainer,
  escolheMime,
  extensaoDe,
  normalizaMime,
} from './formato-do-audio.ts';

/** Fases da CAPTURA. Depois de `transcrevendo`, o resultado vira rascunho
 *  editável; só o envio explícito entra na máquina de entrega. */
export type FaseVoz =
  | 'ociosa'
  | 'pedindo'
  | 'gravando'
  | 'cancelando'
  | 'travada'
  | 'transcrevendo'
  | 'impedida';

/** O que o dedo está prestes a fazer se soltar agora. */
export type Gesto = 'segurando' | 'cancelar' | 'travar';

/** Deslocamentos em pixels CSS a partir de onde o dedo encostou. Medidos pra
 *  caber no polegar: a trava fica mais perto (56px, um movimento curto pra
 *  cima) que o cancelamento (72px pro lado), porque travar é a saída comum e
 *  cancelar é a que não pode acontecer por acidente. */
export const LIMIAR_TRAVA = 56;
export const LIMIAR_CANCELA = 72;

export function gestoDe(dx: number, dy: number): Gesto {
  // Eixo dominante decide. Sem isso, um arrasto diagonal dispararia os dois e
  // o resultado dependeria da ordem em que os testes rodam — que é como se
  // perde um áudio sem entender por quê.
  const vertical = Math.abs(dy) > Math.abs(dx);
  if (vertical) return dy <= -LIMIAR_TRAVA ? 'travar' : 'segurando';
  return dx <= -LIMIAR_CANCELA ? 'cancelar' : 'segurando';
}

/** Quanto o gesto já andou rumo ao seu destino, de 0 a 1. Alimenta o alvo de
 *  trava, que precisa ACENDER progressivamente — um alvo que só muda no
 *  instante do limiar não ensina onde ele está. */
export function progressoDoGesto(dx: number, dy: number): number {
  const vertical = Math.abs(dy) > Math.abs(dx);
  const bruto = vertical ? -dy / LIMIAR_TRAVA : -dx / LIMIAR_CANCELA;
  return Math.max(0, Math.min(1, bruto));
}

/** Piso de duração. Abaixo disto o áudio é toque acidental, não fala: mandar
 *  200ms de silêncio pro STT devolve `stt_empty` (502) e a tela mostraria uma
 *  FALHA DE SISTEMA para o que foi um dedo escorregando. Descartar aqui, com
 *  aviso, diz a verdade. */
export const PISO_SEGUNDOS = 1;

/** Acima disto a duração muda de cor. O STT do back tem timeout de 30s
 *  (`_VOICE_STT_TIMEOUT_S`) contando upload + transcrição; áudio muito longo
 *  estoura e o Rica perde tudo que falou. Avisar durante é barato, e é a
 *  diferença entre perder cinco minutos de fala e encurtar a frase. */
export const AVISO_SEGUNDOS = 150;

export type Desfecho = 'enviar' | 'descartar-curto' | 'descartar-cancelado' | 'continuar';

/** O que acontece quando o dedo solta. `continuar` é a trava: soltar não
 *  encerra nada.
 *
 * SOLTAR CEDO NÃO JOGA FORA — TRAVA. Até 20/08 o gesto curto caía em
 * `descartar-curto`, e era isso que fazia a tela ir e voltar num clique:
 * abria a gravação, o piso a matava no `pointerup` e o aviso "muito curto"
 * acendia em cima da caixa. Rica, vendo: *"se eu der um clique curto, ele não
 * pode piscar desse jeito, eu não vi nenhum chat que faz isso"*.
 *
 * A doc do React Aria (`react-aria.adobe.com/useLongPress`) trata pressão
 * curta e longa como DUAS AÇÕES no mesmo alvo — o exemplo dela mescla
 * `usePress` e `useLongPress` num botão só. Curta nunca é uma longa que
 * falhou. Aqui a curta é "gravar sem segurar", que é o estado `travada` que
 * esta peça já tinha, e é o gesto do claude.ai que o Rica usa de referência.
 *
 * O piso continua fazendo o trabalho dele: ele decide se o áudio pode PARTIR,
 * nunca se a gravação existe. Áudio de milissegundos segue sem chegar ao STT
 * — só que agora por não ter sido despachado, e não por ter sido destruído. */
export function aoSoltar(gesto: Gesto, segundos: number): Desfecho {
  if (gesto === 'cancelar') return 'descartar-cancelado';
  if (gesto === 'travar') return 'continuar';
  return segundos >= PISO_SEGUNDOS ? 'enviar' : 'continuar';
}

/** O piso de `aoSoltar` não alcançava a gravação travada: ela sai por botão
 *  próprio, e travar e tocar em enviar despachava uma gravação de
 *  milissegundos. Medido no log da API em 20/08 — `audio_duration_ms=43`
 *  virou HTTP 400 na OpenAI, 22s de fallback local e transcrição vazia. */
export function aoEnviarTravada(segundos: number): Desfecho {
  return segundos >= PISO_SEGUNDOS ? 'enviar' : 'descartar-curto';
}

// ---------------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------------

export function duracaoLegivel(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function suavizaNiveis(anteriores: readonly number[], atuais: readonly number[]): number[] {
  return atuais.map((atual, indice) => {
    const anterior = anteriores[indice] ?? 0;
    const ganho = atual > anterior ? 0.42 : 0.18;
    return Math.round(anterior + (atual - anterior) * ganho);
  });
}

export function mesclaTranscricao(rascunho: string, transcricao: string): string {
  const atual = rascunho.trimEnd();
  const falado = transcricao.trim();
  if (!atual) return falado;
  if (!falado) return atual;
  return `${atual}\n${falado}`;
}

export function origemDepoisDaEdicao(
  origem: 'text' | 'stt',
  texto: string,
  substituiuTudo: boolean,
): 'text' | 'stt' {
  return origem === 'stt' && texto && !substituiuTudo ? 'stt' : 'text';
}

export type AparenciaVoz = {
  /** A frase que aparece na base do composer durante a captura. */
  instrucao: string;
  /** Cor do indicador, ou `null` quando não há captura.
   *
   * SEM AZUL (Rica, 20/08, depois de ver a fala ao vivo no ar): *"nada de azul,
   * nada de raiozinho, nada de borda azulada, neon"*. O ciano de `running` e o
   * roxo de `thinking` saíram daqui. É a mesma regra da §2 da estética,
   * que já tinha zerado o croma das superfícies: matiz fica reservado a quem
   * significa alguma coisa. Falar não é um estado de máquina que precise de cor
   * — o que a captura precisa dizer, ela diz com a onda, a frase e o
   * cronômetro. Continua colorido só o que AVISA: âmbar no áudio longo,
   * vermelho no prestes-a-cancelar. */
  tinta: string | null;
  /** A onda só existe quando há som entrando de fato. */
  mostraOnda: boolean;
  /** `true` a partir de `AVISO_SEGUNDOS` — a duração muda de cor. */
  longa: boolean;
  /** O que o botão sólido faz agora. */
  botao: 'enviar-texto' | 'enviar-audio' | 'nenhum';
  anuncio: string;
};

export function aparenciaDaVoz(
  fase: FaseVoz,
  ctx: { segundos?: number; nome?: string; impedimento?: Impedimento } = {},
): AparenciaVoz {
  const segundos = ctx.segundos ?? 0;
  const longa = segundos >= AVISO_SEGUNDOS;
  const nome = ctx.nome ?? 'o agente';

  switch (fase) {
    case 'pedindo':
      return {
        instrucao: 'liberando o microfone…',
        tinta: 'var(--ck-text-secondary)',
        mostraOnda: false,
        longa: false,
        botao: 'nenhum',
        anuncio: 'pedindo acesso ao microfone',
      };
    case 'gravando':
      return {
        instrucao: longa
          ? 'áudio longo pode estourar o tempo de transcrição'
          : '← arraste para cancelar · ↑ para travar',
        tinta: longa ? 'var(--ck-state-attention)' : 'var(--ck-text-primary)',
        mostraOnda: true,
        longa,
        botao: 'nenhum',
        anuncio: 'gravando. Arraste para a esquerda para cancelar, para cima para travar.',
      };
    case 'cancelando':
      return {
        instrucao: 'solte para descartar',
        tinta: 'var(--ck-state-fail)',
        mostraOnda: true,
        longa,
        botao: 'nenhum',
        anuncio: 'solte para descartar o áudio',
      };
    case 'travada':
      return {
        instrucao: longa
          ? 'áudio longo pode estourar o tempo de transcrição'
          : 'gravando sem segurar',
        tinta: longa ? 'var(--ck-state-attention)' : 'var(--ck-text-primary)',
        mostraOnda: true,
        longa,
        botao: 'enviar-audio',
        anuncio: 'gravação travada. Use enviar ou descartar.',
      };
    case 'transcrevendo':
      // O STT roda NO SERVIDOR: existe um tempo morto entre soltar o dedo e o
      // texto existir, e a tela não pode ficar muda nele. Esta é a única fase
      // em que nada depende do Rica — dizer que a máquina está trabalhando é
      // literalmente tudo que ela deve.
      return {
        instrucao: 'transcrevendo…',
        tinta: 'var(--ck-text-secondary)',
        mostraOnda: false,
        longa: false,
        botao: 'nenhum',
        anuncio: `transcrevendo o áudio antes de mandar para ${nome}`,
      };
    case 'impedida':
      return {
        instrucao: ctx.impedimento?.resumo ?? 'microfone indisponível',
        tinta: 'var(--ck-state-attention)',
        mostraOnda: false,
        longa: false,
        botao: 'enviar-texto',
        anuncio: `${ctx.impedimento?.resumo ?? 'microfone indisponível'}. ${ctx.impedimento?.saida ?? ''}`,
      };
    default:
      return {
        instrucao: '',
        tinta: null,
        mostraOnda: false,
        longa: false,
        botao: 'enviar-texto',
        anuncio: '',
      };
  }
}

/** `true` enquanto o microfone está aberto — a tela troca o campo de texto pela
 *  captura, e o teclado não deve competir com a fala. */
export function capturando(fase: FaseVoz): boolean {
  return fase === 'gravando' || fase === 'cancelando' || fase === 'travada';
}
