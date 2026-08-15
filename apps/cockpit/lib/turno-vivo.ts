'use client';

/**
 * O AGENTE ESTÁ NO MEIO DE UM TURNO? — a resposta que o feed já tem e o
 * composer não tinha.
 *
 * O `■` nasceu lendo `lifecycle_status` da frota, e essa escolha está medida
 * como errada: em 15/08, no `:3008`, mandei uma mensagem para um agente Claude
 * Code OCIOSO e **o botão não apareceu na tela em 100 segundos** — o freio
 * simplesmente não existia durante todo o turno.
 *
 * Ressalva honesta sobre a CAUSA, porque errei a primeira apuração: eu tinha
 * concluído que o `lifecycle_status` não acendia, e a função que "provou" isso
 * lia `/api/fleet` como lista quando a rota devolve `{agents: [...]}` — o
 * `except` engolia o erro e devolvia `null` em toda amostra. Com o parser certo
 * ele acende. O campo não é morto; é alimentado por hook (`routers/hooks.py`) e
 * por vigia de JSONL, e chega no tempo do PAINEL, não no tempo do gesto. Para
 * uma leitura de card isso basta; para um botão que precisa existir no instante
 * em que a pessoa quer usá-lo, não.
 *
 * A fonte certa estava na mesma tela o tempo inteiro: o `isRunning` do stream,
 * que é o que acende o "Pensando há 7 s" da linha viva. Se a tela afirma que o
 * agente está pensando, o botão de parar TEM de estar lá — a alternativa é a
 * tela dizer duas coisas diferentes sobre o mesmo instante.
 *
 * POR QUE UM STORE DE MÓDULO e não uma prop: `Composer` e `FeedDaConversa` são
 * irmãos em `app/agente/[slug]/page.tsx`. Quem sabe do `isRunning` é o feed
 * (é ele que abre o SSE); quem precisa saber é o composer. Abrir uma segunda
 * conexão SSE só para ler um booleano seria pagar o stream duas vezes — o
 * mesmo raciocínio, e o mesmo padrão, de `lib/codex/eco-pendente.ts`.
 *
 * IDENTIDADE DE SNAPSHOT é requisito: quem lê é `useSyncExternalStore`, e a doc
 * do React exige devolver o mesmo valor enquanto nada muda. Aqui o valor é um
 * booleano primitivo, então isso sai de graça — mas a gravação só notifica
 * quando o valor MUDA, senão todo flush do stream acordaria o composer à toa.
 */

const porAgente = new Map<string, boolean>();
const ouvintes = new Map<string, Set<() => void>>();

/** Chamado pelo feed a cada mudança do `isRunning`. Só notifica na virada. */
export function publicaTurnoVivo(slug: string, vivo: boolean): void {
  if ((porAgente.get(slug) ?? false) === vivo) return;
  if (vivo) porAgente.set(slug, true);
  else porAgente.delete(slug);
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

export function leTurnoVivo(slug: string): boolean {
  return porAgente.get(slug) ?? false;
}

export function assinaTurnoVivo(slug: string, fn: () => void): () => void {
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

/** Só para teste. */
export function limpaTurnoVivo(): void {
  porAgente.clear();
  ouvintes.clear();
}
