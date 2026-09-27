/**
 * A escuta que emudece no iPhone. Com a voz do Zé tocando, o iOS pode suspender o áudio
 * de captura: o contexto de áudio do detector fica `suspended` (ou `interrupted`, que só o
 * Safari tem), ou a faixa do microfone fica muda — e nada dispara `ended`. A tela dizia
 * "Pode falar" e não ouvia mais nada (27/09, iPhone do Rica).
 *
 * Enquanto o detector está ligado, a vigia confere três sinais e sobe uma escada: retoma o
 * contexto; se não voltar em ~1 s, reabre detector e microfone; se nem assim, desiste e a
 * tela pede o toque — no toque, o gesto do usuário destrava o que o iOS travou.
 */

export type SinaisDaEscuta = {
  /** `AudioContext.state` do detector; `null` enquanto ele ainda não existe. */
  contexto: string | null;
  /** `MediaStreamTrack.muted` da faixa em uso. */
  faixaMuda: boolean;
  /** Tempo desde o último quadro de áudio processado — ou desde que a escuta ligou. */
  semQuadroHaMs: number;
};

export type QuedaDaEscuta = 'contexto' | 'faixa' | 'quadros';

export const PRAZOS_DA_ESCUTA = {
  /** O detector processa um quadro a cada 32 ms: sem nenhum por isso, o áudio parou. */
  semQuadro: 1_000,
  /** Depois do `resume()`, quanto esperar antes de reabrir. */
  retomar: 1_000,
  /** Reabrir cria detector e microfone novos; sem voltar até aqui, a tela pede o toque. */
  reabrir: 4_000,
} as const;

export function quedaDaEscuta(s: SinaisDaEscuta): QuedaDaEscuta | null {
  if (s.contexto !== null && s.contexto !== 'running') return 'contexto';
  if (s.faixaMuda) return 'faixa';
  if (s.semQuadroHaMs >= PRAZOS_DA_ESCUTA.semQuadro) return 'quadros';
  return null;
}

export type Vigia = { fase: 'viva' } | { fase: 'retomando' | 'reabrindo'; desde: number };
export type AcaoDaVigia = 'nada' | 'retomar' | 'reabrir' | 'desistir';

const VIVA: Vigia = { fase: 'viva' };

/** Um degrau da escada. Qualquer sinal de vida volta ao começo. */
export function passoDaVigia(
  vigia: Vigia,
  queda: QuedaDaEscuta | null,
  agora: number,
): { vigia: Vigia; acao: AcaoDaVigia } {
  if (queda === null) return { vigia: VIVA, acao: 'nada' };
  if (vigia.fase === 'viva') return { vigia: { fase: 'retomando', desde: agora }, acao: 'retomar' };
  const passou = agora - vigia.desde;
  if (vigia.fase === 'retomando') {
    return passou >= PRAZOS_DA_ESCUTA.retomar
      ? { vigia: { fase: 'reabrindo', desde: agora }, acao: 'reabrir' }
      : { vigia, acao: 'nada' };
  }
  return passou >= PRAZOS_DA_ESCUTA.reabrir ? { vigia: VIVA, acao: 'desistir' } : { vigia, acao: 'nada' };
}

export type VigiaDaEscuta = {
  /** O detector ligou: começa a conferir (na hora e a cada batida). */
  comeca(): void;
  /** O detector desligou: para, e o que estava em voo (uma reabertura) não conta mais. */
  para(): void;
  /** Um sinal mudou (`statechange`, `mute`, `unmute`): confere já, sem esperar a batida. */
  confere(): void;
};

export type DependenciasDaVigia = {
  leSinais(): SinaisDaEscuta;
  retoma(): void;
  reabre(): Promise<void>;
  desiste(): void;
  agora(): number;
  /** Chama `fn` a cada `ms`; devolve o cancelamento. */
  bate(fn: () => void, ms: number): () => void;
};

export const BATIDA_DA_VIGIA_MS = 250;

export function criaVigiaDaEscuta(d: DependenciasDaVigia): VigiaDaEscuta {
  let vigia: Vigia = VIVA;
  let rodada = 0;
  let cancela: (() => void) | null = null;

  const para = () => {
    rodada += 1;
    cancela?.();
    cancela = null;
    vigia = VIVA;
  };

  const confere = () => {
    if (cancela === null) return;
    const passo = passoDaVigia(vigia, quedaDaEscuta(d.leSinais()), d.agora());
    vigia = passo.vigia;
    if (passo.acao === 'retomar') d.retoma();
    if (passo.acao === 'reabrir') {
      const minha = rodada;
      d.reabre().catch(() => {
        if (minha !== rodada) return;
        para();
        d.desiste();
      });
    }
    if (passo.acao === 'desistir') {
      para();
      d.desiste();
    }
  };

  return {
    comeca() {
      if (cancela !== null) return;
      rodada += 1;
      vigia = VIVA;
      cancela = d.bate(confere, BATIDA_DA_VIGIA_MS);
      confere();
    },
    para,
    confere,
  };
}
