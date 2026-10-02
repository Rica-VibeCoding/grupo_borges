/**
 * As duas pontas de uma gravação, sem React: montar o `MediaRecorder` e o analisador da onda
 * sobre o stream do microfone, e decidir o destino do áudio quando ele para. Saiu de
 * `usa-gravador.ts`, que segue dono do estado, do relógio e do gesto.
 */
import {
  assinaturaDoContainer,
  escolheMime,
  extensaoDe,
  normalizaMime,
  type FaseVoz,
  type Impedimento,
} from './voz';
import type { FalaAoVivo } from './usa-fala-ao-vivo';

export type GravadorMontado = {
  gravador: MediaRecorder;
  contexto: AudioContext;
  analisador: AnalyserNode;
};

/** Pode lançar: quem chama fecha o stream e diz o impedimento. */
export function montaGravador(stream: MediaStream): GravadorMontado {
  const contexto = new AudioContext();
  if (contexto.state === 'suspended') void contexto.resume().catch(() => {});
  const analisador = contexto.createAnalyser();
  analisador.fftSize = 256;
  contexto.createMediaStreamSource(stream).connect(analisador);

  const mime =
    typeof MediaRecorder !== 'undefined'
      ? escolheMime((m) => MediaRecorder.isTypeSupported(m))
      : null;
  let gravador: MediaRecorder;
  try {
    gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  } catch {
    // Alguns WebKit recusam o mimeType pedido mesmo respondendo `true` no
    // `isTypeSupported`. Deixar o browser escolher é pior (pode devolver
    // `video/mp4`), mas é melhor que não gravar — `normalizaMime` conserta
    // o rótulo na hora de subir.
    gravador = new MediaRecorder(stream);
  }
  return { gravador, contexto, analisador };
}

type Destino = {
  descartar: boolean;
  pedacos: Blob[];
  /** O `mimeType` cru do `MediaRecorder`, lido antes de soltar o hardware. */
  bruto: string;
  aoVivo?: FalaAoVivo;
  aoGravar: (audio: Blob) => void | Promise<void>;
  setFase: (fase: FaseVoz) => void;
  setImpedimento: (impedimento: Impedimento) => void;
};

/** O resto do `onstop`, depois que o microfone já fechou. */
export async function despachaGravacao({
  descartar,
  pedacos,
  bruto,
  aoVivo,
  aoGravar,
  setFase,
  setImpedimento,
}: Destino): Promise<void> {
  // O canal ao vivo fecha antes de qualquer decisão sobre o arquivo — e
  // fecha também quando é descarte, porque é ele quem apaga da tela o que
  // já tinha aparecido.
  if (!descartar && aoVivo) setFase('transcrevendo');
  const entregueAoVivo = aoVivo ? await aoVivo.fecha(descartar) : false;

  if (descartar || pedacos.length === 0) {
    setFase('ociosa');
    return;
  }
  if (entregueAoVivo) {
    setFase('ociosa');
    return;
  }

  const mime = normalizaMime(bruto);
  if (!mime) {
    // Sem tipo reconhecível o `FormData` mandaria octet-stream e o back
    // recusaria com 422. Dizer aqui é honesto; deixar subir seria mentir
    // sobre onde a coisa quebrou.
    setImpedimento({
      resumo: 'o navegador gravou num formato que o servidor não aceita',
      saida: 'use o teclado por enquanto — me avise que eu vejo o formato',
      definitivo: true,
    });
    setFase('impedida');
    return;
  }

  const audio = new File([new Blob(pedacos, { type: mime })], `voz.${extensaoDe(mime)}`, {
    type: mime,
  });
  // Guarda de container: gravação corrompida não sobe. Em vez de gastar STT
  // no servidor e devolver o enigmático "a transcrição falhou", diz a
  // verdade — o defeito é do navegador, e regravar resolve.
  const cabeca = new Uint8Array(await audio.slice(0, 8).arrayBuffer());
  if (!assinaturaDoContainer(mime, cabeca)) {
    setImpedimento({
      resumo: 'a gravação saiu corrompida',
      saida: 'grave de novo — o defeito é do navegador, não da fala',
      definitivo: false,
    });
    setFase('impedida');
    return;
  }
  // O hook fecha o próprio ciclo: entra em `transcrevendo` e só sai quando
  // a promessa de quem recebeu o áudio resolve. Se o composer tivesse que
  // avisar de volta, ele precisaria referenciar o gravador de dentro do
  // callback que o cria — e um esquecimento ali travaria a tela em
  // "transcrevendo…" para sempre, sem erro nenhum aparecendo.
  setFase('transcrevendo');
  void Promise.resolve(aoGravar(audio)).finally(() => setFase('ociosa'));
}
