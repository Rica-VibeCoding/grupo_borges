/**
 * A régua da cota usada — que número aparece, com que palavra, e quando o
 * painel diz "isto está velho". Sem React e sem pixel, como `acoes-rapidas.ts`.
 *
 * O back entrega `PainelQuotas` com quatro estados e duas janelas (5h e 7d), e
 * as duas podem vir separadamente vazias: a Tara hoje devolve `five_hour: null`
 * com `seven_day` preenchido. Janela vazia não some — vira "sem leitura", senão
 * o painel mostraria uma cota só e ninguém saberia se a outra é zero ou é falta
 * de dado.
 *
 * **O `stale` mostra o número, não o esconde.** Cota velha marcada como velha é
 * informação; cota escondida é o buraco que esta tarefa fechou. O `resets_at` e
 * o `remaining_seconds` de uma leitura velha ficam como o back leu — descontar
 * a idade inventaria precisão que o dado não tem. Quem conta a idade é o aviso.
 */
import type { PainelQuotaWindow, PainelQuotas } from '@grupo_borges/cockpit-core/cockpit-types';
import { clampPct, formatElapsedShort, formatRemainingShort } from '@grupo_borges/cockpit-core/painel-format';

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

function leiaJanela(
  janela: PainelQuotaWindow | null | undefined,
  molde: (typeof JANELAS)[number],
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

  const janelas = JANELAS.map((molde) => leiaJanela(quotas[molde.campo], molde));
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
