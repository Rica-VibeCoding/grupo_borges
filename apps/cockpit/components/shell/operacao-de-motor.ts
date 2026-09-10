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

export type FaseDaOperacao =
  | 'ocioso'
  | 'agrupando'
  | 'confirmando'
  | 'aplicando'
  | 'concluido'
  | 'falhou';

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

/** O instante entre gravar a escolha e ler o painel que diz o que falta. A
 *  releitura vem em seguida; este texto existe para a linha não piscar vazia. */
export const TEXTO_GUARDANDO = 'Guardando a escolha…';

/** O que a tela diz enquanto o pacote não fechou. Curto e específico, porque é
 *  ele que explica por que o agente AINDA não religou — o Rica fotografou o
 *  aviso antigo de 62 caracteres em duas linhas e pediu o contrário (09/09). */
export function textoFalta(campos: readonly string[]): string {
  return `Falta escolher ${campos.join(' e ')}.`;
}

/**
 * OS CAMPOS DE MOTOR QUE A TELA AINDA MOSTRA EM BRANCO.
 *
 * Quem responde é o back, não a UI: `_build_painel_model` devolve `value: null`
 * quando o modelo gravado não pertence ao motor escolhido (`agents.py`), e o
 * esforço faz o mesmo quando a sessão viva é de outra família. Trocar o motor,
 * então, esvazia os dois — e é esse estado, não um gesto de tela, que diz se
 * ele terminou de escolher.
 *
 * `allowed` vazio não é campo em branco: a família OpenCode tem um modelo só, e
 * esperar escolha num controle que não existe travaria a operação para sempre.
 */
export function faltaEscolher(painel: PainelDoMotor): string[] {
  const falta: string[] = [];
  if (painel.model?.allowed.length && !painel.model.value) falta.push('o modelo');
  if (painel.effort?.allowed.length && !painel.effort.value) falta.push('o esforço');
  return falta;
}

/**
 * O aviso da trava, em DUAS etapas e com o nome de quem está religando.
 *
 * [09/09] Era uma frase só: "Aplicando — desligando e religando o agente. Leva
 * uns 15 segundos." O Rica fotografou ela ocupando duas linhas e pediu o
 * contrário do que ela fazia: mais curta, dizendo *quem* e *o que está
 * acontecendo agora*. Anunciar as duas etapas de uma vez é o que a fazia estar
 * sempre meio errada — no primeiro segundo o agente ainda nem tinha caído, e
 * nos últimos catorze ele já estava subindo.
 *
 * Sem nome não se inventa um: o painel é aberto por slug em lugares que não
 * carregam o nome, e "o agente" é verdade em todos eles.
 */
export const textoDesligando = (nome?: string) => `Desligando ${nome ?? 'o agente'}…`;

export const textoSubindo = (nome?: string) => `Subindo ${nome ?? 'o agente'} — uns 15s.`;

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

/** O pedaço do painel que a régua do pacote lê. */
export type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort'>;

type Rede = {
  /** O POST da operação única. Ele DISPARA o desligar e o ligar e responde
   *  logo — o boot continua correndo depois da resposta. */
  aplicar: (force: boolean) => Promise<unknown>;
  /** Releitura do painel — é ela que troca a tela sem F5. */
  reler: () => void;
};

type Sessao = {
  estado: EstadoDaOperacao;
  /** A escolha gravada que ainda espera o pacote fechar — é por ela existir
   *  que trocar motor, modelo e esforço custa um religar só. */
  pendente: { rede: Rede; nome?: string } | null;
  timers: ReturnType<typeof setTimeout>[];
  /** Quando o POST voltou — o relógio do piso acima. */
  disparadaEm: number;
};

const sessoes = new Map<string, Sessao>();
const ouvintes = new Map<string, Set<(estado: EstadoDaOperacao) => void>>();

function sessaoDe(slug: string): Sessao {
  const atual = sessoes.get(slug);
  if (atual) return atual;
  const nova: Sessao = { estado: OCIOSO, pendente: null, timers: [], disparadaEm: 0 };
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
export async function aplicarMotor(slug: string, rede: Rede, nome?: string): Promise<boolean> {
  const anterior = leiaOperacao(slug);
  if (anterior.fase === 'aplicando') return false;

  const force = anterior.fase === 'confirmando';
  sessaoDe(slug).pendente = null;
  limparTimers(slug);
  publicar(slug, { fase: 'aplicando', aviso: textoDesligando(nome) });

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
  // O POST volta quando o desligamento passou e o boot foi disparado — daqui
  // em diante o que está acontecendo é a subida, e o aviso conta isso.
  publicar(slug, { fase: 'aplicando', aviso: textoSubindo(nome) });

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

/**
 * A ESCOLHA ESPERA O PACOTE FECHAR (Rica, 10/09).
 *
 * Motor, modelo e esforço são escolhas para o MESMO boot, e uma reiniciada por
 * escolha custava três — medido na Tara, `cockpit-ligar-tara` às 23:13:04 e
 * 23:13:30. A escolha fica guardada aqui até não faltar campo nenhum.
 *
 * Duas tentativas anteriores erraram o gatilho, e as duas foram rejeitadas na
 * tela por ele. Um relógio de oito segundos: os segundos corriam enquanto ele
 * fechava o painel para abrir a gaveta do modelo, e o agente religava antes da
 * segunda escolha. Depois o fechamento da gaveta: *"na hora que eu clico em
 * escolher modelo, a gaveta fecha e ela já começa a entrar em modo de
 * desligamento"* — sair do menu do motor para ir ao modelo fechava uma gaveta, e
 * aquilo disparava o religar no meio da escolha.
 *
 * A régua que ele deu, por extenso, nunca foi sobre gesto de tela: *"ele está
 * esperando a escolha de um modelo e de uma força; só depois que os dois
 * estiverem escolhidos, imediatamente, ele entra no modo"*. Então quem decide é
 * `faltaEscolher()` — estado do painel, vindo do back. Vale para dois controles
 * e para cinco, não corre enquanto ele decide, e atravessa as duas gavetas
 * porque a pendência é do AGENTE.
 *
 * `painel` é opcional porque as duas portas sabem coisas diferentes no momento
 * da gravação: a gaveta do composer já tem o valor novo em mão e decide na hora
 * (é o "imediatamente"); a do motor só descobre o que ficou em branco na
 * releitura, e para ela quem decide é o `conferirPacote` seguinte.
 *
 * Não atropela uma pergunta de turno em voo: a escolha nova já está gravada, e
 * quem a pergunta espera é o toque dele. Nem um agente que já está religando.
 */
export async function registrarEscolha(
  slug: string,
  rede: Rede,
  nome?: string,
  painel?: PainelDoMotor,
): Promise<void> {
  const fase = leiaOperacao(slug).fase;
  if (fase === 'aplicando' || fase === 'confirmando') return;

  sessaoDe(slug).pendente = { rede, nome };
  publicar(slug, { fase: 'agrupando', aviso: TEXTO_GUARDANDO });
  if (painel) await conferirPacote(slug, painel);
}

/**
 * Cada painel lido passa por aqui: fechou o pacote, a escolha guardada aplica na
 * hora; ainda falta campo, a linha diz qual.
 *
 * Sem pendência não faz nada — painel chegando não pode religar um agente que
 * ninguém mandou trocar.
 */
export async function conferirPacote(slug: string, painel: PainelDoMotor): Promise<void> {
  const sessao = sessoes.get(slug);
  const pendente = sessao?.pendente;
  if (!pendente || sessao?.estado.fase !== 'agrupando') return;

  const falta = faltaEscolher(painel);
  if (falta.length) {
    publicar(slug, { fase: 'agrupando', aviso: textoFalta(falta) });
    return;
  }
  sessao.pendente = null;
  await aplicarMotor(slug, pendente.rede, pendente.nome);
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
  // Mesma leitura, duas perguntas: na fase `agrupando` ela diz se o pacote
  // fechou; na `aplicando`, se o agente já voltou.
  if (sessao?.estado.fase === 'agrupando') {
    void conferirPacote(painel.slug, painel);
    return;
  }
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
