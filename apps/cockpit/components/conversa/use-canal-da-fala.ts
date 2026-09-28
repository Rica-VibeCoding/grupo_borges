'use client';

/**
 * O canal de fala ao vivo da tela de voz (fase 4, item 6) — a parte que toca na rede. O mesmo
 * canal do microfone do chat (`components/shell/usa-fala-ao-vivo.ts`): bilhete curto cunhado
 * pela API, WebSocket direto do navegador para a Realtime da OpenAI, confirmação manual. A
 * diferença é quem marca o fim: lá é o dedo do Rica, aqui é o detector de fala (itens 1 e 2).
 *
 * O áudio não tem captura própria: são os quadros que o detector já processa (16 kHz),
 * reamostrados para os 24 kHz que a API exige. O que entra no canal e quando ele tem a fala
 * inteira é regra pura, em `espelho-da-fala.ts`.
 *
 * Vida curta: abre quando a vez passa ao Rica (`ouvindo`), fecha quando a fala tem destino
 * (`transcricao-da-fala.ts`) ou quando a vez sai dele. Nada de áudio do agente: fora de
 * `ouvindo` não há canal.
 *
 * As palavras parciais vão para a tela por `aoParcial` enquanto ele fala (`parcial-do-canal.ts`);
 * `null` quando o áudio delas sai do canal (tosse, fala recomeçada, canal caiu no meio).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { postAgentLiveToken } from '@grupo_borges/cockpit-core/api';

import { criaReamostrador, paraBase64 } from '@/components/shell/fala-ao-vivo';
import type { Estado } from '@/lib/conversa/tipos';

import { criaEspelhoDaFala, type Comando } from './espelho-da-fala';
import { criaParcialDoCanal } from './parcial-do-canal';
import { leEventoDoCanal, pacienciaDaVez, type Vencedor } from './transcricao-da-fala';
import type { OuvinteDaFala } from './use-detector-de-fala';

const URL_CANAL = 'wss://api.openai.com/v1/realtime';
const TAXA_DO_DETECTOR = 16_000;
/** Teto da espera pelo texto firme. Quem decide quando o WAV sobe é a paciência de
 *  `transcricao-da-fala.ts` (1 s); este teto só pesa quando o WAV também falhou. */
const TETO_DO_FIRME_MS = 10_000;
/** Ao despejar a fala guardada enquanto o canal abria: ~1 s de áudio por mensagem. */
const QUADROS_POR_ENVIO = 32;

type Espera = { item: string | null; resolve: (texto: string | null) => void };

function junta(quadros: Float32Array[]): Float32Array {
  if (quadros.length === 1) return quadros[0];
  const total = new Float32Array(quadros.reduce((soma, quadro) => soma + quadro.length, 0));
  let posicao = 0;
  for (const quadro of quadros) {
    total.set(quadro, posicao);
    posicao += quadro.length;
  }
  return total;
}

export function useCanalDaFala(slug: string, estado: Estado, aoParcial: (texto: string | null) => void) {
  const espelhoRef = useRef(criaEspelhoDaFala());
  const aoParcialRef = useRef(aoParcial);
  aoParcialRef.current = aoParcial;
  const parcialRef = useRef(criaParcialDoCanal());
  /* O detector está no meio de uma fala (entre `inicio` e `fim`/`descarte`). */
  const falandoRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const ativoRef = useRef(false);
  const geracaoRef = useRef(0);
  const reamostraRef = useRef(criaReamostrador(TAXA_DO_DETECTOR));
  const textoRef = useRef<Promise<string | null> | null>(null);
  const esperaRef = useRef<Espera | null>(null);
  /* Texto firme que chegou antes da confirmação do item dele. */
  const firmesRef = useRef(new Map<string, string>());
  /* Quem deu o texto da última fala: decide quanto esperar o canal na próxima. */
  const ultimoVencedorRef = useRef<Vencedor>(null);

  /** O áudio da fala em curso saiu do canal: as palavras dele somem da tela. */
  const largaParcial = useCallback(() => {
    parcialRef.current.descarta();
    aoParcialRef.current(null);
  }, []);

  const soltaEspera = useCallback((texto: string | null) => {
    const espera = esperaRef.current;
    esperaRef.current = null;
    espera?.resolve(texto);
  }, []);

  const executa = useCallback((comandos: Comando[]) => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    for (const comando of comandos) {
      if (comando.tipo === 'limpa') {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        reamostraRef.current = criaReamostrador(TAXA_DO_DETECTOR);
        continue;
      }
      for (let i = 0; i < comando.quadros.length; i += QUADROS_POR_ENVIO) {
        const pcm = reamostraRef.current(junta(comando.quadros.slice(i, i + QUADROS_POR_ENVIO)));
        if (pcm.length > 0) ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: paraBase64(pcm) }));
      }
    }
  }, []);

  const fechaCanal = useCallback(() => {
    const tinhaCanal = ativoRef.current;
    geracaoRef.current += 1;
    ativoRef.current = false;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws !== null) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    // Sem canal não há o que derrubar: a fala por cima (com fone), que começa fora da vez,
    // segue guardada para subir inteira quando a vez chegar.
    if (tinhaCanal) espelhoRef.current.caiu();
    firmesRef.current.clear();
    soltaEspera(null);
  }, [soltaEspera]);

  const abre = useCallback(async () => {
    const geracao = ++geracaoRef.current;
    ativoRef.current = true;
    espelhoRef.current.abrindo();
    const vivo = () => geracao === geracaoRef.current;
    const morreu = () => {
      if (!vivo()) return;
      ativoRef.current = false;
      wsRef.current = null;
      espelhoRef.current.caiu();
      if (falandoRef.current) largaParcial(); // a fala segue pelo WAV; o parcial parou no meio
      soltaEspera(null);
    };

    let bilhete: string;
    try {
      bilhete = (await postAgentLiveToken(slug)).token;
    } catch {
      morreu(); // bilhete negado: esta vez vai pelo WAV
      return;
    }
    if (!vivo()) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(URL_CANAL, ['realtime', `openai-insecure-api-key.${bilhete}`]);
    } catch {
      morreu();
      return;
    }
    wsRef.current = ws;
    reamostraRef.current = criaReamostrador(TAXA_DO_DETECTOR);
    firmesRef.current.clear();
    parcialRef.current = criaParcialDoCanal();
    ws.onopen = () => {
      if (wsRef.current === ws) executa(espelhoRef.current.abriu());
    };
    ws.onmessage = (mensagem) => {
      if (wsRef.current !== ws) return;
      const evento = leEventoDoCanal(typeof mensagem.data === 'string' ? mensagem.data : '');
      const espera = esperaRef.current;
      if (evento.tipo === 'confirmou') {
        if (espera === null || espera.item !== null) return;
        espera.item = evento.item;
        const texto = firmesRef.current.get(evento.item);
        if (texto !== undefined) soltaEspera(texto);
      } else if (evento.tipo === 'firme') {
        if (espera !== null && espera.item === evento.item) soltaEspera(evento.texto);
        else firmesRef.current.set(evento.item, evento.texto);
      } else if (evento.tipo === 'parcial') {
        const texto = parcialRef.current.soma(evento.item, evento.texto);
        if (texto !== undefined) aoParcialRef.current(texto);
      } else if (evento.tipo === 'falhou') {
        // Esperando o texto, é fim: sobe o WAV. Antes disso, o buffer pode ter ficado
        // pela metade — o canal morre e a fala em curso vai pelo WAV.
        if (espera !== null && (evento.item === null || evento.item === espera.item)) soltaEspera(null);
        else if (espera === null) {
          ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
          ws.close();
          morreu();
        }
      }
    };
    ws.onclose = ws.onerror = () => {
      if (wsRef.current === ws) morreu();
    };
  }, [executa, largaParcial, slug, soltaEspera]);

  const ouvinte = useMemo<OuvinteDaFala>(
    () => ({
      quadro: (quadro) => executa(espelhoRef.current.quadro(quadro)),
      inicio: () => {
        if (falandoRef.current) largaParcial(); // recomeçou sem fim: o canal limpa a anterior
        falandoRef.current = true;
        executa(espelhoRef.current.inicio());
      },
      descarte: () => {
        executa(espelhoRef.current.descarte());
        if (falandoRef.current) largaParcial();
        falandoRef.current = false;
      },
      fim: () => {
        falandoRef.current = false;
        textoRef.current = null;
        const ws = wsRef.current;
        if (espelhoRef.current.fim() !== 'aoVivo' || ws === null || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        textoRef.current = new Promise<string | null>((resolve) => {
          esperaRef.current = { item: null, resolve };
          window.setTimeout(() => {
            if (esperaRef.current?.resolve === resolve) soltaEspera(null);
          }, TETO_DO_FIRME_MS);
        });
      },
    }),
    [executa, largaParcial, soltaEspera],
  );
  const ouvinteRef = useRef<OuvinteDaFala | null>(ouvinte);
  ouvinteRef.current = ouvinte;

  /**
   * A fala que acabou: o texto firme que o canal promete (`null` = canal fora de jogo, vai pelo
   * WAV), quanto esperar por ele, e quem fecha o canal DESTA vez — uma vez nova, já aberta, não é
   * derrubada por engano. `fecha` recebe quem ganhou, para a paciência da próxima fala.
   */
  const terminaFala = useCallback(() => {
    const texto = textoRef.current;
    textoRef.current = null;
    const geracao = geracaoRef.current;
    const fecha = (vencedor: Vencedor) => {
      if (vencedor !== null) ultimoVencedorRef.current = vencedor;
      if (geracaoRef.current === geracao) fechaCanal();
    };
    return { texto, paciencia: pacienciaDaVez(ultimoVencedorRef.current), fecha };
  }, [fechaCanal]);

  useEffect(() => {
    if (estado === 'ouvindo') {
      if (!ativoRef.current) void abre();
    } else if (estado !== 'transcrevendo') {
      fechaCanal();
    }
  }, [abre, estado, fechaCanal]);

  useEffect(() => () => fechaCanal(), [fechaCanal]);

  return { ouvinteRef, terminaFala };
}
