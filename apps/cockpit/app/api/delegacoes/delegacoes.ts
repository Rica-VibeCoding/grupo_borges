// As marcas de delegação, parte pura — QUEM está trabalhando a pedido de quem.
//
// Mora fora do `route.ts` pela mesma razão de `linha-viva.ts`: o `node --test`
// prova a régua sem subir o Next. A fonte é o diretório `/tmp/cc-deleg/` (ou
// `DELEG_DIR`, em teste), um `<pid>.json` por delegação em curso, escrito pelo
// wrapper do executor e apagado por `trap EXIT` quando ele sai.
//
// DUAS RÉGUAS DE DESCARTE, as duas de propósito silenciosas:
//
// - **PID morto**: se o processo morreu de um jeito que pula o trap (kill -9,
//   queda da máquina), a marca fica órfã no disco. Quem lê é quem limpa — o
//   teste é `process.kill(pid, 0)`, que não mata nada, só pergunta se existe.
// - **Sem dono conhecido**: `delegador` e `alvo` são campos NOVOS — marcas de
//   antes da mudança e wrappers de terceiros podem não preencher. Ausente ou
//   vazio é "delegação sem dono", e delegação sem dono não aparece em chat
//   nenhum. Nunca se chuta o dono.
//
// Nada aqui lança: marca corrompida, arquivo que some entre o `readdir` e o
// `readFile`, diretório inexistente — tudo vira lista menor, nunca 500.

import { readdir, readFile } from 'node:fs/promises';

/** Onde os wrappers gravam. O nome da env é o MESMO que eles usam. */
export const DIR_PADRAO = '/tmp/cc-deleg';

/** Uma marca válida e viva. `inicio` é epoch em SEGUNDOS, cru — o decorrido é
 *  conta do cliente, com o relógio dele. */
export type Delegacao = {
  /** Rótulo pra exibir ("Tara", "Hiro K3"). */
  quem: string;
  /** Slug do agente que delegou — é por ele que o chat filtra. */
  delegador: string;
  /** Slug do executor na frota — destino do link do item. */
  alvo: string;
  inicio: number;
  pid: number;
};

function textoOuNull(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** Uma marca ou null. Os cinco campos são obrigatórios; qualquer ausência,
 *  tipo errado ou JSON quebrado descarta a marca inteira — meia marca vira
 *  dono chutado, e dono chutado é pior que silêncio. */
export function parseMarca(texto: string): Delegacao | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof bruto !== 'object' || bruto === null) return null;
  const marca = bruto as Record<string, unknown>;

  const quem = textoOuNull(marca.quem);
  const delegador = textoOuNull(marca.delegador);
  const alvo = textoOuNull(marca.alvo);
  const inicio =
    typeof marca.inicio === 'number' && Number.isFinite(marca.inicio) ? marca.inicio : null;
  const pid =
    typeof marca.pid === 'number' && Number.isInteger(marca.pid) && marca.pid > 0
      ? marca.pid
      : null;

  if (!quem || !delegador || !alvo || inicio === null || pid === null) return null;
  return { quem, delegador, alvo, inicio, pid };
}

/** O processo existe? Sinal 0 não entrega sinal nenhum — é a pergunta do
 *  `kill(2)` sem o tiro. ESRCH (não existe) e EPERM (existe mas não é nosso)
 *  caem no mesmo catch: nas duas hipóteses a marca não é nossa pra exibir. */
export function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** As delegações vivas e com dono, mais antiga primeiro — a ordem de empilhar
 *  no pé do feed é a ordem de chegada. Diretório inexistente é lista vazia,
 *  não erro: na maior parte do tempo ninguém delegou nada. */
export async function leDelegacoes(dir: string): Promise<Delegacao[]> {
  let nomes: string[];
  try {
    nomes = await readdir(dir);
  } catch {
    return [];
  }

  const delegacoes: Delegacao[] = [];
  for (const nome of nomes) {
    if (!nome.endsWith('.json')) continue;
    let texto: string;
    try {
      texto = await readFile(`${dir}/${nome}`, 'utf8');
    } catch {
      // Sumiu entre o readdir e aqui — a delegação acabou no meio da leitura.
      continue;
    }
    const marca = parseMarca(texto);
    if (!marca) continue;
    if (!pidVivo(marca.pid)) continue;
    delegacoes.push(marca);
  }
  delegacoes.sort((a, b) => a.inicio - b.inicio);
  return delegacoes;
}
