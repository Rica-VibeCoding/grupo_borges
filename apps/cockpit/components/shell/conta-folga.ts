/**
 * A régua do menu de conta para escolher com segurança: quanto falta para cada
 * janela voltar (como fração da janela) e qual conta tem mais folga agora.
 * Sem React e sem pixel, como `conta-tropa.ts`.
 *
 * O reset só existe para a conta ATIVA: vem da cota que o agente lê no
 * statusline (`PainelQuotas`). O `/api/contas` devolve só o percentual das
 * outras — conta sem reset mostra o traço, nunca um tempo inventado.
 */
import type { PainelQuotaWindow } from '@grupo_borges/cockpit-core/cockpit-types';

export type TempoDaJanela = {
  /** "2h/5h" ou "3/7 d" — faltam 2 de 5 horas, 3 de 7 dias. */
  fracao: string;
  /** "volta 04:40" — só na de 5h, quando o back mandou o instante. */
  volta: string | null;
  /** Para o leitor de tela: "faltam 2 de 5 horas para voltar". */
  falado: string;
};

const HORA = 3_600;
const DIA = 86_400;

function restanteDaJanela(janela: PainelQuotaWindow | null | undefined): number | null {
  const restante = janela?.remaining_seconds;
  if (typeof restante !== 'number' || !Number.isFinite(restante) || restante <= 0) return null;
  return restante;
}

/** Horário local do reset, "04:40". */
export function horarioDoReset(resetsAt: number | null | undefined): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return new Date(resetsAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Janela de 5h: horas que faltam, arredondadas para cima (1h37 → "2h/5h"). */
export function tempoDa5h(janela: PainelQuotaWindow | null | undefined): TempoDaJanela | null {
  const restante = restanteDaJanela(janela);
  if (restante === null) return null;
  const horas = Math.min(5, Math.max(1, Math.ceil(restante / HORA)));
  const hora = horarioDoReset(janela?.resets_at);
  return {
    fracao: `${horas}h/5h`,
    volta: hora ? `volta ${hora}` : null,
    falado: `faltam ${horas} de 5 horas para voltar${hora ? `, às ${hora}` : ''}`,
  };
}

/** Janela de 7d: dias que faltam, arredondados para cima (5d14h → "6/7 d"). */
export function tempoDa7d(janela: PainelQuotaWindow | null | undefined): TempoDaJanela | null {
  const restante = restanteDaJanela(janela);
  if (restante === null) return null;
  const dias = Math.min(7, Math.max(1, Math.ceil(restante / DIA)));
  return {
    fracao: `${dias}/7 d`,
    volta: null,
    falado: `faltam ${dias} de 7 dias para voltar`,
  };
}

/** Acima disto a janela está praticamente fechada: não se recomenda. */
const TETO_PARA_RECOMENDAR = 95;

/**
 * A conta com mais folga, pesando as duas janelas por igual (média do que
 * sobra em 5h e 7d). Só entra quem tem as duas leituras e nenhuma janela no
 * teto; com menos de duas candidatas não há escolha a recomendar. Empate não
 * recomenda ninguém — marca que não decide nada é ruído.
 */
export function chaveRecomendada(
  contas: { chave: string; pct5h: number | null; pct7d: number | null }[],
): string | null {
  const candidatas = contas
    .filter((conta) => conta.pct5h !== null && conta.pct7d !== null)
    .filter((conta) => (conta.pct5h as number) < TETO_PARA_RECOMENDAR && (conta.pct7d as number) < TETO_PARA_RECOMENDAR)
    .map((conta) => ({ chave: conta.chave, folga: 200 - (conta.pct5h as number) - (conta.pct7d as number) }))
    .sort((a, b) => b.folga - a.folga);
  if (candidatas.length < 2 || candidatas[0].folga === candidatas[1].folga) return null;
  return candidatas[0].chave;
}

/** "woodpromais@gmail.com" → "woodpromais". Nome que não é email fica. */
export function nomeCurto(nome: string): string {
  return nome.includes('@') ? nome.split('@')[0] || nome : nome;
}
