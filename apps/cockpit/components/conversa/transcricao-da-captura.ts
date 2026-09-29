import { postAgentTranscription } from '@grupo_borges/cockpit-core/api';
import type { Evento } from '../../lib/conversa/tipos';
import { transcreveFala, type Vencedor } from './transcricao-da-fala';

type Portas = {
  slug: string;
  audio: Float32Array;
  canal: { terminaFala(): { texto: Promise<string | null> | null; paciencia: number; fecha(vencedor: Vencedor): void } };
  detector: { criaWav(audio: Float32Array): Blob | null };
  vivo(): boolean;
  limpaLegenda(): void;
  despacha(evento: Evento): void;
};

export function transcreveCaptura(p: Portas) {
  const fala = p.canal.terminaFala();
  void transcreveFala({
    aoVivo: fala.texto,
    paciencia: fala.paciencia,
    arquivo: async () => {
      const audio = p.detector.criaWav(p.audio);
      if (audio === null) throw new Error('detector sem utilitários de WAV');
      return (await postAgentTranscription(p.slug, audio)).text;
    },
    vivo: p.vivo,
    transcreveu: (texto) => {
      p.limpaLegenda();
      p.despacha({ tipo: 'transcreveu', texto });
    },
    falhou: () => p.despacha({ tipo: 'falhou', motivo: 'transcricaoFalhou' }),
  }).then(fala.fecha);
}
