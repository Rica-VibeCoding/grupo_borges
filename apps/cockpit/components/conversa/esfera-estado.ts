import { fatorDeAproximacao, tomDaCena, type Cena, type Mistura, type Tom } from './moldura-estado.ts';

/**
 * O que a Esfera desenha em cada momento, sem WebGL: o peso de cada forma, a
 * cor e o ritmo. O shader só mistura; quem decide é daqui, e é o que o teste
 * cobre. Parado e erro são quadros fixos, como na Moldura.
 */
export const FORMAS = ['voce', 'ze', 'calma', 'cristal', 'colapso', 'enche', 'apaga'] as const;
export type Forma = (typeof FORMAS)[number];
export type PesosDaEsfera = Record<Forma, number>;

const REPOUSO: PesosDaEsfera = { voce: 0, ze: 0, calma: 0, cristal: 0, colapso: 0, enche: 0, apaga: 0 };

export function alvosDaEsfera(cena: Cena): PesosDaEsfera {
  switch (cena) {
    case 'ouvindo':
      return { ...REPOUSO, voce: 1 };
    case 'falando':
      return { ...REPOUSO, ze: 1 };
    case 'transcrevendo':
    case 'esperandoZe':
      return { ...REPOUSO, calma: 1 };
    case 'trabalhando':
      // Ocupado, não falando: a calma do pensar ganha facetas — a matéria mexe, sem voz.
      return { ...REPOUSO, calma: 0.55, cristal: 0.45 };
    case 'interrompendo':
      // A voz dele cristaliza; a sua ainda puxa um pouco para baixo.
      return { ...REPOUSO, cristal: 1, voce: 0.4 };
    case 'erro':
      return { ...REPOUSO, colapso: 1 };
    case 'ocupado':
    case 'pronta':
      // Inteira e parada. Ocupado: não quebrou nada, sem a rachadura do erro (Rica, 29/09). Pronta: a
      // resposta dele espera o toque. A cor é de cada um (`coresDaEsfera`).
      return REPOUSO;
    case 'preparando':
      return { ...REPOUSO, enche: 1 };
    case 'parado':
      return REPOUSO;
    case 'desligado':
      // Murcha e apaga por dentro: sem núcleo, sem halo, só a casca (`uApaga` no shader).
      return { ...REPOUSO, apaga: 1 };
  }
}

/**
 * Quanto do pensar já é dele (0 = você, 1 = ele). Logo que você solta a fala, mais você; pensando ou
 * trabalhando, meio a meio — iguais, para a cor não voltar quando ele alterna entre os dois. "Quão
 * perto da resposta" não existe como sinal: o resto do caminho até o azul a troca de cor anda sozinha.
 */
const PESO_DELE_AO_PENSAR = { transcrevendo: 0.3, esperandoZe: 0.5, trabalhando: 0.5 } as const;
const pensar = (cena: keyof typeof PESO_DELE_AO_PENSAR): Mistura => ({ entre: ['voce', 'ze'], peso: PESO_DELE_AO_PENSAR[cena] });

/**
 * Corpo e borda: a borda diz de quem é a vez; na interrupção, o corpo é ele apagado e a borda é você.
 * Pensar não tem cor própria: é a sua virando a dele (`Mistura`).
 */
export function coresDaEsfera(cena: Cena): { corpo: Tom | Mistura; brilho: number; borda: Tom | Mistura } {
  switch (cena) {
    case 'ouvindo':
      return { corpo: 'voce', brilho: 1, borda: 'voce' };
    case 'falando':
      return { corpo: 'ze', brilho: 1, borda: 'ze' };
    case 'transcrevendo':
    case 'esperandoZe':
      return { corpo: pensar(cena), brilho: 1, borda: pensar(cena) };
    case 'trabalhando':
      // O corpo ainda pensa; a borda já é dele, executando.
      return { corpo: pensar(cena), brilho: 1, borda: 'ze' };
    case 'interrompendo':
      return { corpo: 'ze', brilho: 0.55, borda: 'voce' };
    case 'erro':
      return { corpo: 'erro', brilho: 0.8, borda: 'erro' };
    case 'ocupado':
      return { corpo: 'ocupado', brilho: 0.8, borda: 'ocupado' };
    case 'pronta':
      return { corpo: 'ze', brilho: 0.8, borda: 'ze' };
    case 'preparando':
      return { corpo: 'prepara', brilho: 1, borda: 'prepara' };
    case 'parado':
      // Em repouso a matéria fica mais apagada: ainda não é a vez de ninguém.
      return { corpo: 'prepara', brilho: 0.7, borda: 'prepara' };
    case 'desligado':
      return { corpo: 'desligado', brilho: 0.35, borda: 'desligado' };
  }
}

/**
 * A escuta com ele pensando (30/09): na espera o microfone fica aberto e a fala do Rica entra na
 * fila dele sem frear. `aberta`: o pensar segue e ganha um toque seu — a forma `voce` puxa o pé da
 * esfera com a sua voz, e a borda pende para a sua cor. `falando`: a sua vez inteira, sem apagar os
 * veios do pensar. Nada de forma nova: é a mistura das que já existem, como em `trabalhando`.
 */
export type EscutaNoPensar = 'nao' | 'aberta' | 'falando';

export function alvosComEscuta(cena: Cena, escuta: EscutaNoPensar): PesosDaEsfera {
  const alvo = alvosDaEsfera(cena);
  if (escuta === 'aberta') return { ...alvo, voce: 0.25 };
  if (escuta === 'falando') return { ...alvo, calma: 0.5 };
  return alvo;
}

export function coresComEscuta(cena: Cena, escuta: EscutaNoPensar): ReturnType<typeof coresDaEsfera> {
  const cores = coresDaEsfera(cena);
  if (escuta === 'aberta') return { ...cores, borda: { entre: ['voce', 'ze'], peso: 0.2 } };
  if (escuta === 'falando') return { ...cores, corpo: { entre: ['voce', 'ze'], peso: 0.3 } };
  return cores;
}

/** O clarão da troca de cena. A fala que entra na fila dele acende na sua cor: é o "recebido". */
export function tomDoClarao(anterior: Cena, cena: Cena): Tom {
  const recebeu = anterior === 'transcrevendo' && (cena === 'esperandoZe' || cena === 'trabalhando' || cena === 'falando');
  return recebeu ? 'voce' : tomDaCena(cena);
}

/** O ritmo troca sem salto: chega ao novo em ~0,4 s (taxa 6, a mesma dos pesos e das cores). */
/**
 * Quão rápido a esfera chega na cena nova. Desligar é devagar, como um aparelho perdendo a força
 * (~2 s); todo o resto, inclusive religar, na taxa de sempre (~0,4 s).
 */
export function taxaDaTroca(cena: Cena): number {
  return cena === 'desligado' ? 1.4 : 6;
}

export function aproximaRitmo(atual: number, alvo: number, dt: number): number {
  return atual + (alvo - atual) * fatorDeAproximacao(dt, 6);
}

/** Velocidade do tempo da matéria: transcrever agita, esperar acalma, interromper congela. */
export function ritmoDaEsfera(cena: Cena): number {
  switch (cena) {
    case 'transcrevendo':
      return 1.8;
    case 'falando':
      return 1.2;
    case 'ouvindo':
      return 1;
    case 'esperandoZe':
      return 0.9;
    case 'trabalhando':
      return 1.5;
    case 'preparando':
      return 0.6;
    default:
      return 0;
  }
}

export type Cor = readonly [number, number, number];

export function aproximaCor(atual: Cor, alvo: Cor, k: number): Cor {
  return [atual[0] + (alvo[0] - atual[0]) * k, atual[1] + (alvo[1] - atual[1]) * k, atual[2] + (alvo[2] - atual[2]) * k];
}

/** Onde e de que tamanho: em px CSS da janela, y para baixo. */
export type Lugar = { x: number; y: number; raio: number; topo: number; base: number };

/**
 * A esfera cabe no palco (o espaço entre o cabeçalho e as palavras): raio de
 * 36% da altura, sem passar de 31% da largura da tela nem de 150 px. Quando a
 * resposta do Zé cresce, o palco encolhe e a esfera abre espaço.
 */
export function lugarNoPalco(palco: { left: number; top: number; width: number; height: number }, larguraDaTela: number): Lugar {
  const raio = Math.max(24, Math.min(palco.height * 0.36, larguraDaTela * 0.31, 150));
  return {
    x: palco.left + palco.width / 2,
    y: palco.top + palco.height / 2,
    raio,
    topo: palco.top,
    base: palco.top + palco.height,
  };
}

export function aproximaLugar(atual: Lugar, alvo: Lugar, k: number): Lugar {
  return {
    x: atual.x + (alvo.x - atual.x) * k,
    y: atual.y + (alvo.y - atual.y) * k,
    raio: atual.raio + (alvo.raio - atual.raio) * k,
    topo: atual.topo + (alvo.topo - atual.topo) * k,
    base: atual.base + (alvo.base - atual.base) * k,
  };
}

export function lugarAssentou(atual: Lugar, alvo: Lugar): boolean {
  return (['x', 'y', 'raio', 'topo', 'base'] as const).every((c) => Math.abs(atual[c] - alvo[c]) < 0.25);
}

/**
 * Teto de quadros. A Esfera é o desenho mais caro da conversa: roda a 60
 * enquanto o aparelho aguenta; se a média do intervalo entre quadros passar de
 * 24 ms, cai para 30 e fica — estável é melhor que oscilando. A média é lenta
 * (5% por quadro) para um tranco de carga não derrubar o ritmo à toa.
 */
export type Regulador = { media: number; pesado: boolean; ultimoDesenho: number; desenha: boolean };

export const REGULADOR_INICIAL: Regulador = { media: 1000 / 60, pesado: false, ultimoDesenho: 0, desenha: true };

export function regulaQuadro(r: Regulador, agora: number, intervaloMs: number): Regulador {
  const media = r.media + (intervaloMs - r.media) * 0.05;
  const pesado = r.pesado || media > 24;
  const desenha = !pesado || agora - r.ultimoDesenho >= 30;
  return { media, pesado, ultimoDesenho: desenha ? agora : r.ultimoDesenho, desenha };
}
