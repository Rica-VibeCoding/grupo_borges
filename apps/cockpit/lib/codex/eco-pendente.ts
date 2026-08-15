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
  /** Quanto esta pendência pode viver. Vem de quem registrou porque os dois
   *  motores medem diferente — ver `PRAZO_CODEX_MS` e `PRAZO_CC_MS`. */
  prazoMs: number;
};

/** Teto de vida da bolha otimista no Codex. O turno leva minutos, mas o ECO do
 *  texto do Rica é o começo do turno, não o fim — 12 s medidos, 3 min de folga.
 *  Passou disso, o envio não chegou, e manter a bolha diria que chegou. Quem
 *  avisa que a entrega falhou é o composer, que tem a máquina de seis fases. */
export const PRAZO_CODEX_MS = 180_000;

/**
 * Teto no Claude Code, e ele é MAIS CURTO de propósito.
 *
 * A pendência segura o prazo do alarme (`usa-envio.ts:297`), então o teto dela é
 * na prática o tempo que o Rica fica com a mensagem na tela sem ninguém dizer
 * se ela entrou. Herdar os 3 min do Codex trocaria um aviso falso aos 12 s por
 * silêncio de três minutos — e silêncio é a queixa original.
 *
 * 45 s são 2,4× o eco real medido em 15/08 (18,9 s), com a mesma folga
 * proporcional que os 12 s originais tinham sobre a amostra em que foram
 * calibrados. Passou disso, alguma coisa aconteceu, e é hora de falar.
 */
export const PRAZO_CC_MS = 45_000;

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

/** Chamado no instante do despacho, não na resposta do POST. Devolve o id da
 *  pendência criada — quem despacha guarda para descartá-la se o POST provar
 *  que não saiu (ver `descartaEcoPendente`). `null` quando o texto era só
 *  espaço: não há pendência para descartar depois. */
export function registraEcoPendente(
  slug: string,
  texto: string,
  prazoMs: number = PRAZO_CODEX_MS,
): string | null {
  const corpo = texto.trim();
  if (!corpo) return null;
  contador += 1;
  const id = `eco-${contador}`;
  const atual = porAgente.get(slug) ?? [];
  grava(slug, [...atual, { id, texto: corpo, emMs: Date.now(), prazoMs }]);
  return id;
}

/**
 * Desfaz uma pendência ANTES da entrega — o POST provou que não saiu daqui
 * (erro HTTP real, fase `falhou` em `envio.ts`). Sem isto a bolha otimista
 * fica pintando "enviado" no feed por até 3 min enquanto a faixa do composer
 * já diz que falhou — duas vozes contraditórias na mesma tela (achado [2] da
 * auditoria, 09/08).
 *
 * Por id, não por texto: um reenvio do mesmo texto cria uma segunda
 * pendência, e só a que falhou pode sair — a outra continua esperando o
 * rollout normalmente.
 */
export function descartaEcoPendente(slug: string, id: string): void {
  const atual = porAgente.get(slug);
  if (!atual) return;
  const sobrando = atual.filter((p) => p.id !== id);
  if (sobrando.length === atual.length) return;
  grava(slug, sobrando);
}

export function lePendentes(slug: string): readonly EcoPendente[] {
  return porAgente.get(slug) ?? VAZIO;
}

/** Há entrega por rollout em curso? Quem pergunta é o prazo do composer. */
export function temPendencia(slug: string): boolean {
  return (porAgente.get(slug)?.length ?? 0) > 0;
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
  const entregues: string[] = [];
  const sobrando = atual.filter((p) => {
    const restam = disponiveis.get(p.texto) ?? 0;
    if (restam > 0) {
      disponiveis.set(p.texto, restam - 1);
      entregues.push(p.texto);
      return false;
    }
    return agora - p.emMs < p.prazoMs;
  });

  // Mesmo array quando nada saiu: sem isto, todo poll de 3 s notificaria os
  // assinantes e o feed remontaria à toa.
  if (sobrando.length === atual.length) return;
  grava(slug, sobrando);
  for (const texto of entregues) {
    for (const fn of entregas.get(slug) ?? []) fn(texto);
  }
}

/**
 * O RECIBO DE ENTREGA, para a máquina de seis fases do composer.
 *
 * Ela espera o eco em `GET /messages/stream`, que para agente Codex responde
 * `total: 0` — o mesmo buraco que deixava o chat vazio. Sem eco, o prazo de
 * 12 s expira e TODA mensagem pra Tara terminava em âmbar dizendo *"não
 * consegui confirmar se entrou — confira no chat antes de mandar de novo. Pode
 * duplicar."*. Falso, e do tipo que convida a duplicar de verdade.
 *
 * O texto aparecer no rollout é prova melhor que o eco do stream: significa que
 * o `codex exec` leu a mensagem e abriu o turno. É esse o recibo que sai daqui.
 */
const entregas = new Map<string, Set<(texto: string) => void>>();

export function assinaEntrega(slug: string, fn: (texto: string) => void): () => void {
  let conjunto = entregas.get(slug);
  if (!conjunto) {
    conjunto = new Set();
    entregas.set(slug, conjunto);
  }
  conjunto.add(fn);
  return () => {
    conjunto.delete(fn);
    if (conjunto.size === 0) entregas.delete(slug);
  };
}

/** Só para teste. */
export function limpaEcoPendente(): void {
  porAgente.clear();
  ouvintes.clear();
  entregas.clear();
}
