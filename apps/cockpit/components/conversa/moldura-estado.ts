import type { Estado } from '@/lib/conversa/tipos';

/**
 * O que a Moldura desenha em cada momento, sem WebGL: pesos de cada camada de
 * luz e o ritmo. O shader só soma camadas; quem decide a mistura é daqui, e é
 * o que o teste cobre.
 *
 * `preparando` não é estado da máquina — é o detector ainda baixando —, mas a
 * tela desenha como se fosse.
 */
/**
 * `trabalhando` e `ocupado` só existem na tela (`estado-da-vez.ts`): o agente usando ferramenta, e o
 * erro de agente ocupado — que não quebrou, só não pôde ouvir agora, e ganha cor própria (Rica, 29/09).
 * `pronta` também: voltou da recarga com resposta dele por tocar, esperando o toque
 * (`retomada-da-conversa.ts`).
 */
export type Cena = Estado | 'preparando' | 'trabalhando' | 'ocupado' | 'pronta';

export const CAMADAS = ['voce', 'ze', 'pensa', 'prepara', 'erro', 'gelo', 'parado', 'ocupado'] as const;
export type Camada = (typeof CAMADAS)[number];
export type Pesos = Record<Camada, number>;

/** Tom do clarão da troca de vez: quente = sua vez, frio = vez dele. */
export type Tom = 'voce' | 'ze' | 'pensa' | 'prepara' | 'erro' | 'ocupado';

/**
 * Pensar mistura a sua cor com a dele (Rica, 29/09): a sua voz virando a resposta dele. `peso` é
 * quanto já é dele (0 = você, 1 = ele), em sRGB, como a troca de cor da esfera já anda.
 */
export type Mistura = { entre: readonly [Tom, Tom]; peso: number };

/** A mistura fixa, meio a meio — a do token `--ck-conversa-pensa` e do clarão do pensar. */
export const PENSAR_AO_MEIO: Mistura = { entre: ['voce', 'ze'], peso: 0.5 };

type Rgb = readonly [number, number, number];

export function misturaCor(a: Rgb, b: Rgb, peso: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * peso, a[1] + (b[1] - a[1]) * peso, a[2] + (b[2] - a[2]) * peso];
}

export function corDoTom(cores: Record<Tom, Rgb>, t: Tom | Mistura): [number, number, number] {
  return typeof t === 'string' ? [...cores[t]] : misturaCor(cores[t.entre[0]], cores[t.entre[1]], t.peso);
}

/** As cores lidas do tema com o `pensa` da tela de voz: a mistura meio a meio, como no token. */
export function comPensarAoMeio<T extends { voce: Rgb; ze: Rgb }>(cores: T): T & { pensa: [number, number, number] } {
  return { ...cores, pensa: misturaCor(cores.voce, cores.ze, PENSAR_AO_MEIO.peso) };
}

const VAZIO: Pesos = { voce: 0, ze: 0, pensa: 0, prepara: 0, erro: 0, gelo: 0, parado: 0, ocupado: 0 };

export function alvosDaMoldura(cena: Cena): Pesos {
  switch (cena) {
    case 'ouvindo':
      return { ...VAZIO, voce: 1 };
    case 'falando':
    case 'pronta':
      return { ...VAZIO, ze: 1 };
    case 'transcrevendo':
    case 'esperandoZe':
      return { ...VAZIO, pensa: 1 };
    case 'trabalhando':
      return { ...VAZIO, pensa: 0.6, ze: 0.4 };
    case 'preparando':
      return { ...VAZIO, prepara: 1 };
    case 'interrompendo':
      // A sua voz sobe do pé enquanto a dele fica congelada no topo.
      return { ...VAZIO, voce: 1, gelo: 1 };
    case 'erro':
      return { ...VAZIO, erro: 1 };
    case 'ocupado':
      return { ...VAZIO, ocupado: 1 };
    case 'parado':
      return { ...VAZIO, parado: 1 };
  }
}

export function tomDaCena(cena: Cena): Tom {
  if (cena === 'ouvindo' || cena === 'interrompendo') return 'voce';
  if (cena === 'falando' || cena === 'pronta') return 'ze';
  if (cena === 'erro') return 'erro';
  if (cena === 'ocupado') return 'ocupado';
  if (cena === 'preparando' || cena === 'parado') return 'prepara';
  return 'pensa';
}

/** Quanto andar rumo ao alvo neste quadro; `dt = Infinity` salta direto (movimento reduzido). */
export function fatorDeAproximacao(dt: number, taxa = 7): number {
  return Number.isFinite(dt) ? 1 - Math.exp(-dt * taxa) : 1;
}

/** Aproxima os pesos do alvo (serve à Moldura e à Esfera). */
export function aproxima<T extends Record<string, number>>(atual: T, alvo: T, dt: number, taxa = 7): T {
  const k = fatorDeAproximacao(dt, taxa);
  const novo = { ...atual };
  for (const c of Object.keys(alvo) as (keyof T)[]) {
    novo[c] = (atual[c] + (alvo[c] - atual[c]) * k) as T[keyof T];
  }
  return novo;
}

export function assentou<T extends Record<string, number>>(atual: T, alvo: T, folga = 0.004): boolean {
  return Object.keys(alvo).every((c) => Math.abs(atual[c] - alvo[c]) <= folga);
}

/** Cenas que se mexem sozinhas. Parado, erro, ocupado e resposta pronta são quadros fixos: o laço dorme. */
export function animaSozinha(cena: Cena): boolean {
  return cena !== 'parado' && cena !== 'erro' && cena !== 'ocupado' && cena !== 'pronta';
}

/** Cenas em que o volume (microfone ou voz do Zé) mexe na luz. */
export function ouveVolume(cena: Cena): boolean {
  return cena === 'ouvindo' || cena === 'falando' || cena === 'interrompendo';
}

/** Velocidade do cometa, em rad/s: transcrever é rápido, esperar é calmo. */
export function velocidadeDaOrbita(cena: Cena): number {
  return cena === 'transcrevendo' ? 7.5 : 2.9;
}

/** A cauda do cometa cresce com a espera, até o aviso de 20 s. */
export function caudaDaEspera(cena: Cena, segundosNaCena: number): number {
  return 0.9 + 1.6 * (cena === 'esperandoZe' ? Math.min(1, segundosNaCena / 20) : 0);
}

/** Volume suavizado: sobe rápido e desce devagar, como um VU. */
export function suavizaNivel(atual: number, alvo: number, dt: number): number {
  const k = alvo > atual ? 0.45 : 0.11;
  return atual + (alvo - atual) * (1 - Math.pow(1 - k, dt * 60));
}
