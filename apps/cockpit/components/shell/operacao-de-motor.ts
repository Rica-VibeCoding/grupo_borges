/**
 * A OPERAÇÃO ÚNICA — escolher o motor e o cockpit aplicar sozinho (pedido do
 * Rica, 09/09: *"ele desliga, trava a tela pra ninguém mexer, mostra que está
 * trabalhando e religa sozinho"*).
 *
 * Por que ela existe: família, modelo e esforço das famílias persist-only só
 * valem no PRÓXIMO BOOT — sessão viva não troca de motor, porque o histórico
 * carrega thinking block assinado por modelo. Até aqui aplicar era Desligar +
 * Ligar na mão, dois toques depois da escolha, com a tela mostrando o estado
 * velho no meio do caminho.
 *
 * Estado GLOBAL por agente, no molde do `sincronizacao-painel.ts`, e não estado
 * de um componente: quem dispara a operação é a gaveta do painel (família) ou a
 * do composer (modelo/esforço), e a trava tem de valer nas duas — o agente é um
 * só. Sem React aqui dentro; a régua e os timers são testáveis com
 * `node --test`, e o componente fica com pixel.
 *
 * A rede é injetada pelo mesmo motivo: o teste exercita demora e falha sem
 * navegador.
 */
import { ESPERAS_APOS_LIGAR_MS, RECIBO_MS } from './acoes-rapidas.ts';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

export type FaseDaOperacao = 'ocioso' | 'confirmando' | 'aplicando' | 'concluido' | 'falhou';

export type EstadoDaOperacao = {
  fase: FaseDaOperacao;
  /** A frase de largura cheia que a tela mostra. Já pronta — o componente não
   *  decide palavra nenhuma. */
  aviso: string | null;
};

const OCIOSO: EstadoDaOperacao = { fase: 'ocioso', aviso: null };

/** O turno em voo morre com o desligamento: o `--continue` devolve a conversa,
 *  mas o raciocínio em andamento e a ferramenta rodando não voltam. Por isso a
 *  operação PARA e pergunta, em vez de assumir. */
export const TEXTO_CONFIRMA_TURNO =
  'O agente está no meio de um turno — aplicar agora encerra o que ele está fazendo. Tocar de novo confirma.';

export const TEXTO_APLICANDO = 'Aplicando — desligando e religando o agente. Leva uns 15 segundos.';

/** O único desfecho que deixa a máquina em estado pior do que começou: o
 *  desligamento passou e o boot não. Dizer "tente de novo" aqui esconderia que
 *  o agente está fora do ar AGORA. */
export const TEXTO_NO_CHAO =
  'Desliguei, mas o religar não passou — o agente está fora do ar. O botão Ligar sobe ele de volta.';

export const TEXTO_FALHOU = 'Não consegui aplicar a troca — tente de novo.';

type Erro = { status?: number; detail?: string };

/** 409 `agent_busy_confirm_required` — o mesmo contrato que o `POST /model` já
 *  usa. Só ele arma a confirmação; qualquer outro 409 é falha de verdade. */
export function pedeConfirmacaoDeTurno(erro: unknown): boolean {
  const e = erro as Erro | null;
  return e?.status === 409 && e?.detail === 'agent_busy_confirm_required';
}

export function traduzFalha(erro: unknown): string {
  const detail = (erro as Erro | null)?.detail ?? '';
  return detail.startsWith('religar_falhou_agente_desligado') ? TEXTO_NO_CHAO : TEXTO_FALHOU;
}

/** A operação terminou de verdade? O agente voltou E a escolha está em vigor.
 *
 *  `session_may_diverge === false` é a régua certa porque é ela que o back
 *  responde à pergunta concreta "a sessão viva já assumiu a família escolhida?".
 *  `!== false` (e não `=== true`) do lado do aviso existe por causa de API
 *  antiga; aqui é o contrário — só o `false` explícito solta a trava. */
export function convergiu(painel: AgentPainelResponse): boolean {
  return painel.vida.processo === true && painel.motor?.session_may_diverge === false;
}

/**
 * O piso da trava. `[MEDIDO 09/09]` O POST volta em **1,6s** — ele dispara o
 * boot e não espera o fim dele —, e a sessão nova só está pronta **14s** depois
 * (unit `cockpit-ligar-canario` 21:47:32 → 21:47:46).
 *
 * Sem este piso a trava sairia na primeira releitura, aos 3s: o painel de um
 * agente que troca só de MODELO dentro da mesma família já vem convergido
 * ANTES do religamento, então `convergiu()` diria "pronto" sobre a sessão
 * velha, ainda morrendo. A tela mostraria o agente de volta com ele no chão.
 */
export const ESPERA_MINIMA_DO_BOOT_MS = 12_000;

type Rede = {
  /** O POST da operação única. Ele DISPARA o desligar e o ligar e responde
   *  logo — o boot continua correndo depois da resposta. */
  aplicar: (force: boolean) => Promise<unknown>;
  /** Releitura do painel — é ela que troca a tela sem F5. */
  reler: () => void;
};

type Sessao = {
  estado: EstadoDaOperacao;
  timers: ReturnType<typeof setTimeout>[];
  /** Quando o POST voltou — o relógio do piso acima. */
  disparadaEm: number;
};

const sessoes = new Map<string, Sessao>();
const ouvintes = new Map<string, Set<(estado: EstadoDaOperacao) => void>>();

function sessaoDe(slug: string): Sessao {
  const atual = sessoes.get(slug);
  if (atual) return atual;
  const nova: Sessao = { estado: OCIOSO, timers: [], disparadaEm: 0 };
  sessoes.set(slug, nova);
  return nova;
}

function publicar(slug: string, estado: EstadoDaOperacao): void {
  sessaoDe(slug).estado = estado;
  ouvintes.get(slug)?.forEach((receber) => receber(estado));
}

function limparTimers(slug: string): void {
  const sessao = sessoes.get(slug);
  if (!sessao) return;
  sessao.timers.forEach(clearTimeout);
  sessao.timers = [];
}

export function leiaOperacao(slug: string): EstadoDaOperacao {
  return sessoes.get(slug)?.estado ?? OCIOSO;
}

export function assinarOperacao(
  slug: string,
  receber: (estado: EstadoDaOperacao) => void,
): () => void {
  const inscritos = ouvintes.get(slug) ?? new Set<(estado: EstadoDaOperacao) => void>();
  inscritos.add(receber);
  ouvintes.set(slug, inscritos);
  return () => {
    inscritos.delete(receber);
    if (!inscritos.size) ouvintes.delete(slug);
  };
}

/** Desarma a confirmação sem disparar nada — a gaveta fechou, e pergunta na
 *  tela que saiu de vista é pergunta caducada. Não toca em operação em voo:
 *  fechar a gaveta não desfaz um agente que já está religando. */
export function esquecerConfirmacao(slug: string): void {
  if (leiaOperacao(slug).fase !== 'confirmando') return;
  publicar(slug, OCIOSO);
}

/**
 * Dispara a operação. Segundo toque com a confirmação armada manda `force`.
 *
 * Devolve `true` quando a operação foi disparada de fato — `false` quando o
 * toque só ARMOU a pergunta do turno em voo (ou quando já havia uma em voo).
 */
export async function aplicarMotor(slug: string, rede: Rede): Promise<boolean> {
  const anterior = leiaOperacao(slug);
  if (anterior.fase === 'aplicando') return false;

  const force = anterior.fase === 'confirmando';
  limparTimers(slug);
  publicar(slug, { fase: 'aplicando', aviso: TEXTO_APLICANDO });

  try {
    await rede.aplicar(force);
  } catch (erro) {
    if (!force && pedeConfirmacaoDeTurno(erro)) {
      publicar(slug, { fase: 'confirmando', aviso: TEXTO_CONFIRMA_TURNO });
      return false;
    }
    publicar(slug, { fase: 'falhou', aviso: traduzFalha(erro) });
    // A releitura vale MESMO na falha: o desligamento pode ter passado, e a
    // tela precisa mostrar o agente no chão em vez do estado de antes.
    rede.reler();
    return false;
  }

  // O boot continua correndo depois desta resposta. Estas leituras são o que
  // faz a gaveta convergir sem F5 — e a última é o TETO da trava: passou dela,
  // solta de qualquer jeito.
  const sessao = sessaoDe(slug);
  sessao.disparadaEm = Date.now();
  sessao.timers = ESPERAS_APOS_LIGAR_MS.map((ms, indice) =>
    setTimeout(() => {
      rede.reler();
      if (indice === ESPERAS_APOS_LIGAR_MS.length - 1) concluir(slug);
    }, ms),
  );
  rede.reler();
  return true;
}

function concluir(slug: string): void {
  if (leiaOperacao(slug).fase !== 'aplicando') return;
  limparTimers(slug);
  publicar(slug, { fase: 'concluido', aviso: null });
  const sessao = sessaoDe(slug);
  sessao.timers = [setTimeout(() => publicar(slug, OCIOSO), RECIBO_MS)];
}

/**
 * Cada painel lido passa por aqui. Convergiu antes do teto — o caso normal, com
 * o boot em 13 a 15 segundos — a trava sai na hora, em vez de o Rica olhar um
 * véu por 25 segundos com o agente já trabalhando.
 */
export function sinalizarPainel(painel: AgentPainelResponse): void {
  const sessao = sessoes.get(painel.slug);
  if (sessao?.estado.fase !== 'aplicando') return;
  // O piso vem ANTES da convergência de propósito: um painel que já era
  // convergido antes da troca responderia "sim" à pergunta errada.
  if (Date.now() - sessao.disparadaEm < ESPERA_MINIMA_DO_BOOT_MS) return;
  if (!convergiu(painel)) return;
  concluir(painel.slug);
}

/** Só para os testes: zera o estado global entre casos. */
export function esquecerTudo(): void {
  sessoes.forEach((_sessao, slug) => limparTimers(slug));
  sessoes.clear();
  ouvintes.clear();
}
