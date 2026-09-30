import type { Estado } from '../../lib/conversa/tipos.ts';

/** O que o microfone usa de uma faixa: a `MediaStreamTrack`, ou o dublê do teste. */
export type Faixa = { readyState: 'live' | 'ended'; enabled: boolean; stop(): void };
export type Captura = { getAudioTracks(): Faixa[] };

/**
 * Um `getUserMedia` por conversa (fase 4). Cada pedido novo pode reabrir o aviso de permissão no
 * iOS — no Chrome do iPhone (WKWebView), quase sempre —, e o MicVAD pedia um a cada volta: o
 * `pauseStream` padrão dá `stop()` na faixa quando ele começa a falar, e o `resumeStream`, outro
 * `getUserMedia` ao voltar a ouvir. Aqui, na vez dele, o microfone fica surdo sem soltar
 * (`enabled = false`; o MicVAD desliga a fonte do detector junto); voltando, reusa a mesma faixa
 * se ela segue viva, e só pede outra se ela caiu. Soltar de verdade (o indicador laranja do
 * iPhone apaga) é com a conversa parada ou em erro, e ao fechar a tela.
 */
export type Microfone<C extends Captura> = {
  /** Microfone novo, para um detector novo (o 1º, ou a escuta que emudeceu): solta o velho antes. */
  abre(): Promise<C>;
  /** O detector pausou: surdo sem soltar — ou solta, com a conversa parada. */
  pausa(captura: C, soltar: boolean): void;
  /** O detector volta a ouvir: a mesma faixa, se viva; outra, só se ela caiu. */
  retoma(captura: C): Promise<C>;
  solta(): void;
  atual(): C | null;
  /** Surdo na vez dele: a faixa que cai agora não é a escuta que caiu — a volta pede outra. */
  surdo(): boolean;
};

export function criaMicrofone<C extends Captura>(pede: () => Promise<C>, bloqueado = () => false): Microfone<C> {
  let geracao = 0;
  let atual: C | null = null;
  let surdo = false;
  const para = (captura: C | null) => captura?.getAudioTracks().forEach((faixa) => faixa.stop());
  const ouve = (captura: C, ligado: boolean) => {
    for (const faixa of captura.getAudioTracks()) faixa.enabled = ligado;
  };
  const viva = (captura: C) => {
    const faixas = captura.getAudioTracks();
    return faixas.length > 0 && faixas.every((faixa) => faixa.readyState === 'live');
  };
  const solta = () => {
    geracao += 1;
    para(atual);
    atual = null;
    surdo = false;
  };
  const confereBloqueio = () => {
    if (!bloqueado()) return;
    solta();
    throw new DOMException('Microfone bloqueado', 'AbortError');
  };
  const abre = async () => {
    confereBloqueio();
    solta();
    const tentativa = geracao;
    const captura = await pede();
    if (tentativa !== geracao || bloqueado()) {
      para(captura);
      throw new DOMException('Abertura do microfone cancelada', 'AbortError');
    }
    atual = captura;
    return captura;
  };
  return {
    abre,
    pausa(captura, soltar) {
      if (soltar || bloqueado()) {
        para(captura);
        solta();
        return;
      }
      ouve(captura, false);
      surdo = true;
    },
    async retoma(captura) {
      if (bloqueado()) para(captura);
      confereBloqueio();
      if (captura !== atual || !viva(captura)) {
        para(captura);
        return abre();
      }
      ouve(captura, true);
      surdo = false;
      return captura;
    },
    solta,
    atual: () => atual,
    surdo: () => surdo,
  };
}

/** Parada ou em erro, a conversa acabou: o microfone se solta de verdade. */
export const soltaOMicrofone = (estado: Estado): boolean => estado === 'parado' || estado === 'erro';

/**
 * No iPhone e no iPad, a vez dele solta o microfone de verdade. Com a captura viva, mesmo surda, o
 * WebKit segura a sessão de áudio em PlayAndRecord (modo de chamada) e os botões de volume não
 * alcançam a voz dele. A `navigator.audioSession` não resolve: `playback` com captura viva encerra
 * a faixa (spec W3C Audio Session). O custo é um `getUserMedia` por volta.
 */
export function soltaNaVezDele(n: { userAgent: string; maxTouchPoints: number }): boolean {
  return /iPhone|iPad|iPod/.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1);
}

/** O `pauseStream`/`resumeStream` do MicVAD, ligados ao microfone da conversa. */
export function ganchosDoMicrofone<C extends Captura>(mic: Microfone<C>, estado: () => Estado, soltaNaVez = false) {
  return {
    pauseStream: async (captura: C) => mic.pausa(captura, soltaNaVez || soltaOMicrofone(estado())),
    resumeStream: (captura: C) => mic.retoma(captura),
  };
}
