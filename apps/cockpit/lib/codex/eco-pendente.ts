'use client';

/**
 * O QUE O RICA ACABOU DE MANDAR PRA TARA, antes de existir no rollout.
 *
 * Medido na `:3008` em 10/08: entre o `POST /input` voltar 200 e o texto
 * aparecer em `GET /codex/messages` passam **12 segundos**. Não é lentidão de
 * rede nem do poll de 3 s — é o `codex exec` subindo e retomando a thread antes
 * de escrever a primeira linha. Doze segundos de tela parada depois do toque
 * foi o que o Rica reportou: *"eu mando texto, ela não mostra que recebeu"*.
 *
 * O ramo do Claude Code não sofre disso porque o eco dele volta pelo stream em
 * milissegundos. Como a ordem foi "mesma UI do CC", a bolha do Rica tem que
 * nascer no gesto — o feed pinta o texto e o poll depois o substitui pelo real.
 *
 * POR QUE UM STORE DE MÓDULO e não uma prop: o `Composer` e o `FeedDaConversa`
 * são irmãos em `app/agente/[slug]/page.tsx`, que é território do Daniel. Um
 * canal externo liga os dois sem tocar na página.
 *
 * IDENTIDADE DE OBJETO É REQUISITO, não estilo: quem lê é `useSyncExternalStore`,
 * e a doc do React diz nos Caveats para devolver *"a cached last snapshot"*
 * quando nada mudou — devolver array novo a cada leitura dá laço infinito. O
 * mesmo motivo pelo qual o adaptador do feed é fábrica com memória
 * (`adapta-mensagens.ts`).
 */

export type EcoPendente = {
  /** Chave estável da bolha otimista; não colide com as do rollout. */
  id: string;
  texto: string;
  emMs: number;
};

/** Teto de vida da bolha otimista. Turno de Codex leva minutos, mas o ECO do
 *  texto do Rica é o começo do turno, não o fim — 12 s medidos, 3 min de folga.
 *  Passou disso, o envio não chegou, e manter a bolha diria que chegou. Quem
 *  avisa que a entrega falhou é o composer, que tem a máquina de seis fases. */
const PRAZO_MS = 180_000;

const porAgente = new Map<string, EcoPendente[]>();
const ouvintes = new Map<string, Set<() => void>>();

/** Uma instância só para todo agente sem pendência: `[]` novo a cada leitura
 *  quebraria a identidade que o `useSyncExternalStore` exige. */
const VAZIO: readonly EcoPendente[] = Object.freeze([]);

let contador = 0;

function avisa(slug: string): void {
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

function grava(slug: string, lista: readonly EcoPendente[]): void {
  if (lista.length === 0) porAgente.delete(slug);
  else porAgente.set(slug, lista as EcoPendente[]);
  avisa(slug);
}

/** Chamado no instante do despacho, não na resposta do POST. */
export function registraEcoPendente(slug: string, texto: string): void {
  const corpo = texto.trim();
  if (!corpo) return;
  contador += 1;
  const atual = porAgente.get(slug) ?? [];
  grava(slug, [...atual, { id: `eco-${contador}`, texto: corpo, emMs: Date.now() }]);
}

export function lePendentes(slug: string): readonly EcoPendente[] {
  return porAgente.get(slug) ?? VAZIO;
}

export function assinaPendentes(slug: string, fn: () => void): () => void {
  let conjunto = ouvintes.get(slug);
  if (!conjunto) {
    conjunto = new Set();
    ouvintes.set(slug, conjunto);
  }
  conjunto.add(fn);
  return () => {
    conjunto.delete(fn);
    if (conjunto.size === 0) ouvintes.delete(slug);
  };
}

/**
 * Some com o que já chegou pelo rollout, e com o que passou do prazo.
 *
 * A comparação é por TEXTO porque a bolha otimista não tem id do Codex — ela
 * nasce antes de existir do lado de lá. Casar o texto exato é suficiente:
 * duas mensagens idênticas em sequência derrubam a primeira pendência e a
 * segunda continua esperando a sua, que é o comportamento certo.
 */
export function reconciliaPendentes(slug: string, textosReais: readonly string[]): void {
  const atual = porAgente.get(slug);
  if (!atual || atual.length === 0) return;

  const disponiveis = new Map<string, number>();
  for (const t of textosReais) {
    const chave = t.trim();
    disponiveis.set(chave, (disponiveis.get(chave) ?? 0) + 1);
  }

  const agora = Date.now();
  const sobrando = atual.filter((p) => {
    const restam = disponiveis.get(p.texto) ?? 0;
    if (restam > 0) {
      disponiveis.set(p.texto, restam - 1);
      return false;
    }
    return agora - p.emMs < PRAZO_MS;
  });

  // Mesmo array quando nada saiu: sem isto, todo poll de 3 s notificaria os
  // assinantes e o feed remontaria à toa.
  if (sobrando.length === atual.length) return;
  grava(slug, sobrando);
}

/** Só para teste. */
export function limpaEcoPendente(): void {
  porAgente.clear();
  ouvintes.clear();
}
