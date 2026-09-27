import type { Estado } from '@/lib/conversa/tipos';

/**
 * O que a Moldura desenha em cada momento, sem WebGL: pesos de cada camada de
 * luz e o ritmo. O shader só soma camadas; quem decide a mistura é daqui, e é
 * o que o teste cobre.
 *
 * `preparando` não é estado da máquina — é o detector ainda baixando —, mas a
 * tela desenha como se fosse.
 */
export type Cena = Estado | 'preparando';

export const CAMADAS = ['voce', 'ze', 'pensa', 'prepara', 'erro', 'gelo', 'parado'] as const;
export type Camada = (typeof CAMADAS)[number];
export type Pesos = Record<Camada, number>;

/** Tom do clarão da troca de vez: quente = sua vez, frio = vez dele. */
export type Tom = 'voce' | 'ze' | 'pensa' | 'prepara' | 'erro';

const VAZIO: Pesos = { voce: 0, ze: 0, pensa: 0, prepara: 0, erro: 0, gelo: 0, parado: 0 };

export function alvosDaMoldura(cena: Cena): Pesos {
  switch (cena) {
    case 'ouvindo':
      return { ...VAZIO, voce: 1 };
    case 'falando':
      return { ...VAZIO, ze: 1 };
    case 'transcrevendo':
    case 'esperandoZe':
      return { ...VAZIO, pensa: 1 };
    case 'preparando':
      return { ...VAZIO, prepara: 1 };
    case 'interrompendo':
      // A sua voz sobe do pé enquanto a dele fica congelada no topo.
      return { ...VAZIO, voce: 1, gelo: 1 };
    case 'erro':
      return { ...VAZIO, erro: 1 };
    case 'parado':
      return { ...VAZIO, parado: 1 };
  }
}

export function tomDaCena(cena: Cena): Tom {
  if (cena === 'ouvindo' || cena === 'interrompendo') return 'voce';
  if (cena === 'falando') return 'ze';
  if (cena === 'erro') return 'erro';
  if (cena === 'preparando' || cena === 'parado') return 'prepara';
  return 'pensa';
}

/** Aproxima os pesos do alvo; `dt = Infinity` salta direto (movimento reduzido). */
export function aproxima(atual: Pesos, alvo: Pesos, dt: number, taxa = 7): Pesos {
  const k = Number.isFinite(dt) ? 1 - Math.exp(-dt * taxa) : 1;
  const novo = { ...atual };
  for (const c of CAMADAS) novo[c] = atual[c] + (alvo[c] - atual[c]) * k;
  return novo;
}

export function assentou(atual: Pesos, alvo: Pesos, folga = 0.004): boolean {
  return CAMADAS.every((c) => Math.abs(atual[c] - alvo[c]) <= folga);
}

/** Cenas que se mexem sozinhas. Parado e erro são quadros fixos: o laço dorme. */
export function animaSozinha(cena: Cena): boolean {
  return cena !== 'parado' && cena !== 'erro';
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
