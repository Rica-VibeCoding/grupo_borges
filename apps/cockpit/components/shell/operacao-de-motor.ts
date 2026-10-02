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
import {
  OCIOSO, TEXTO_CONFIRMA_TURNO, TEXTO_GUARDANDO, faltaEscolher, painelQueJaViu,
  pedeConfirmacaoDeTurno, textoDesligando, textoFalta, textoSubindo, traduzFalha, convergiu,
  ESPERA_MINIMA_DO_BOOT_MS,
  type EscolhaPendente, type EstadoDaOperacao, type PainelDoMotor, type Rede,
} from './regua-da-operacao-de-motor.ts';

// Os textos e a régua pura moram em `regua-da-operacao-de-motor.ts`; daqui saem
// reexportados, porque é deste arquivo que a tela e os testes importam.
export {
  ESPERA_MINIMA_DO_BOOT_MS, TEXTO_CONFIRMA_TURNO, TEXTO_FALHOU, TEXTO_NO_CHAO,
  convergiu, faltaEscolher, textoDesligando, textoFalta, textoSubindo,
} from './regua-da-operacao-de-motor.ts';
export type { EstadoDaOperacao, PainelDoMotor } from './regua-da-operacao-de-motor.ts';

type Sessao = {
  estado: EstadoDaOperacao;
  /** A escolha gravada que ainda espera o pacote fechar — é por ela existir
   *  que trocar motor, modelo e esforço custa um religar só. */
  pendente: EscolhaPendente | null;
  timers: ReturnType<typeof setTimeout>[];
  /** Quando o POST voltou — o relógio do piso (`ESPERA_MINIMA_DO_BOOT_MS`). */
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
  escolha: {
    rede: Rede;
    nome?: string;
    /** Reconhece o painel que já viu esta escolha — ver `pendente.confere`. */
    confere?: (painel: PainelDoMotor) => boolean;
  },
): Promise<void> {
  const fase = leiaOperacao(slug).fase;
  if (fase === 'aplicando' || fase === 'confirmando') return;

  sessaoDe(slug).pendente = {
    rede: escolha.rede, nome: escolha.nome, confere: escolha.confere,
  };
  publicar(slug, { fase: 'agrupando', aviso: TEXTO_GUARDANDO });
  await fecharSePronto(slug);
}

/**
 * O TOQUE DELE fecha o pacote — releitura nenhuma religa.
 *
 * Lê o painel na hora, de propósito, e é esta a diferença que fez o desenho
 * fechar: o painel de um componente pode estar velho em OUTRO campo (a gaveta do
 * composer não sabe que o motor mudou, se a do painel estava fechada), e o painel
 * que chega por publicação pode ser de antes da gravação. Leitura na hora da
 * decisão é posterior à gravação por construção — o POST já voltou.
 *
 * A leitura também OSCILA se chega no meio de um boot: enquanto a statusline nova
 * não existe, `_build_claude_painel_effort` devolve o esforço do `settings.json`
 * global onde havia branco. Por isso quem decide é só o toque dele, nunca uma
 * releitura de fundo — três leituras do mesmo painel davam respostas diferentes
 * (medido em 10/09, na prova de navegador).
 */
export async function fecharSePronto(
  slug: string,
  /** Reconhece o painel que já viu a escolha DESTE toque, quando ela é outra que
   *  não a da pendência (o esforço fechando o pacote de uma troca de motor). */
  tambem?: (painel: PainelDoMotor) => boolean,
): Promise<void> {
  const sessao = sessoes.get(slug);
  const pendente = sessao?.pendente;
  if (!pendente || sessao?.estado.fase !== 'agrupando') return;

  const painel = await painelQueJaViu(pendente, tambem);
  // Sem um painel que já veja a escolha, não se religa: ela fica guardada e o
  // próximo toque dele resolve. Religar no escuro é o que ele recusou duas vezes.
  if (!painel) return;
  if (sessaoDe(slug).pendente !== pendente) return;

  const falta = faltaEscolher(painel);
  if (falta.length) {
    publicar(slug, { fase: 'agrupando', aviso: textoFalta(falta) });
    return;
  }
  sessao.pendente = null;
  await aplicarMotor(slug, pendente.rede, pendente.nome);
}

/** Painel lido: só conta o que ainda falta. Nunca religa — quem religa é o toque
 *  dele, em `fecharSePronto`. */
export function revisarFaltas(slug: string, painel: PainelDoMotor): void {
  const sessao = sessoes.get(slug);
  if (!sessao?.pendente || sessao.estado.fase !== 'agrupando') return;
  const falta = faltaEscolher(painel);
  publicar(slug, {
    fase: 'agrupando',
    aviso: falta.length ? textoFalta(falta) : TEXTO_GUARDANDO,
  });
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
    revisarFaltas(painel.slug, painel);
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