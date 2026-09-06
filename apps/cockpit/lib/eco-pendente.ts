'use client';

/**
 * O QUE O RICA ACABOU DE MANDAR, antes de o eco voltar do servidor.
 *
 * A bolha nasce no GESTO: medido no `:3008` em 15/08, com o agente ocioso,
 * passam **18,9 s** entre o Enter e a bolha real chegando pelo stream, contra
 * 0,1 s do campo esvaziando. Dezoito segundos de tela muda são o *"eu mando
 * texto, ela não mostra que recebeu"* que o Rica reporta desde sempre. O feed
 * pinta o texto na hora e o eco depois o substitui pelo real.
 *
 * POR QUE UM STORE DE MÓDULO e não uma prop: o `Composer` e o `FeedDaConversa`
 * são irmãos em `app/agente/[slug]/page.tsx`, que é território do Daniel. Um
 * canal externo liga os dois sem tocar na página.
 *
 * IDENTIDADE DE OBJETO É REQUISITO, não estilo: quem lê é `useSyncExternalStore`,
 * e a doc do React diz nos Caveats para devolver *"a cached last snapshot"*
 * quando nada mudou — devolver array novo a cada leitura dá laço infinito.
 */

export type EcoPendente = {
  /** Chave estável da bolha otimista; não colide com as do rollout. */
  id: string;
  texto: string;
  /** Conteúdo que a bolha desenha quando difere do texto usado para casar o
   *  rollout. A imagem usa o envelope visual; a reconciliação usa a legenda. */
  conteudo?: string;
  emMs: number;
  /** Quanto esta pendência pode viver — ver `PRAZO_CC_MS`. */
  prazoMs: number;
};

export type MensagemReal = {
  texto: string;
  criadoEmMs: number;
};

/**
 * Teto de vida da bolha otimista.
 *
 * A pendência segura o prazo do alarme (`usa-envio.ts:297`), então o teto dela é
 * na prática o tempo que o Rica fica com a mensagem na tela sem ninguém dizer
 * se ela entrou. Passou disso, o envio não chegou, e manter a bolha diria que
 * chegou; quem avisa da falha é o composer, com a máquina de seis fases.
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
  prazoMs: number = PRAZO_CC_MS,
  conteudo?: string,
): string | null {
  const corpo = texto.trim();
  if (!corpo) return null;
  contador += 1;
  const id = `eco-${contador}`;
  const atual = porAgente.get(slug) ?? [];
  grava(slug, [...atual, { id, texto: corpo, emMs: Date.now(), prazoMs, ...(conteudo ? { conteudo } : {}) }]);
  return id;
}

/**
 * Desfaz uma pendência ANTES da entrega — o POST provou que não saiu daqui
 * (erro HTTP real, fase `falhou` em `envio.ts`). Sem isto a bolha otimista
 * fica pintando "enviado" no feed até o prazo estourar enquanto a faixa do
 * composer já diz que falhou — duas vozes contraditórias na mesma tela
 * (achado [2] da auditoria, 09/08).
 *
 * Por id, não por texto: um reenvio do mesmo texto cria uma segunda
 * pendência, e só a que falhou pode sair — a outra continua esperando o eco
 * normalmente.
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
 * Some com o que já chegou pelo eco, e com o que passou do prazo.
 *
 * A bolha otimista não tem o id que o servidor criará, então a reconciliação
 * usa texto + ordem temporal. Só mensagens reais posteriores ao gesto
 * participam: sem essa fronteira, uma legenda repetida encontra a ocorrência
 * antiga no histórico e a prévia nova some até o próximo eco.
 */
export function reconciliaPendentes(slug: string, mensagensReais: readonly MensagemReal[]): void {
  const atual = porAgente.get(slug);
  if (!atual || atual.length === 0) return;

  const disponiveis = new Map<string, number[]>();
  for (const mensagem of mensagensReais) {
    const chave = mensagem.texto.trim();
    const tempos = disponiveis.get(chave) ?? [];
    tempos.push(mensagem.criadoEmMs);
    disponiveis.set(chave, tempos);
  }
  for (const tempos of disponiveis.values()) tempos.sort((a, b) => a - b);

  const agora = Date.now();
  const entregues: string[] = [];
  const cursores = new Map<string, number>();
  const sobrando = atual.filter((p) => {
    const tempos = disponiveis.get(p.texto) ?? [];
    let cursor = cursores.get(p.texto) ?? 0;
    while (cursor < tempos.length && tempos[cursor]! < p.emMs) cursor += 1;
    if (cursor < tempos.length) {
      cursores.set(p.texto, cursor + 1);
      entregues.push(p.texto);
      return false;
    }
    return agora - p.emMs < p.prazoMs;
  });

  // Mesmo array quando nada saiu: sem isto, toda reconciliação notificaria os
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
 * Existe para quem prova a entrega FORA do `GET /messages/stream`: sem recibo,
 * o prazo expira e a mensagem termina em âmbar dizendo *"não consegui confirmar
 * se entrou — confira no chat antes de mandar de novo. Pode duplicar."*, que é
 * falso e do tipo que convida a duplicar de verdade.
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
