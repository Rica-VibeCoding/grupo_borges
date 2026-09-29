import type { EscutaSequencia, Sequencia } from '../feed/reprodutor-unico.ts';

export const PRAZO_DO_ERRO_MS = 2500;

export type PortasDoApoio = {
  sintetiza(texto: string): Promise<string[]>;
  iniciaSequencia(escuta: EscutaSequencia): Sequencia;
  ocupado(): boolean;
  reserva(texto: string, aoTerminar?: () => void): void;
  bloqueado?(): boolean;
  cabecalhoAtual?(): string | null;
  preparaApoio?(): boolean;
  aoTerminar?(): void;
  liberaAudio?(url: string): void;
  calaReserva(): void;
  cancelaTurno(): void;
  espera?: (ms: number) => Promise<void>;
};

export type VozDeApoio = {
  cabecalho(texto: string): void;
  erro(texto: string): void;
  cala(): void;
};

export function criaVozDeApoio(p: PortasDoApoio): VozDeApoio {
  const espera = p.espera ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
  let vez = 0;
  let tocando: Sequencia | null = null;
  let reservaAtiva = false;
  let liberaAtual: (() => void) | null = null;

  const liberaUrls = (urls: string[]) => {
    for (const url of urls) (p.liberaAudio ?? URL.revokeObjectURL)(url);
  };
  const para = () => {
    const haviaVoz = tocando !== null || reservaAtiva;
    tocando?.para();
    tocando = null;
    reservaAtiva = false;
    liberaAtual?.();
    liberaAtual = null;
    p.calaReserva();
    if (haviaVoz) p.aoTerminar?.();
  };
  const podeTocar = (erro: boolean, texto: string) => {
    if (!erro && p.cabecalhoAtual && p.cabecalhoAtual() !== texto) return false;
    if (p.bloqueado?.() || (!erro && p.ocupado())) return false;
    if (!erro && !(p.preparaApoio?.() ?? true)) return false;
    return !p.bloqueado?.();
  };
  const reserva = (texto: string, minha: number, erro: boolean) => {
    if (minha !== vez || !podeTocar(erro, texto) || minha !== vez) return;
    reservaAtiva = true;
    p.reserva(texto, () => {
      if (minha !== vez || !reservaAtiva) return;
      reservaAtiva = false;
      p.aoTerminar?.();
    });
  };
  const toca = (urls: string[], erro: string | null, minha: number) => {
    const sequencia = p.iniciaSequencia({
      aoProgredir: () => {},
      aoTerminar: () => {
        if (tocando !== sequencia) return;
        tocando = null;
        liberaAtual?.();
        liberaAtual = null;
        p.aoTerminar?.();
      },
      aoFalhar: () => {
        if (tocando !== sequencia) return;
        tocando = null;
        liberaAtual?.();
        liberaAtual = null;
        if (erro !== null) reserva(erro, minha, true);
      },
    });
    tocando = sequencia;
    liberaAtual = () => liberaUrls(urls);
    for (const url of urls) sequencia.enfileira(url);
    sequencia.fecha();
  };
  const fala = (texto: string, erro: boolean) => {
    if (p.bloqueado?.()) return;
    const minha = ++vez;
    para();
    if (erro) p.cancelaTurno();
    let venceu = false;
    const prazo = erro ? espera(PRAZO_DO_ERRO_MS).then(() => { venceu = true; return null; }) : new Promise<never>(() => {});
    const sintese = p.sintetiza(texto).then((urls) => {
      if (venceu || minha !== vez) { liberaUrls(urls); return null; }
      return urls;
    });
    Promise.race([sintese, prazo]).then(
      (urls) => {
        if (minha !== vez || !podeTocar(erro, texto) || minha !== vez) {
          if (urls) liberaUrls(urls);
          return;
        }
        if (urls === null) reserva(texto, minha, erro);
        else toca(urls, erro ? texto : null, minha);
      },
      () => reserva(texto, minha, erro),
    );
  };
  return {
    cabecalho: (texto) => fala(texto, false),
    erro: (texto) => fala(texto, true),
    cala() { vez += 1; para(); },
  };
}
