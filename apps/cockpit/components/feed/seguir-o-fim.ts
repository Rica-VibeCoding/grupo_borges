/**
 * SEGUIR O FIM. Com o Rica colado no fim do feed, o que chega embaixo (fala,
 * pensamento, ferramenta, o texto crescendo no streaming) empurra a conversa
 * para cima com uma mola, em vez de o `scrollTop` saltar no mesmo quadro.
 *
 * A mola é criticamente amortecida e resolvida na forma fechada, não somada
 * quadro a quadro: não passa do alvo, não treme com `dt` irregular (aba em
 * segundo plano, quadro perdido no iPhone) e guarda a VELOCIDADE quando o alvo
 * muda no meio — item novo chegando durante a subida não dá tranco, só estica
 * a mesma subida. O alvo é lido vivo a cada quadro (o fim de hoje), então
 * redirecionar não custa nada: não há animação a refazer por flush.
 *
 * Custo: um `requestAnimationFrame` por quadro SÓ enquanto há distância a
 * vencer; parada, a mola não agenda nada. Não usa `scroll-behavior: smooth`,
 * que o navegador reinicia a cada escrita e briga com o streaming.
 *
 * As funções puras ficam em cima (testadas em `seguir-o-fim.test.ts`); o
 * seguidor embaixo é a casca que escreve no elemento.
 */

/** Rigidez da mola, em 1/s. Com 22, a subida assenta em ~300 ms (`--ck-dur-calm`). */
export const OMEGA_DA_MOLA = 22;

/** Abaixo disso (px e px/s) a mola chegou: encaixa no alvo e para de agendar. */
const PERTO_PX = 0.5;
const PARADA_PX_S = 4;

/** Quadro de referência para o primeiro passo, que ainda não tem anterior. */
export const QUADRO_MS = 1000 / 60;

/**
 * Depois de o Rica tocar, rolar a roda ou usar o teclado no feed, quanto tempo
 * a mola fica de mãos fora — o bastante para o `onScroll` dele chegar e dizer
 * se ele descolou.
 */
export const MAOS_MS = 300;

/** Logo depois de montar, o virtualizador ainda está medindo: tudo salta. */
export const ASSENTO_MS = 600;

export type EstadoDaMola = { pos: number; vel: number };
export type PassoDaMola = EstadoDaMola & { parou: boolean };

/**
 * Um passo da mola criticamente amortecida, exato para qualquer `dtMs`.
 * Com d₀ = pos − alvo e c = vel + ω·d₀:
 *   pos(t) = alvo + (d₀ + c·t)·e^(−ωt)
 *   vel(t) = (vel − ω·c·t)·e^(−ωt)
 * O fim da rolagem é um teto físico: passar dele seria escrever um `scrollTop`
 * que o navegador corta, então a mola encosta e zera a velocidade.
 */
export function passoDaMola(estado: EstadoDaMola, alvo: number, dtMs: number, omega: number = OMEGA_DA_MOLA): PassoDaMola {
  const t = Math.max(0, dtMs) / 1000;
  const d0 = estado.pos - alvo;
  const c = estado.vel + omega * d0;
  const decaimento = Math.exp(-omega * t);
  let pos = alvo + (d0 + c * t) * decaimento;
  let vel = (estado.vel - omega * c * t) * decaimento;
  if (pos > alvo) {
    pos = alvo;
    vel = 0;
  }
  if (Math.abs(alvo - pos) < PERTO_PX && Math.abs(vel) < PARADA_PX_S) {
    return { pos: alvo, vel: 0, parou: true };
  }
  return { pos, vel, parou: false };
}

export type ModoDeSeguir = 'nada' | 'salto' | 'mola';

/**
 * Como alcançar o fim, colado. Salta quando o movimento não serviria ao olho:
 * movimento reduzido pedido pelo sistema, a carga ainda assentando, ou mais de
 * uma tela de distância (troca de sessão, histórico chegando de uma vez) — aí
 * não há o que acompanhar.
 */
export function modoDeSeguir(entrada: {
  distancia: number;
  clientHeight: number;
  reduzido: boolean;
  assentando: boolean;
}): ModoDeSeguir {
  if (entrada.distancia < PERTO_PX) return 'nada';
  if (entrada.reduzido || entrada.assentando) return 'salto';
  if (entrada.distancia > entrada.clientHeight) return 'salto';
  return 'mola';
}

export type ElementoRolavel = { scrollTop: number; scrollHeight: number; clientHeight: number };

export type Relogio = {
  agenda(quadro: (agoraMs: number) => void): number;
  cancela(id: number): void;
};

const relogioDoNavegador: Relogio = {
  agenda: (quadro) => requestAnimationFrame(quadro),
  cancela: (id) => cancelAnimationFrame(id),
};

export type Seguidor = {
  /** Põe a mola a caminho do fim; já andando, não faz nada — o alvo é lido a cada quadro. */
  segue(): void;
  /** Para onde estiver. */
  para(): void;
  ativo(): boolean;
  /**
   * A rolagem que o `onScroll` viu foi a da mola? Andando, sempre. Parada,
   * só o eco da última escrita (o evento chega um quadro depois dela), e uma
   * vez só. É o que impede a subida a meio caminho de ler como "o Rica descolou".
   */
  eco(scrollTop: number): boolean;
};

export function criaSeguidor(elementoDe: () => ElementoRolavel | null, relogio: Relogio = relogioDoNavegador): Seguidor {
  let estado: EstadoDaMola = { pos: 0, vel: 0 };
  let quadro: number | null = null;
  let anterior: number | null = null;
  let escrito = Number.NaN;

  const passo = (agoraMs: number) => {
    const elemento = elementoDe();
    if (!elemento) {
      quadro = null;
      return;
    }
    // Quem mexeu no `scrollTop` entre dois quadros sem ser o Rica (a mão dele
    // para a mola antes) foi o virtualizador compensando item remedido, ou o
    // navegador cortando conteúdo que encolheu: a mola parte de onde ficou.
    if (Math.abs(elemento.scrollTop - escrito) > 1) estado = { ...estado, pos: elemento.scrollTop };
    const alvo = Math.max(0, elemento.scrollHeight - elemento.clientHeight);
    const dt = anterior === null ? QUADRO_MS : agoraMs - anterior;
    anterior = agoraMs;
    const proximo = passoDaMola(estado, alvo, dt);
    estado = { pos: proximo.pos, vel: proximo.vel };
    elemento.scrollTop = proximo.pos;
    escrito = elemento.scrollTop;
    quadro = proximo.parou ? null : relogio.agenda(passo);
  };

  return {
    segue() {
      if (quadro !== null) return;
      const elemento = elementoDe();
      if (!elemento) return;
      estado = { pos: elemento.scrollTop, vel: 0 };
      escrito = elemento.scrollTop;
      anterior = null;
      quadro = relogio.agenda(passo);
    },
    para() {
      if (quadro !== null) relogio.cancela(quadro);
      quadro = null;
      estado = { ...estado, vel: 0 };
    },
    ativo() {
      return quadro !== null;
    },
    eco(scrollTop) {
      if (quadro !== null) return true;
      const ehEco = Math.abs(scrollTop - escrito) <= 1;
      escrito = Number.NaN;
      return ehEco;
    },
  };
}
