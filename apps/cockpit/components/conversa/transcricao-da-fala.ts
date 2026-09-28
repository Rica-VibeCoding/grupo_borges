/**
 * De onde sai o texto da fala (fase 4, item 6). Primeiro o canal ao vivo, que já ouviu a fala
 * enquanto ela acontecia — e ele só vale dentro de 1 s da confirmação (a janela). O WAV é a rede
 * de segurança e sobe pelo caminho de sempre:
 * - na hora, quando o canal está fora de jogo (bilhete negado, não abriu, caiu no meio) ou
 *   desiste sem texto (vazio, falhou);
 * - quando a janela fecha sem o texto firme. Daí em diante quem decide é o WAV: no dia em que a
 *   OpenAI atrasou o texto ao vivo em 5 a 7 s (28/09), ele também veio cortado ("Agora responda"
 *   para "Agora responda só com a palavra dois."). O texto atrasado do canal só serve se o WAV
 *   falhar ou vier vazio;
 * - desde o começo, quando o canal não deu a fala anterior a tempo (`pacienciaDaVez`): num dia ruim
 *   do canal, cada fala custa o que custava antes, e não 1 s a mais. O canal ganhando de novo
 *   dentro da janela, a paciência volta.
 * O Rica nunca perde a fala por causa do canal: no pior caso, ela chega como chegava antes.
 */

/** Só texto com letra vale. Nulo ou em branco é "o canal não trouxe". */
export function textoDoCanal(texto: string | null): string | null {
  const limpo = texto?.trim() ?? '';
  return limpo === '' ? null : limpo;
}

/** A janela do canal. Da confirmação ao texto firme, num dia bom: 471 a 777 ms (E2E de 28/09). */
export const PACIENCIA_DO_CANAL_MS = 1000;

/** Quem deu o texto da fala; `null` = ninguém (vazio, falha, ou parou no meio). */
export type Vencedor = 'canal' | 'canalAtrasado' | 'wav' | null;

/** Quanto esperar o canal antes de subir o WAV nesta fala, pelo que aconteceu na anterior. */
export function pacienciaDaVez(anterior: Vencedor): number {
  return anterior === 'wav' || anterior === 'canalAtrasado' ? 0 : PACIENCIA_DO_CANAL_MS;
}

export type Transcricao = {
  /** O texto firme do canal (`null` = desistiu sem texto), ou `null` quando ele está fora de jogo. */
  aoVivo: Promise<string | null> | null;
  /** Quando o WAV sobe, se o texto firme não veio antes. A janela do canal é sempre 1 s. */
  paciencia: number;
  agenda?: (acao: () => void, ms: number) => void;
  /** O WAV pelo `/transcription`. Lança quando falha. */
  arquivo: () => Promise<string>;
  /** O ciclo ainda é o mesmo: quem parou no meio não recebe texto nem falha. */
  vivo: () => boolean;
  transcreveu: (texto: string) => void;
  falhou: () => void;
};

/** Resolve quando a fala tem destino (texto, vazio ou falha) — é a hora de fechar o canal. */
export function transcreveFala(t: Transcricao): Promise<Vencedor> {
  return new Promise<Vencedor>((pronto) => {
    let decidido = false;
    let janelaAberta = t.aoVivo !== null;
    let canalAcabou = t.aoVivo === null;
    let atrasado: string | null = null;
    let wav: 'parado' | 'subindo' | 'vazio' | 'falhou' = 'parado';
    let vazio = '';

    const decide = (acao: (() => void) | null, vencedor: Vencedor = null) => {
      if (decidido) return;
      decidido = true;
      const vivo = t.vivo();
      if (acao !== null && vivo) acao();
      pronto(vivo ? vencedor : null);
    };
    // O WAV não trouxe texto e o canal já disse o que tinha: último recurso, ou o de sempre.
    const semMaisNada = () => {
      if (!canalAcabou || wav === 'parado' || wav === 'subindo') return;
      const ultimoRecurso = atrasado;
      if (ultimoRecurso !== null) return decide(() => t.transcreveu(ultimoRecurso), 'canalAtrasado');
      decide(wav === 'vazio' ? () => t.transcreveu(vazio) : t.falhou);
    };
    const sobeWav = () => {
      if (decidido || wav !== 'parado') return;
      if (!t.vivo()) return decide(null);
      wav = 'subindo';
      t.arquivo().then(
        (texto) => {
          if (textoDoCanal(texto) !== null) return decide(() => t.transcreveu(texto), 'wav');
          wav = 'vazio';
          vazio = texto;
          semMaisNada();
        },
        () => {
          wav = 'falhou';
          semMaisNada();
        },
      );
    };

    if (t.aoVivo === null) return sobeWav();
    const agenda = t.agenda ?? ((acao, ms) => void setTimeout(acao, ms));
    agenda(sobeWav, t.paciencia);
    agenda(() => {
      janelaAberta = false;
    }, PACIENCIA_DO_CANAL_MS);
    t.aoVivo
      .then(textoDoCanal, () => null)
      .then((texto) => {
        canalAcabou = true;
        if (texto !== null && janelaAberta) return decide(() => t.transcreveu(texto), 'canal');
        if (!t.vivo()) return decide(null);
        atrasado = texto;
        sobeWav();
        semMaisNada();
      });
  });
}

export type EventoDoCanal =
  | { tipo: 'confirmou'; item: string }
  | { tipo: 'firme'; item: string; texto: string }
  | { tipo: 'falhou'; item: string | null }
  | { tipo: 'ignorar' };

/**
 * Lê um evento do canal (Realtime da OpenAI, sessão de transcrição). Só interessa o item que a
 * nossa confirmação criou e o texto firme DELE: a doc avisa que o texto de itens diferentes pode
 * chegar fora de ordem, e o `item_id` é o que casa um com o outro. O parcial fica de fora — o
 * que vai para o agente é só o texto firme. Evento de fornecedor é fronteira: nunca lança.
 */
export function leEventoDoCanal(bruto: string): EventoDoCanal {
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return { tipo: 'ignorar' };
  }
  if (!dados || typeof dados !== 'object') return { tipo: 'ignorar' };
  const evento = dados as Record<string, unknown>;
  const tipo = typeof evento.type === 'string' ? evento.type : '';
  const item = typeof evento.item_id === 'string' ? evento.item_id : null;

  if (tipo === 'input_audio_buffer.committed') return item ? { tipo: 'confirmou', item } : { tipo: 'ignorar' };
  if (tipo.endsWith('input_audio_transcription.completed')) {
    if (!item) return { tipo: 'ignorar' };
    return { tipo: 'firme', item, texto: typeof evento.transcript === 'string' ? evento.transcript : '' };
  }
  if (tipo.endsWith('input_audio_transcription.failed') || tipo === 'error') return { tipo: 'falhou', item };
  return { tipo: 'ignorar' };
}
