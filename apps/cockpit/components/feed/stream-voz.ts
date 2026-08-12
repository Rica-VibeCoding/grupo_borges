/**
 * O cliente do `POST /api/tts/synth/stream` — decodifica os eventos e nada mais.
 *
 * É `fetch` + `ReadableStream` e não `EventSource` porque a rota é POST (o texto
 * da resposta vai no corpo) e `EventSource` só faz GET. O formato do quadro é o
 * do HTML Living Standard: linhas `event:` e `data:` terminadas por linha em
 * branco — por isso o corte é em `\n\n` e o resto do pedaço fica no buffer.
 *
 * A ordem importa e é contrato do servidor: `meta` primeiro, depois, por
 * sentença, `peaks` ANTES de `audio`. A onda nunca redesenha o que já foi
 * ouvido porque os picos de um trecho chegam antes do som dele.
 */

export type MetaVoz = {
  voice: string;
  engine: string;
  degraded: boolean;
  duration_estimate: number;
  peaks_per_second: number;
  segments: readonly { id: number; start: number; duration_estimate: number }[];
};

export type EscutaVoz = {
  aoMeta(meta: MetaVoz): void;
  /** Picos da sentença, com a duração REAL dela — é o que faz a escala convergir. */
  aoPeaks(id: number, duracao: number, peaks: readonly number[]): void;
  /** MP3 da sentença, já como URL de objeto pronta pro elemento de áudio. */
  aoAudio(id: number, url: string): void;
  aoFim(duracaoReal: number): void;
  aoErro(mensagem: string): void;
};

function mp3ParaUrl(b64: string): string {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

/** Um quadro SSE cru vira chamada na escuta. Exportado pra teste. */
export function aplicaQuadro(quadro: string, escuta: EscutaVoz): void {
  let evento = 'message';
  const dados: string[] = [];
  for (const linha of quadro.split('\n')) {
    if (linha.startsWith('event:')) evento = linha.slice(6).trim();
    else if (linha.startsWith('data:')) dados.push(linha.slice(5).trim());
  }
  if (dados.length === 0) return;

  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(dados.join('\n')) as Record<string, unknown>;
  } catch {
    return; // quadro partido no meio não derruba a fala inteira
  }

  switch (evento) {
    case 'meta':
      escuta.aoMeta(corpo as unknown as MetaVoz);
      return;
    case 'peaks':
      escuta.aoPeaks(
        corpo.id as number,
        corpo.duration as number,
        corpo.peaks as readonly number[],
      );
      return;
    case 'audio':
      escuta.aoAudio(corpo.id as number, mp3ParaUrl(corpo.b64 as string));
      return;
    case 'done':
      escuta.aoFim(corpo.duration as number);
      return;
    case 'error':
      escuta.aoErro(String(corpo.message ?? 'a fala falhou'));
      return;
    default:
      // `degraded` no meio do stream não muda a onda — a troca de voz já vem
      // declarada no `meta` e o áudio continua chegando.
      return;
  }
}

export type FalaEmCurso = { cancela(): void };

export function pedeFala(
  texto: string,
  slug: string,
  escuta: EscutaVoz,
  fetchImpl: typeof fetch = fetch,
): FalaEmCurso {
  const corte = new AbortController();

  void (async () => {
    try {
      const res = await fetchImpl('/api/tts/synth/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texto, slug }),
        signal: corte.signal,
      });
      if (!res.ok || res.body === null) {
        escuta.aoErro(`a fala não abriu (HTTP ${res.status})`);
        return;
      }
      const leitor = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let corta = buffer.indexOf('\n\n');
        while (corta !== -1) {
          aplicaQuadro(buffer.slice(0, corta), escuta);
          buffer = buffer.slice(corta + 2);
          corta = buffer.indexOf('\n\n');
        }
      }
    } catch (erro) {
      if ((erro as Error).name === 'AbortError') return;
      escuta.aoErro('a fala caiu no meio');
    }
  })();

  return { cancela: () => corte.abort() };
}
