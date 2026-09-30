import type { EscutaSequencia, Sequencia } from '../feed/reprodutor-unico.ts';

export const PRAZO_DO_ERRO_MS = 2500;

export type PortasDoApoio = {
  sintetiza(texto: string): Promise<string[]>;
  iniciaSequencia(escuta: EscutaSequencia): Sequencia;
  ocupado(): boolean;
  bloqueado?(): boolean;
  cabecalhoAtual?(): string | null;
  /** O que a voz diz no lugar do cabeçalho (`enfeite-do-apoio`); a conferência segue no cru. */
  enfeita?(texto: string): string;
  preparaApoio?(): boolean;
  /** A frase vai começar a soar (antes do primeiro áudio). */
  aoComecar?(): void;
  aoTerminar?(): void;
  liberaAudio?(url: string): void;
  cancelaTurno(): void;
  espera?: (ms: number) => Promise<void>;
};

export type VozDeApoio = {
  cabecalho(texto: string): void;
  erro(texto: string): void;
  cala(): void;
  /** Desiste do que ainda não soou (síntese ou retentativa pendente); o que já toca segue. */
  desiste(): void;
};

export function criaVozDeApoio(p: PortasDoApoio): VozDeApoio {
  const espera = p.espera ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
  let vez = 0;
  let tocando: Sequencia | null = null;
  let liberaAtual: (() => void) | null = null;

  const liberaUrls = (urls: string[]) => {
    for (const url of urls) (p.liberaAudio ?? URL.revokeObjectURL)(url);
  };
  const para = () => {
    const haviaVoz = tocando !== null;
    tocando?.para();
    tocando = null;
    liberaAtual?.();
    liberaAtual = null;
    if (haviaVoz) p.aoTerminar?.();
  };
  const podeTocar = (erro: boolean, texto: string) => {
    if (!erro && p.cabecalhoAtual && p.cabecalhoAtual() !== texto) return false;
    if (p.bloqueado?.() || (!erro && p.ocupado())) return false;
    if (!erro && !(p.preparaApoio?.() ?? true)) return false;
    return !p.bloqueado?.();
  };
  const toca = (urls: string[], minha: number, falhou: () => void) => {
    p.aoComecar?.();
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
        // Cada `aoComecar` ganha o seu fim, também na falha: quem soltou o microfone o recebe de volta.
        p.aoTerminar?.();
        if (minha === vez) falhou();
      },
    });
    tocando = sequencia;
    liberaAtual = () => liberaUrls(urls);
    for (const url of urls) sequencia.enfileira(url);
    sequencia.fecha();
  };
  // Só a voz do agente: falhou (erro, voz trocada ou prazo), tenta uma vez de novo; falhou de novo, cala.
  // Cada tentativa confere a vez — cala, desiste, toque e fim de turno invalidam a pendente.
  const tenta = (texto: string, dito: string, erro: boolean, minha: number, tentativa: number) => {
    const falhou = () => {
      if (tentativa < 2 && minha === vez && !p.bloqueado?.()) tenta(texto, dito, erro, minha, tentativa + 1);
    };
    let venceu = false;
    const prazo = erro ? espera(PRAZO_DO_ERRO_MS).then(() => { venceu = true; return null; }) : new Promise<never>(() => {});
    const sintese = p.sintetiza(dito).then((urls) => {
      if (venceu || minha !== vez) { liberaUrls(urls); return null; }
      return urls;
    });
    Promise.race([sintese, prazo]).then(
      (urls) => {
        if (minha !== vez) { if (urls) liberaUrls(urls); return; }
        if (urls === null) { falhou(); return; }
        if (!podeTocar(erro, texto) || minha !== vez) { liberaUrls(urls); return; }
        toca(urls, minha, falhou);
      },
      () => falhou(),
    );
  };
  const fala = (texto: string, erro: boolean) => {
    if (p.bloqueado?.()) return;
    const minha = ++vez;
    para();
    if (erro) p.cancelaTurno();
    tenta(texto, erro ? texto : (p.enfeita?.(texto) ?? texto), erro, minha, 1);
  };
  return {
    cabecalho: (texto) => fala(texto, false),
    erro: (texto) => fala(texto, true),
    cala() { vez += 1; para(); },
    desiste() { if (tocando === null) vez += 1; },
  };
}
