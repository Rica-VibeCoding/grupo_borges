/**
 * A FOTO (OU O VÍDEO) QUE O RICA ACABOU DE MANDAR, antes do eco voltar.
 *
 * Irmã de `eco-pendente.ts`, e separada dele de propósito: a pendência de
 * texto segura o alarme de entrega da máquina de seis fases (`temPendencia`),
 * e o anexo não passa por aquela máquina — tem a própria em `usa-anexo.ts`.
 * Misturar as duas listas faria um vídeo subindo segurar o prazo de um texto.
 *
 * O ciclo tem três tempos, e cada um existe por uma consequência na tela:
 *
 * - `registra` no GESTO, com o arquivo LOCAL (objectURL). A bolha nasce na hora
 *   e é o destino do voo da miniatura (`voo-do-envio.ts`).
 * - `confirma` quando o `POST /file` volta: grava o nome com que o servidor
 *   salvou o arquivo, que é a única coisa que o envelope do feed carrega em
 *   comum com o gesto. A bolha deixa de dizer "enviando…".
 * - `reconcilia` quando uma mensagem do Rica no feed CITA esse nome — a bolha
 *   real chegou e a otimista sai. No erro do upload quem tira é `descarta`, e o
 *   arquivo volta para a miniatura do composer como sempre voltou.
 *
 * O nome que casa é o do CAMINHO (`path`), não o `filename` da resposta: o
 * `/file` devolve em `filename` o nome ORIGINAL (`IMG_0001.png`), e o envelope
 * cita o nome gravado (`<ms>-<uuid>.png`). Casar pelo original nunca bateria.
 *
 * Módulo neutro: sem React e sem DOM além do `URL.revokeObjectURL`.
 */

import type { MensagemReal } from './eco-pendente.ts';

export type EspecieVisual = 'image' | 'video';

export type AnexoPendente = {
  /** `anexo-N` — a bolha vira `cc-otimista-anexo-N`, o nome que o voo procura. */
  id: string;
  /** objectURL do arquivo local; revogado quando a pendência sai. */
  url: string;
  especie: EspecieVisual;
  legenda: string;
  /** Nome que o Rica escolheu, para quando não houver legenda. */
  nome: string;
  emMs: number;
  /** Nome gravado no servidor; `null` enquanto o upload não voltou. */
  arquivoServidor: string | null;
  confirmadoEmMs: number | null;
};

/**
 * Quanto a bolha confirmada espera o eco. Conta da CONFIRMAÇÃO, não do gesto:
 * um vídeo de 50 MB pode levar um minuto subindo, e esse tempo não é atraso do
 * eco. Mesmos 45 s do texto (`PRAZO_CC_MS`), pela mesma medida de 15/08.
 */
export const PRAZO_ANEXO_MS = 45_000;

const porAgente = new Map<string, readonly AnexoPendente[]>();
const ouvintes = new Map<string, Set<() => void>>();
const VAZIO: readonly AnexoPendente[] = Object.freeze([]);
let contador = 0;

let revoga: (url: string) => void = (url) => {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
};

function grava(slug: string, lista: readonly AnexoPendente[]): void {
  if (lista.length === 0) porAgente.delete(slug);
  else porAgente.set(slug, lista);
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

export function registraAnexoPendente(
  slug: string,
  dados: { url: string; especie: EspecieVisual; legenda: string; nome: string },
): string {
  contador += 1;
  const id = `anexo-${contador}`;
  const novo: AnexoPendente = {
    id,
    url: dados.url,
    especie: dados.especie,
    legenda: dados.legenda.trim(),
    nome: dados.nome,
    emMs: Date.now(),
    arquivoServidor: null,
    confirmadoEmMs: null,
  };
  grava(slug, [...(porAgente.get(slug) ?? []), novo]);
  return id;
}

/** Último segmento do caminho, nas duas barras. */
function nomeDoCaminho(caminho: string): string {
  return caminho.split(/[\\/]/).pop() ?? '';
}

/** O upload voltou 200: a bolha para de dizer "enviando…" e passa a esperar o
 *  eco que cite `path`. Objeto NOVO para esta pendência — quem lê é
 *  `useSyncExternalStore`, e mutar no lugar não re-renderizaria a bolha. */
export function confirmaAnexoPendente(
  slug: string,
  id: string,
  resposta: { path: string; filename: string },
): void {
  const atual = porAgente.get(slug);
  if (!atual) return;
  const arquivo = nomeDoCaminho(resposta.path) || resposta.filename;
  let mudou = false;
  const proxima = atual.map((p) => {
    if (p.id !== id) return p;
    mudou = true;
    return { ...p, arquivoServidor: arquivo, confirmadoEmMs: Date.now() };
  });
  if (mudou) grava(slug, proxima);
}

/** O upload terminou sem prova de entrega e sem resposta que traga o nome
 *  gravado (rede caindo depois do upload). A bolha para de dizer "enviando…" e
 *  fica até o prazo — como a do texto no `nao-confirmado`. Quando a resposta
 *  veio (`tmux_delivered: false`), quem chama é `confirmaAnexoPendente`, e aí o
 *  eco ainda pode tirá-la antes. */
export function naoConfirmaAnexoPendente(slug: string, id: string): void {
  const atual = porAgente.get(slug);
  if (!atual) return;
  let mudou = false;
  const proxima = atual.map((p) => {
    if (p.id !== id || p.confirmadoEmMs !== null) return p;
    mudou = true;
    return { ...p, confirmadoEmMs: Date.now() };
  });
  if (mudou) grava(slug, proxima);
}

/**
 * A legenda que volta ao campo quando o upload falha. O que o Rica escreveu
 * DEPOIS do gesto fica embaixo, como no `editarDaFila`: antes a legenda só
 * voltava com o campo vazio, e com texto novo ela evaporava.
 */
export function devolveLegenda(legenda: string, atual: string): string {
  if (!legenda.trim()) return atual;
  if (!atual.trim() || atual.trim() === legenda.trim()) return legenda;
  return `${legenda}\n${atual}`;
}

/** O upload falhou: a bolha sai e o arquivo volta para a mão do Rica. */
export function descartaAnexoPendente(slug: string, id: string): void {
  const atual = porAgente.get(slug);
  if (!atual) return;
  const saindo = atual.find((p) => p.id === id);
  if (!saindo) return;
  grava(slug, atual.filter((p) => p !== saindo));
  revoga(saindo.url);
}

/**
 * Tira a bolha cujo arquivo já apareceu no feed, e a confirmada que passou do
 * prazo. A que ainda não teve desfecho NÃO vence: ela é o upload em voo, e quem
 * a tira é o desfecho dele (`confirma`, `naoConfirma` ou `descarta`).
 *
 * Por inclusão do nome, não por igualdade de texto: o envelope traz caminho
 * absoluto e legenda, e no CC chega picado em duas mensagens — a metade
 * `[Image: source: …]` é a que tem o nome, e basta ela.
 */
export function reconciliaAnexosPendentes(
  slug: string,
  mensagensReais: readonly MensagemReal[],
  agoraMs: number = Date.now(),
): void {
  const atual = porAgente.get(slug);
  if (!atual || atual.length === 0) return;
  const saindo: AnexoPendente[] = [];
  const sobrando = atual.filter((p) => {
    if (p.confirmadoEmMs === null) return true;
    const nome = p.arquivoServidor;
    // Sem nome gravado (não confirmado sem resposta) não há o que casar: só o
    // prazo tira.
    const chegou = nome !== null && mensagensReais.some((m) => m.texto.includes(nome));
    if (chegou || agoraMs - p.confirmadoEmMs >= PRAZO_ANEXO_MS) {
      saindo.push(p);
      return false;
    }
    return true;
  });
  if (saindo.length === 0) return;
  grava(slug, sobrando);
  for (const p of saindo) revoga(p.url);
}

export function leAnexosPendentes(slug: string): readonly AnexoPendente[] {
  return porAgente.get(slug) ?? VAZIO;
}

export function leAnexoPendente(slug: string, id: string): AnexoPendente | null {
  return porAgente.get(slug)?.find((p) => p.id === id) ?? null;
}

export function assinaAnexosPendentes(slug: string, fn: () => void): () => void {
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

/** Só para teste: zera o store e troca a revogação por um espião. */
export function limpaAnexosPendentes(espiao?: (url: string) => void): void {
  porAgente.clear();
  ouvintes.clear();
  revoga = espiao ?? ((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
}
