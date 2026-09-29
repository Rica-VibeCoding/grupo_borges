import type { EscutaSequencia, Sequencia } from '../feed/reprodutor-unico.ts';

/**
 * As frases de apoio da tela de voz — a ponte (sem texto dele aos 5 s), a demora (aos 20 s) e o
 * aviso de erro — na MESMA voz e pela MESMA rota das respostas (`/api/tts/synth/stream`, slug do
 * agente), ordem do Rica em 29/09. A voz do navegador fica só de reserva, se a rota falhar: o aviso
 * de erro não pode ficar mudo quando quem caiu foi o TTS.
 *
 * A frase de apoio NÃO entra na fila do turno (`use-fila-de-voz.ts`): o fim daquela fila vira
 * `vozTerminou`, e a máquina contaria a ponte como resposta pronta. Aqui ela toca numa sequência
 * própria do reprodutor único; a resposta que chega abre a dela e corta a ponte, sem sobrepor.
 *
 * A síntese de uma frase curta leva ~1,7 s (medido em 28/09): pedida na hora, a ponte chegaria
 * tarde. Por isso a tela pré-sintetiza todas ao abrir, uma de cada vez, a próxima de cada lista
 * primeiro; o cache é por agente e dura a aba.
 */
// Escritas para o ouvido (29/09): curtas, com a vírgula onde se respira e o ponto que fecha a frase (guia do Chirp 3
// HD). Um marcador de conversa na frente ("Tá,", "Beleza,") soa como gente pensando,
// e o nome do Rica só numa de cada lista: repetido, vira locutor. As cinco primeiras da ponte são as dele.
export const FRASES_DE_PONTE = [
  'Só um momento, Rica.',
  'Já tô vendo isso.',
  'Um instante.',
  'Deixa comigo.',
  'Tô pensando aqui.',
  'Hum, deixa eu ver.',
  'Beleza, já vou olhar.',
  'Entendi, só um segundinho.',
  'Certo, tô puxando isso.',
  'Tá, um momentinho.',
] as const;
export const FRASES_DE_DEMORA = [
  'Ainda tô nisso, Rica.',
  'Tá levando um pouco mais, mas já sai.',
  'Continuo aqui, só mais um pouco.',
  'Segura mais um pouco.',
  'Ainda nisso, tá rendendo.',
  'Tá dando um pouco de trabalho, mas tô chegando lá.',
  'Tô na trilha, já te falo.',
  'Ainda mexendo aqui, já volto.',
] as const;

/** Paciência do aviso de erro com a rota de voz: passou disso, a voz do navegador fala. */
export const PRAZO_DO_ERRO_MS = 2500;

export type PortasDoApoio = {
  /** A rota de voz do agente: as URLs do áudio da frase. */
  sintetiza(texto: string): Promise<string[]>;
  /** O reprodutor único da aba (`reprodutor-unico.ts`). */
  iniciaSequencia(escuta: EscutaSequencia): Sequencia;
  /** A resposta está tocando no alto-falante: ponte e demora não a cortam. */
  ocupado(): boolean;
  /** A voz do navegador, de reserva. */
  reserva(texto: string): void;
  calaReserva(): void;
  /** O erro corta a resposta em curso pela fila dela, que fica sabendo e não trava. */
  cancelaTurno(): void;
  /** Frase → áudio sintetizado, do agente. */
  cache: Map<string, Promise<string[]>>;
  aleatorio?: () => number;
  espera?: (ms: number) => Promise<void>;
};

export type VozDeApoio = {
  /** Ao abrir a tela: pré-sintetiza as frases de apoio. */
  prepara(): void;
  ponte(): void;
  demora(): void;
  erro(texto: string): void;
  /** A resposta chegou, ou a conversa parou: a frase de apoio some, na síntese ou tocando. */
  cala(): void;
};

/**
 * Um baralho de `0..total-1`: passa por todas antes de repetir, e a virada não repete a última. Com
 * "só não repete a anterior", a mesma frase podia voltar dois turnos depois.
 */
export function criaBaralho(total: number, aleatorio: () => number = Math.random): () => number {
  let monte: number[] = [];
  let ultima: number | null = null;
  return () => {
    if (monte.length === 0) {
      monte = Array.from({ length: total }, (_, i) => i);
      for (let i = monte.length - 1; i > 0; i -= 1) {
        const j = Math.min(i, Math.floor(aleatorio() * (i + 1)));
        [monte[i], monte[j]] = [monte[j], monte[i]];
      }
      if (monte.length > 1 && monte[0] === ultima) [monte[0], monte[1]] = [monte[1], monte[0]];
    }
    ultima = monte.shift() ?? 0;
    return ultima;
  };
}

export function criaVozDeApoio(p: PortasDoApoio): VozDeApoio {
  const aleatorio = p.aleatorio ?? Math.random;
  const espera = p.espera ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
  const listas = { ponte: FRASES_DE_PONTE, demora: FRASES_DE_DEMORA };
  const baralhos = { ponte: criaBaralho(listas.ponte.length, aleatorio), demora: criaBaralho(listas.demora.length, aleatorio) };
  const proxima = { ponte: baralhos.ponte(), demora: baralhos.demora() };
  /* Cada fala nova e cada `cala` invalidam a anterior, que ainda pode estar na síntese. */
  let vez = 0;
  let tocando: Sequencia | null = null;

  const audio = (texto: string) => {
    const guardado = p.cache.get(texto);
    if (guardado !== undefined) return guardado;
    const pedido = p.sintetiza(texto);
    p.cache.set(texto, pedido);
    // A rota falhou: sai do cache, e a próxima vez tenta de novo.
    pedido.catch(() => {
      if (p.cache.get(texto) === pedido) p.cache.delete(texto);
    });
    return pedido;
  };

  const para = () => {
    tocando?.para();
    tocando = null;
    p.calaReserva();
  };

  const toca = (urls: string[], erro: string | null) => {
    const sequencia = p.iniciaSequencia({
      aoProgredir: () => {},
      aoTerminar: () => {
        if (tocando === sequencia) tocando = null;
      },
      aoFalhar: () => {
        if (tocando !== sequencia) return;
        tocando = null;
        if (erro !== null) p.reserva(erro);
      },
    });
    tocando = sequencia;
    for (const url of urls) sequencia.enfileira(url);
    sequencia.fecha();
  };

  const fala = (texto: string, erro: boolean) => {
    const minha = ++vez;
    para();
    if (erro) p.cancelaTurno();
    const prazo = erro ? espera(PRAZO_DO_ERRO_MS).then(() => null) : new Promise<never>(() => {});
    Promise.race([audio(texto), prazo]).then(
      (urls) => {
        if (minha !== vez) return;
        if (urls === null) p.reserva(texto);
        else if (erro || !p.ocupado()) toca(urls, erro ? texto : null);
      },
      () => {
        if (minha === vez) p.reserva(texto);
      },
    );
  };

  const daLista = (qual: 'ponte' | 'demora') => {
    const lista = listas[qual];
    const i = proxima[qual];
    proxima[qual] = baralhos[qual]();
    fala(lista[i], false);
    audio(lista[proxima[qual]]).catch(() => {});
  };

  return {
    prepara() {
      const primeiras = [listas.ponte[proxima.ponte], listas.demora[proxima.demora]];
      const ordem = [...primeiras, ...[...listas.ponte, ...listas.demora].filter((f) => !primeiras.includes(f))];
      // Uma de cada vez, para não disputar a rota com a resposta; a primeira falha encerra.
      ordem.reduce<Promise<unknown>>((antes, texto) => antes.then(() => audio(texto)), Promise.resolve()).catch(() => {});
    },
    ponte: () => daLista('ponte'),
    demora: () => daLista('demora'),
    erro: (texto) => fala(texto, true),
    cala() {
      vez += 1;
      para();
    },
  };
}
