'use client';

/**
 * O canal de fala ao vivo — a parte que toca no hardware e na rede. A REGRA
 * (reamostragem, leitura de evento) mora em `fala-ao-vivo.ts`, que é puro e
 * testado.
 *
 * Roda EM PARALELO ao `MediaRecorder` do `usa-gravador.ts`, que fica intocado.
 * Não é redundância à toa: o arquivo gravado é a rede de segurança e ela sai de
 * graça. Se o bilhete não vier, se o canal não abrir ou se nenhum texto chegar,
 * o composer sobe o arquivo como sempre fez — o Rica perde o palavra-por-palavra
 * daquela vez, não a fala.
 *
 * Duas ordens que importam:
 *
 * 1. **O worklet começa a captar ANTES do bilhete voltar.** O áudio espera numa
 *    fila e sobe quando o canal abre. Sem isso, a primeira palavra de quem fala
 *    rápido morreria no tempo da rede.
 * 2. **O commit é MANUAL, no fim do gesto.** A API recusa detecção automática
 *    de fala nos dois modelos de transcrição (medido em 20/08, HTTP 400 já na
 *    cunhagem do bilhete) — e aqui não faz falta nenhuma: quem marca começo e
 *    fim é o dedo do Rica, não o silêncio.
 */
import { useCallback, useEffect, useRef } from 'react';

import {
  AMOSTRAS_POR_BLOCO,
  criaReamostrador,
  interpretaEvento,
  paraBase64,
} from './fala-ao-vivo';

const URL_CANAL = 'wss://api.openai.com/v1/realtime';
const ARQUIVO_WORKLET = '/worklet-fala.js';
/** Depois do commit, quanto esperar pelo texto definitivo antes de desistir. */
const ESPERA_PELO_FINAL_MS = 4_000;
/** Teto da fila de espera, em blocos (~8s a 48 kHz). Canal que não abre não
 *  pode crescer memória para sempre — e áudio velho já não serve pra nada. */
const TETO_DA_FILA = 200;

export type FalaAoVivo = {
  liga: (stream: MediaStream, contexto: AudioContext) => Promise<void>;
  /** Fecha o canal. `true` = o texto veio por aqui, e então o ARQUIVO NÃO sobe
   *  (subir seria transcrever de novo, e colar a mesma fala duas vezes). */
  fecha: (descartar: boolean) => Promise<boolean>;
};

type Opcoes = {
  agentSlug: string;
  /** Avisa que a captura começou. Serve pra quem escreve o rascunho tirar a
   *  foto do que já estava escrito — é a base sobre a qual a fala é colada, e
   *  ela precisa ser lida ANTES da primeira palavra chegar. */
  aoComecar: () => void;
  /** Texto acumulado do turno. `firme` marca o definitivo — o que vem antes
   *  ainda pode mudar de forma quando o modelo ouve o resto da frase. */
  aoTexto: (texto: string, firme: boolean) => void;
};

export function usaFalaAoVivo({ agentSlug, aoComecar, aoTexto }: Opcoes): FalaAoVivo {
  const wsRef = useRef<WebSocket | null>(null);
  const noRef = useRef<AudioWorkletNode | null>(null);
  const fonteRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const acumuladoRef = useRef('');
  const filaRef = useRef<string[]>([]);
  const aguardaFinalRef = useRef<((texto: string | null) => void) | null>(null);

  const desmontaAudio = useCallback(() => {
    noRef.current?.disconnect();
    noRef.current = null;
    fonteRef.current?.disconnect();
    fonteRef.current = null;
  }, []);

  useEffect(
    () => () => {
      desmontaAudio();
      wsRef.current?.close();
      wsRef.current = null;
    },
    [desmontaAudio],
  );

  const liga = useCallback(
    async (stream: MediaStream, contexto: AudioContext) => {
      acumuladoRef.current = '';
      filaRef.current = [];
      aoComecar();
      const reamostra = criaReamostrador(contexto.sampleRate);

      try {
        await contexto.audioWorklet.addModule(ARQUIVO_WORKLET);
        const no = new AudioWorkletNode(contexto, 'coletor-de-fala', {
          processorOptions: { porBloco: AMOSTRAS_POR_BLOCO },
        });
        const fonte = contexto.createMediaStreamSource(stream);
        fonte.connect(no);
        // Precisa alcançar o destino pra o grafo puxar o processador. Não é
        // eco: o worklet não escreve na saída, e saída não escrita é silêncio.
        no.connect(contexto.destination);
        no.port.onmessage = (ev) => {
          const pcm = reamostra(ev.data as Float32Array);
          if (pcm.length === 0) return;
          const quadro = JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: paraBase64(pcm),
          });
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(quadro);
          else if (filaRef.current.length < TETO_DA_FILA) filaRef.current.push(quadro);
        };
        noRef.current = no;
        fonteRef.current = fonte;
      } catch {
        // Sem worklet não há captura — navegador antigo, arquivo fora do ar.
        desmontaAudio();
        return;
      }

      let bilhete: string;
      try {
        const { postAgentLiveToken } = await import('@grupo_borges/cockpit-core/api');
        bilhete = (await postAgentLiveToken(agentSlug)).token;
      } catch {
        desmontaAudio();
        return;
      }

      const ws = new WebSocket(URL_CANAL, ['realtime', `openai-insecure-api-key.${bilhete}`]);
      wsRef.current = ws;

      ws.onopen = () => {
        for (const quadro of filaRef.current) ws.send(quadro);
        filaRef.current = [];
      };
      ws.onmessage = (ev) => {
        const evento = interpretaEvento(typeof ev.data === 'string' ? ev.data : '');
        if (evento.tipo === 'parcial') {
          acumuladoRef.current += evento.texto;
          aoTexto(acumuladoRef.current, false);
          return;
        }
        if (evento.tipo === 'final') {
          // O final é a frase inteira revisada, não a última peça: ele
          // SUBSTITUI o acumulado. Concatenar duplicaria a fala.
          acumuladoRef.current = evento.texto || acumuladoRef.current;
          aoTexto(acumuladoRef.current, true);
          aguardaFinalRef.current?.(acumuladoRef.current);
          aguardaFinalRef.current = null;
        }
      };
      ws.onclose = () => {
        // Quem estava esperando o final não pode ficar pendurado até o teto de
        // tempo se o canal já morreu.
        aguardaFinalRef.current?.(null);
        aguardaFinalRef.current = null;
      };
    },
    [agentSlug, aoComecar, aoTexto, desmontaAudio],
  );

  const fecha = useCallback(
    async (descartar: boolean): Promise<boolean> => {
      desmontaAudio();
      const ws = wsRef.current;
      wsRef.current = null;
      filaRef.current = [];
      const tinhaTexto = acumuladoRef.current.trim().length > 0;

      if (descartar) {
        // Cancelar tem de apagar o que já apareceu na tela. O rascunho volta
        // pro que era antes da fala porque o composer remonta a partir da base.
        acumuladoRef.current = '';
        if (tinhaTexto) aoTexto('', true);
        ws?.close();
        return false;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws?.close();
        return tinhaTexto;
      }

      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      const veio = await new Promise<string | null>((resolve) => {
        aguardaFinalRef.current = resolve;
        setTimeout(() => {
          if (aguardaFinalRef.current !== resolve) return;
          aguardaFinalRef.current = null;
          resolve(null);
        }, ESPERA_PELO_FINAL_MS);
      });
      ws.close();

      // Sem o final, mas COM parcial na tela: fica o parcial. Desfazer o que
      // ele viu aparecer palavra por palavra pra subir o arquivo pareceria
      // defeito — e o rascunho é editável antes de sair. Sem texto nenhum, o
      // arquivo assume e o caminho de hoje resolve.
      return veio !== null || tinhaTexto;
    },
    [aoTexto, desmontaAudio],
  );

  return { liga, fecha };
}
