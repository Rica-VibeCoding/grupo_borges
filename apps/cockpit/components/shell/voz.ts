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
 */

/** Fases da CAPTURA. Depois de `transcrevendo` a mensagem entra na máquina de
 *  ENVIO (`aparencia-envio.ts`) como qualquer texto — voz não tem um caminho
 *  paralelo de confirmação, e não deve ter: o defeito do `tmux_delivered`
 *  literal é o mesmo nos dois. */
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
 *  encerra nada. */
export function aoSoltar(gesto: Gesto, segundos: number): Desfecho {
  if (gesto === 'cancelar') return 'descartar-cancelado';
  if (gesto === 'travar') return 'continuar';
  return segundos >= PISO_SEGUNDOS ? 'enviar' : 'descartar-curto';
}

// ---------------------------------------------------------------------------
// Microfone indisponível — o item 4 do despacho.
// ---------------------------------------------------------------------------

export type Impedimento = {
  /** O que aconteceu, na voz do Rica. */
  resumo: string;
  /** O que fazer a respeito. Nunca vazio: mensagem de erro sem saída é o mesmo
   *  botão morto que esta peça existe pra consertar. */
  saida: string;
  /** `true` quando insistir no mesmo lugar não resolve (precisa mexer em
   *  ajuste do sistema ou trocar de URL) — a tela esconde o "tentar de novo". */
  definitivo: boolean;
};

/** Contexto não-seguro: `navigator.mediaDevices` simplesmente não existe.
 *
 * Isto NÃO é hipotético aqui. O cockpit é publicado por `tailscale serve` com
 * certificado real (`https://…​.ts.net:3443`), mas o mesmo servidor responde
 * pelo IP `100.x` em HTTP puro — e abrir pelo IP mata o microfone sem dizer
 * por quê. Está escrito no playbook (§ "Regra: abrir sempre pelo nome .ts.net")
 * como a causa número um de "o mic não funciona". Uma tela que sabe disso e
 * cala é pior que um botão morto.
 */
export function impedimentoDeContexto(): Impedimento {
  return {
    resumo: 'o navegador não libera o microfone nesta página',
    saida: 'abra o cockpit pelo endereço .ts.net, não pelo IP 100.x — o microfone só existe em HTTPS',
    definitivo: true,
  };
}

/** Traduz o erro do `getUserMedia`. Os nomes vêm do padrão e são os mesmos em
 *  Safari, Chrome e Firefox; o `name` é o contrato, a `message` não é. */
export function diagnosticaMicrofone(erro: unknown): Impedimento {
  const nome =
    typeof erro === 'object' && erro !== null && 'name' in erro
      ? String((erro as { name: unknown }).name)
      : '';

  switch (nome) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        resumo: 'microfone bloqueado para esta página',
        saida: 'no iPhone: Ajustes ▸ Safari ▸ Microfone, ou o "aA" na barra de endereço ▸ Ajustes do Site',
        definitivo: true,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        resumo: 'nenhum microfone encontrado',
        saida: 'conecte um microfone ou use o teclado',
        definitivo: true,
      };
    case 'NotReadableError':
      return {
        resumo: 'o microfone está ocupado por outro app',
        saida: 'feche quem está usando (chamada, gravador) e tente de novo',
        definitivo: false,
      };
    case 'AbortError':
      return {
        resumo: 'a captura foi interrompida',
        saida: 'tente de novo',
        definitivo: false,
      };
    default:
      return {
        resumo: 'não consegui abrir o microfone',
        saida: 'tente de novo, ou use o teclado',
        definitivo: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Formato — o item 5 do despacho.
// ---------------------------------------------------------------------------

/** Os quatro que o back aceita (`_VOICE_ALLOWED_MIMES`, agents.py:1991). */
export const MIMES_ACEITOS = ['audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg'] as const;

/** Ordem de preferência ao CONSTRUIR o gravador.
 *
 * `audio/webm;codecs=opus` primeiro porque opus é o codec de voz — comprime
 * fala melhor que qualquer outro nessa lista, e é o que o Chrome/Android usa.
 * `audio/mp4` é o caminho do Safari, e cobre o iPhone do Rica.
 *
 * Pedir explicitamente importa: a MDN diz que `MediaRecorder.mimeType` devolve
 * **o que foi pedido na construção**, e só escolhe sozinho quando não pedimos.
 * Escolhendo nós, sabemos o que sai. */
const PREFERIDOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

export function escolheMime(suportado: (mime: string) => boolean): string | null {
  return PREFERIDOS.find((mime) => suportado(mime)) ?? null;
}

/** Normaliza o que sai do gravador para um dos quatro aceitos.
 *
 * Três coisas acontecem aqui, e nenhuma é decorativa:
 *
 * 1. **Parâmetro de codec cai fora.** O back já corta (`content_type.split(";")`
 *    em agents.py:2064), então isto é cinto E suspensório — mas o `filename`
 *    que sobe no FormData também é derivado daqui, e ele não passa por corte
 *    nenhum.
 * 2. **`video/mp4` vira `audio/mp4`.** O fallback sem opções deixa o browser
 *    escolher, e o WebKit já devolveu container MP4 rotulado como vídeo para
 *    captura só-áudio. O arquivo é o mesmo: o back grava tudo como `.oga` e
 *    manda pro ffmpeg, que decide pelo CONTEÚDO, não pela extensão. Recusar
 *    esse áudio por causa do rótulo seria perder a fala por burocracia.
 * 3. **Vazio devolve `null`.** Sem `type` o `FormData` manda
 *    `application/octet-stream` e o back recusa com 422 — melhor a tela dizer
 *    que não conseguiu gravar do que o Rica falar por um minuto e receber um
 *    erro de servidor.
 */
export function normalizaMime(bruto: string | null | undefined): string | null {
  const base = (bruto ?? '').split(';')[0].trim().toLowerCase();
  if (!base) return null;
  if (base === 'video/mp4') return 'audio/mp4';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return (MIMES_ACEITOS as readonly string[]).includes(base) ? base : null;
}

/** Extensão do arquivo que sobe. Só cosmética de log no back, mas errar aqui
 *  atrapalha quem for depurar um áudio perdido. */
export function extensaoDe(mime: string): string {
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/ogg') return 'ogg';
  return 'webm';
}

// ---------------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------------

export function duracaoLegivel(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type AparenciaVoz = {
  /** A frase que aparece na base do composer durante a captura. */
  instrucao: string;
  /** Cor do indicador, ou `null` quando não há captura. */
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
        tinta: 'var(--ck-state-thinking)',
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
        tinta: longa ? 'var(--ck-state-attention)' : 'var(--ck-state-running)',
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
        tinta: longa ? 'var(--ck-state-attention)' : 'var(--ck-state-running)',
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
        tinta: 'var(--ck-state-thinking)',
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
