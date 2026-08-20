/**
 * A REGRA da fala ao vivo. Puro e testado, como `voz.ts` — o hardware (worklet,
 * WebSocket, `AudioContext`) mora em `usa-fala-ao-vivo.ts`.
 *
 * O que este arquivo existe pra resolver:
 *
 * 1. **A API só aceita 24 kHz.** Medido em 20/08: 16000 e 48000 são recusados
 *    no minting com "expected a value <= 24000". E `new AudioContext({
 *    sampleRate: 24000 })` não é caminho — forçar a taxa do contexto é
 *    exatamente o que aciona o defeito do WebKit 251350 no iPhone. Então
 *    capturamos na taxa NATIVA do aparelho e reamostramos aqui.
 *
 * 2. **Reamostragem em blocos precisa de memória.** O áudio chega em pedaços
 *    de 2048 amostras. Reamostrar cada pedaço do zero deixa um degrau na
 *    emenda e, quando a razão não é inteira (44100 → 24000 = 1,8375), a conta
 *    escorrega uma fração de amostra por bloco — em minutos vira atraso
 *    audível. Por isso o reamostrador é uma FÁBRICA: ele guarda o cursor
 *    fracionário e a última amostra do bloco anterior.
 *
 * 3. **Evento de fornecedor é fronteira de sistema.** Tudo que chega pelo
 *    WebSocket passa por `interpretaEvento`, que nunca lança.
 */

/** Cravada pela API, não é preferência nossa. Ver item 1 do cabeçalho. */
export const TAXA_AO_VIVO = 24_000;

/** Quantas amostras o worklet junta antes de mandar pra cá. A 48 kHz dá ~43ms:
 *  curto o bastante pra fala aparecer junto com a voz, longo o bastante pra não
 *  virar 375 mensagens por segundo atravessando a thread que desenha a onda. */
export const AMOSTRAS_POR_BLOCO = 2048;

export type EventoFala =
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'final'; texto: string }
  | { tipo: 'erro'; motivo: string }
  | { tipo: 'ignorar' };

/**
 * Lê um evento do canal. Só três coisas interessam: texto novo, texto
 * definitivo e fracasso — todo o resto do protocolo (`session.created`,
 * `conversation.item.added`, `input_audio_buffer.committed`) é ruído pra nós.
 */
export function interpretaEvento(bruto: string): EventoFala {
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return { tipo: 'ignorar' };
  }
  if (!dados || typeof dados !== 'object') return { tipo: 'ignorar' };
  const evento = dados as Record<string, unknown>;
  const tipo = typeof evento.type === 'string' ? evento.type : '';

  if (tipo.endsWith('input_audio_transcription.delta')) {
    const texto = typeof evento.delta === 'string' ? evento.delta : '';
    return texto ? { tipo: 'parcial', texto } : { tipo: 'ignorar' };
  }
  if (tipo.endsWith('input_audio_transcription.completed')) {
    const texto = typeof evento.transcript === 'string' ? evento.transcript : '';
    return { tipo: 'final', texto };
  }
  if (tipo.endsWith('input_audio_transcription.failed') || tipo === 'error') {
    const erro = evento.error;
    const motivo =
      erro && typeof erro === 'object' && typeof (erro as { message?: unknown }).message === 'string'
        ? (erro as { message: string }).message
        : 'o canal de fala recusou o áudio';
    return { tipo: 'erro', motivo };
  }
  return { tipo: 'ignorar' };
}

/**
 * Devolve a função que converte cada bloco de Float32 na taxa do aparelho em
 * PCM16 a 24 kHz, mantendo a emenda entre blocos.
 *
 * A interpolação é linear, sem filtro anti-alias. É deliberado: o que ficaria
 * acima de 12 kHz na fala humana não carrega fonema, e um filtro de verdade
 * custaria estado e CPU num aparelho que já está desenhando a onda a 60fps.
 */
export function criaReamostrador(taxaOrigem: number): (bloco: Float32Array) => Int16Array {
  const razao = taxaOrigem / TAXA_AO_VIVO;
  // Última amostra do bloco anterior. É o que permite interpolar uma posição
  // que caiu ANTES do começo do bloco atual (cursor negativo).
  let anterior = 0;
  // Posição de leitura em amostras da origem, relativa ao bloco atual. Começa
  // negativa quando o bloco passado terminou no meio de um passo.
  let cursor = 0;

  return (bloco: Float32Array): Int16Array => {
    if (bloco.length === 0) return new Int16Array(0);
    const saida: number[] = [];
    // Para em `length - 1` porque a última amostra do bloco ainda não tem
    // vizinha à direita — ela vira o `anterior` do próximo.
    while (cursor < bloco.length - 1) {
      const inteiro = Math.floor(cursor);
      const fracao = cursor - inteiro;
      const esquerda = inteiro < 0 ? anterior : bloco[inteiro];
      const direita = bloco[inteiro + 1];
      saida.push(esquerda + (direita - esquerda) * fracao);
      cursor += razao;
    }
    anterior = bloco[bloco.length - 1];
    cursor -= bloco.length;

    const pcm = new Int16Array(saida.length);
    for (let i = 0; i < saida.length; i++) {
      // Clamp antes de escalar: estourar o Int16 dá wraparound, e um pico
      // saturado viraria um estalo que o STT ouve como consoante.
      const v = Math.max(-1, Math.min(1, saida[i]));
      pcm[i] = Math.round(v * 32767);
    }
    return pcm;
  };
}

/** PCM16 → base64, que é como o `input_audio_buffer.append` quer o áudio.
 *  Em fatias porque `String.fromCharCode(...milhares)` estoura a pilha. */
export function paraBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bruto = '';
  const FATIA = 0x8000;
  for (let i = 0; i < bytes.length; i += FATIA) {
    bruto += String.fromCharCode(...bytes.subarray(i, i + FATIA));
  }
  return btoa(bruto);
}
