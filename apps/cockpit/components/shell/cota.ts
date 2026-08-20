/**
 * A régua da cota usada — que número aparece, com que palavra, e quando o
 * painel diz "isto está velho". Sem React e sem pixel, como `acoes-rapidas.ts`.
 *
 * O back entrega `PainelQuotas` com quatro estados e duas janelas fixas (5h e
 * 7d) mais a mensal, que só existe em plano com teto de mês (o Canário, no
 * OpenCode Go). As janelas podem vir separadamente vazias: a Tara hoje devolve `five_hour: null`
 * com `seven_day` preenchido. Janela vazia não some — vira "sem leitura", senão
 * o painel mostraria uma cota só e ninguém saberia se a outra é zero ou é falta
 * de dado.
 *
 * **O `stale` mostra o número, não o esconde.** Cota velha marcada como velha é
 * informação; cota escondida é o buraco que esta tarefa fechou. O `resets_at` e
 * o `remaining_seconds` de uma leitura velha ficam como o back leu — descontar
 * a idade inventaria precisão que o dado não tem. Quem conta a idade é o aviso.
 */
import type {
  PainelContexto,
  PainelQuotaWindow,
  PainelQuotas,
} from '@grupo_borges/cockpit-core/cockpit-types';
import {
  clampPct,
  formatCompactNumber,
  formatElapsedShort,
  formatRemainingShort,
} from '@grupo_borges/cockpit-core/painel-format';

export type JanelaDeCota = {
  /** Rótulo visível, curto — a gaveta tem 380px. */
  rotulo: string;
  /** Inteiro 0–100, ou `null` quando a janela não foi lida. */
  pct: number | null;
  /** "reset em 4d 14h", "reset pendente" ou "sem leitura". */
  reset: string;
  /**
   * O que o leitor de tela fala no lugar de "71". A APG do `meter` pede
   * `aria-valuetext` quando o percentual sozinho não é compreensível — e aqui
   * ele não é: 71 sem "usada" pode ser lido como 71 restante.
   */
  valorFalado: string;
  /** Nome acessível da barra. `meter` é "name from author": sem isto o leitor
   *  anuncia um número sem dono. */
  nome: string;
};

export type LeituraDeCota =
  | { estado: 'sem-dado'; recado: string }
  | { estado: 'viva'; janelas: JanelaDeCota[]; aviso: null }
  | { estado: 'velha'; janelas: JanelaDeCota[]; aviso: string };

const JANELAS = [
  { rotulo: '5h', nome: 'Cota usada nas últimas 5 horas', campo: 'five_hour' },
  { rotulo: '7d', nome: 'Cota usada nos últimos 7 dias', campo: 'seven_day' },
] as const;

/**
 * A janela do mês entra só quando o back manda — plano Anthropic, Codex e Kimi
 * não têm teto mensal. Campo ausente não é "sem leitura": é uma janela que
 * aquele plano não tem, e desenhar a linha vazia inventaria um limite.
 */
const JANELA_MENSAL = { rotulo: 'mês', nome: 'Cota usada no mês', campo: 'monthly' } as const;

type MoldeDeJanela = (typeof JANELAS)[number] | typeof JANELA_MENSAL;

/**
 * De quem é a cota — "Wood Pro", "Ricardo". O `displayName` da conta é o rótulo
 * que o Rica reconhece; o email inteiro não cabe nos 380px da gaveta, então o
 * fallback é só o que vem antes do `@`.
 *
 * A conta é UMA por máquina, não por agente: o CC segue o `.credentials.json`
 * do disco em tempo real, e um `/login` troca todos os agentes vivos de uma vez.
 * Por isso o campo repete igual nos seis cards — e isso é a verdade, não bug.
 */
export function leiaConta(quotas: PainelQuotas | null | undefined): string | null {
  const conta = quotas?.conta;
  if (!conta) return null;
  if (typeof conta.display_name === 'string' && conta.display_name) return conta.display_name;
  if (typeof conta.email === 'string' && conta.email) return conta.email.split('@')[0] || null;
  return null;
}

export type RodapeDeCota = {
  /** Nome dado com `/rename`, ou `null` enquanto ninguém nomeou a sessão. */
  sessao: string | null;
  /**
   * `null` quando a janela ainda não foi contada. O Claude Code entrega
   * `current_usage` vazio antes da primeira resposta da API **e de novo depois
   * de um `/compact`** — daqui, zero de verdade e zero por falta de leitura são
   * indistinguíveis. Escrever "0 ↑ 0 ↓" numa sessão que acabou de compactar
   * afirma que não há nada em contexto, e isso é falso; o traço não afirma nada.
   */
  entrada: string | null;
  saida: string | null;
  /** Só `true` desenha a marca: `false` é "não cruzou", `null` é "não sei". */
  cruzou200k: boolean;
};

/**
 * A linha de baixo do card: nome da sessão e o tamanho do que está em contexto.
 *
 * `entrada` soma os três campos de entrada porque é assim que o Claude Code
 * define `total_input_tokens` — cache lido continua sendo entrada, e mostrar só
 * o `input` cru daria 2 tokens numa sessão com 54 mil dentro.
 */
export function leiaRodape(contexto: PainelContexto | null | undefined): RodapeDeCota | null {
  if (!contexto?.available) return null;
  const { input, output, cache_creation, cache_read } = contexto.tokens;
  const entrada = input + cache_creation + cache_read;
  const contou = entrada > 0 || output > 0;
  const sessao = contexto.session_name ?? null;
  // Rodapé sem nome e sem contagem não tem o que dizer — some em vez de virar
  // uma faixa vazia embaixo das barras.
  if (!contou && sessao === null) return null;
  return {
    sessao,
    entrada: contou ? formatCompactNumber(entrada) : null,
    saida: contou ? formatCompactNumber(output) : null,
    cruzou200k: contexto.exceeds_200k === true,
  };
}

function leiaJanela(
  janela: PainelQuotaWindow | null | undefined,
  molde: MoldeDeJanela,
): JanelaDeCota {
  const bruto = janela?.used_percentage;
  if (janela == null || typeof bruto !== 'number' || !Number.isFinite(bruto)) {
    return {
      rotulo: molde.rotulo,
      pct: null,
      reset: 'sem leitura',
      valorFalado: `${molde.nome}: sem leitura`,
      nome: molde.nome,
    };
  }

  // `Math.ceil` pra bater com o display do claude.ai — arredondar pra baixo
  // deixava o painel 1pp atrás do que o próprio CLI mostra (v1, 67 linhas).
  const pct = Math.ceil(clampPct(bruto));
  const restante = janela.remaining_seconds;
  const reset =
    typeof restante === 'number' && Number.isFinite(restante) && restante > 0
      ? `reset em ${formatRemainingShort(restante)}`
      : 'reset pendente';

  return {
    rotulo: molde.rotulo,
    pct,
    reset,
    valorFalado: `${pct}% usada, ${reset}`,
    nome: molde.nome,
  };
}

export function leiaCota(
  quotas: PainelQuotas | null | undefined,
  agoraEmSegundos: number = Date.now() / 1000,
): LeituraDeCota {
  if (!quotas || quotas.status === 'unknown' || quotas.status === 'missing') {
    // `missing` acontece de verdade em agente que ainda não reportou a linha de
    // status. Recado, nunca bloco vazio: sumir calado é o que fazia o Rica achar
    // que o painel tinha perdido o controle.
    return {
      estado: 'sem-dado',
      recado: 'Cota usada indisponível — o agente ainda não reportou',
    };
  }

  const moldes: readonly MoldeDeJanela[] = quotas.monthly ? [...JANELAS, JANELA_MENSAL] : JANELAS;
  const janelas = moldes.map((molde) => leiaJanela(quotas[molde.campo], molde));
  if (quotas.status !== 'stale') return { estado: 'viva', janelas, aviso: null };

  const lida = quotas.updated_at;
  const idade =
    typeof lida === 'number' && Number.isFinite(lida) ? formatElapsedShort(agoraEmSegundos - lida) : null;
  return {
    estado: 'velha',
    janelas,
    // A PALAVRA carrega o estado, não a cor (§3/§9.7) — e ela vem com a idade
    // junto, porque "antigo" sem número não diz se é de 6 minutos ou de um dia.
    aviso: idade ? `dados antigos · lida ${idade}` : 'dados antigos',
  };
}
