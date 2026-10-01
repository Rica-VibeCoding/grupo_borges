/**
 * A régua do menu de conta para escolher com segurança: quanto falta para cada
 * janela voltar (como fração da janela) e qual conta tem mais folga agora.
 * Sem React e sem pixel, como `conta-tropa.ts`.
 *
 * O reset de cada conta vem do `/api/contas` (cabeçalho
 * `anthropic-ratelimit-unified-{5h,7d}-reset` da sonda); a ativa cai na cota do
 * painel se o back não mandou. Sem leitura, o traço — nunca um tempo inventado.
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

/** O reset absoluto do back no formato de janela do painel. */
export function janelaDoReset(
  resetsAt: number | null | undefined,
  agoraEmSegundos: number,
): PainelQuotaWindow | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return { resets_at: resetsAt, remaining_seconds: resetsAt - agoraEmSegundos };
}

/** Segundos até a janela voltar, ou null sem leitura (ou já voltou). */
export function restanteEmSegundos(janela: PainelQuotaWindow | null | undefined): number | null {
  return restanteDaJanela(janela);
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
/** Janela que volta em até isto já conta como vazia: o uso dela vai zerar. */
const VOLTA_LOGO_S = 15 * 60;

function usoEfetivo(pct: number, voltaEm: number | null | undefined): number {
  return typeof voltaEm === 'number' && voltaEm <= VOLTA_LOGO_S ? 0 : pct;
}

/**
 * A conta com mais folga, pesando as duas janelas por igual (soma do que
 * sobra em 5h e 7d), com a janela que volta em até 15 min contada como vazia.
 * Só entra quem tem as duas leituras e nenhuma janela no teto; com menos de
 * duas candidatas não há escolha a recomendar. Empate não recomenda ninguém —
 * marca que não decide nada é ruído.
 */
export function chaveRecomendada(
  contas: {
    chave: string;
    pct5h: number | null;
    pct7d: number | null;
    volta5hEm?: number | null;
    volta7dEm?: number | null;
  }[],
): string | null {
  const candidatas = contas
    .filter((conta) => conta.pct5h !== null && conta.pct7d !== null)
    .map((conta) => ({
      chave: conta.chave,
      uso5h: usoEfetivo(conta.pct5h as number, conta.volta5hEm),
      uso7d: usoEfetivo(conta.pct7d as number, conta.volta7dEm),
    }))
    .filter((conta) => conta.uso5h < TETO_PARA_RECOMENDAR && conta.uso7d < TETO_PARA_RECOMENDAR)
    .map((conta) => ({ chave: conta.chave, folga: 200 - conta.uso5h - conta.uso7d }))
    .sort((a, b) => b.folga - a.folga);
  if (candidatas.length < 2 || candidatas[0].folga === candidatas[1].folga) return null;
  return candidatas[0].chave;
}

/** "woodpromais@gmail.com" → "woodpromais". Nome que não é email fica. */
export function nomeCurto(nome: string): string {
  return nome.includes('@') ? nome.split('@')[0] || nome : nome;
}
