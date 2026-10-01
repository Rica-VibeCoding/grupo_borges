/**
 * A fila da fala do Rica, por agente — PURO (sem React, sem rede; o armazém entra de fora).
 *
 * Fala colada no pane com o turno do Zé em voo é absorvida pelo Claude Code e, em ~28% das
 * vezes, não vira turno (MURAL, 28/09). Então a fala dita com o Zé trabalhando NÃO é postada:
 * espera aqui e sai quando o turno fecha (`fecha` do `useTurnoDoZe` — o mesmo sinal da tela,
 * inclusive depois do Esc do toque). As que esperaram saem JUNTAS, na ordem, numa mensagem só:
 * uma por vez exigiria esperar o fim de cada turno entre elas, e cada fim é mais uma chance de
 * a fala cair no meio de outro turno. Junta, é uma entrega e um turno.
 *
 * Uma entrega em voo de cada vez. A fila vai ao `sessionStorage` ANTES de qualquer POST; o lote
 * que sai fica marcado `saindo`, e a recarga joga fora o marcado: o POST já saiu com resultado
 * incerto, e reenviar sozinho duplicaria. Parar ou trocar de sessão descarta tudo.
 */

export type Armazem = {
  le: (chave: string) => string | null;
  grava: (chave: string, valor: string) => void;
  apaga: (chave: string) => void;
};

type Item = { id: string; texto: string; saindo?: true };
export type Lote = { ids: string[]; texto: string };
export type ResultadoDaFala = { tipo: 'posta'; lote: Lote } | { tipo: 'esperou' };

/** Chave própria — a da retomada (`retomada-da-conversa.ts`) guarda outra coisa. */
export const chaveDaFila = (slug: string) => `ck-conversa-fila:${slug}`;

function carrega(bruto: string | null): Item[] {
  if (!bruto) return [];
  try {
    const g = JSON.parse(bruto) as { v?: unknown; itens?: unknown };
    if (g.v !== 1 || !Array.isArray(g.itens)) return [];
    const itens = g.itens as Partial<Item>[];
    if (!itens.every((i) => typeof i.id === 'string' && typeof i.texto === 'string')) return [];
    return (itens as Item[]).filter((i) => !i.saindo);
  } catch {
    return [];
  }
}

export function criaFilaDaFala(armazem: Armazem, chave: string, novoId: () => string = () => crypto.randomUUID()) {
  let itens = carrega(armazem.le(chave));
  let turno = false; // `abre` → `fecha` do turno do Zé
  const salva = () => (itens.length ? armazem.grava(chave, JSON.stringify({ v: 1, itens })) : armazem.apaga(chave));
  const emVoo = () => itens.some((i) => i.saindo);
  const ocupado = (rodando: boolean) => turno || rodando || emVoo();
  const sai = (): Lote | null => {
    const pendentes = itens.filter((i) => !i.saindo);
    if (pendentes.length === 0) return null;
    for (const i of pendentes) i.saindo = true;
    salva();
    return { ids: pendentes.map((i) => i.id), texto: pendentes.map((i) => i.texto).join(' ') };
  };
  const tira = (lote: Lote) => {
    itens = itens.filter((i) => !lote.ids.includes(i.id));
    salva();
  };
  return {
    /** Fala nova. `rodando`: o stream diz que o Zé está num turno (vale na recarga, antes do `abre`). */
    fala(texto: string, rodando: boolean): ResultadoDaFala {
      const livre = !ocupado(rodando);
      itens.push({ id: novoId(), texto });
      salva();
      const lote = livre ? sai() : null;
      return lote ? { tipo: 'posta', lote } : { tipo: 'esperou' };
    },
    abriu() {
      turno = true;
    },
    /** O turno fechou. Quem chama dá a vez ao `abre` do mesmo lote antes do `tenta`. */
    fechou() {
      turno = false;
    },
    /** Sai o que esperava, se o Zé estiver livre e nada estiver em voo. */
    tenta(rodando: boolean): Lote | null {
      return ocupado(rodando) ? null : sai();
    },
    entrou: tira,
    /** Falha definitiva: o erro aparece na tela e o lote sai da fila — não se repete sozinho. */
    falhou: tira,
    descarta() {
      itens = [];
      turno = false;
      salva();
    },
    pendentes: () => itens.filter((i) => !i.saindo).length,
  };
}
