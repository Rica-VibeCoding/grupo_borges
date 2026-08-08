/**
 * O ESTADO DO CANAL DE ENTREGA — o que transforma "não sei" em "sei, e o botão
 * está aqui".
 *
 * A faixa de `nao-confirmado` diz a coisa mais honesta que a máquina de envio
 * consegue dizer sozinha: ela não observou o eco, então não afirma se entrou.
 * Mas o backend SABE mais que isso. Desde `aa8ce8f` o driver do tmux memoriza
 * cada recusa real de entrega e expõe o motivo em linguagem de operação no
 * `GET /api/agents/{slug}/painel`, campo `canal_entrega`.
 *
 * Quando esse campo diz `bloqueado`, a faixa deixa de ser uma dúvida e vira um
 * diagnóstico com ação: o texto NÃO entrou, o motivo é este, e o gesto que
 * resolve é destravar o agente. É a diferença entre o Rica reenviar às cegas —
 * e duplicar, que é o dano que a faixa existe para impedir — e ele destravar
 * uma vez e mandar com o canal aberto.
 *
 * ── Por que ler o painel em vez do POST ──────────────────────────────────
 *
 * O `POST /{slug}/file` devolve `canal_entrega` junto do `tmux_delivered`, mas
 * o `POST /{slug}/input` do TEXTO não devolve: quando o driver recusa, ele
 * levanta 409 e o corpo não carrega estado nenhum. Ler o `/painel` é o único
 * caminho que serve aos dois gestos, e a Tara o documentou como a fonte do
 * estado desde a última tentativa. Uma fonte, um caminho.
 *
 * ── Fronteira de sistema ─────────────────────────────────────────────────
 *
 * `leCanalBloqueado` valida o que chega da rede em vez de confiar no tipo — e
 * continua assim agora que o `canal_entrega` ENTROU no `AgentPainelResponse`
 * do `cockpit-core`. Tipo de TypeScript some na compilação: ele descreve o que
 * o back promete, nunca o que o socket entregou. Campo ausente numa API mais
 * velha, resposta truncada, proxy que devolve HTML de erro — tudo isso passa
 * pelo tipo e morre aqui, virando `null`, que é o caso normal.
 *
 * Módulo neutro: sem `'use client'`, sem React, sem DOM.
 */

/** Só o que a linha da faixa precisa. O `/painel` traz mais — `motivo` cru,
 *  `bloqueado_desde`, `acao_recomendada` em prosa — e nada disso cabe numa
 *  linha de 17px: o contador e a duração vão para o anúncio do leitor de tela,
 *  que é onde a versão completa mora por contrato do módulo de aparência. */
export type CanalBloqueado = {
  mensagem: string;
  recusasConsecutivas: number;
  bloqueadoHaSegundos: number;
};

function inteiroNaoNegativo(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
    ? Math.floor(valor)
    : 0;
}

/**
 * Devolve `null` em tudo que não for um bloqueio legível: canal entregando,
 * sem dados, campo ausente, resposta de formato inesperado.
 *
 * `null` não é falha a reportar — é o caso NORMAL, e é o que mantém a faixa na
 * frase genérica. Só um bloqueio de verdade, com mensagem de verdade, tem
 * direito de trocar o que está escrito na tela.
 */
export function leCanalBloqueado(painel: unknown): CanalBloqueado | null {
  if (typeof painel !== 'object' || painel === null) return null;
  const canal = (painel as { canal_entrega?: unknown }).canal_entrega;
  if (typeof canal !== 'object' || canal === null) return null;

  const janela = canal as {
    estado?: unknown;
    mensagem?: unknown;
    recusas_consecutivas?: unknown;
    bloqueado_ha_segundos?: unknown;
  };
  if (janela.estado !== 'bloqueado') return null;
  // Sem mensagem não há o que dizer de melhor que a frase genérica, e um
  // bloqueio mudo na tela seria pior que a dúvida honesta que ele substituiria.
  if (typeof janela.mensagem !== 'string' || janela.mensagem.trim() === '') return null;

  return {
    mensagem: janela.mensagem.trim(),
    recusasConsecutivas: inteiroNaoNegativo(janela.recusas_consecutivas),
    bloqueadoHaSegundos: inteiroNaoNegativo(janela.bloqueado_ha_segundos),
  };
}

/** O back escreve em prosa de operação, com maiúscula e ponto final; a faixa
 *  escreve em minúscula e sem ponto, porque a frase dela continua numa outra —
 *  a do botão. Emendar as duas sem isto dá "não entrou — O campo...". */
function emendavel(frase: string): string {
  const semPonto = frase.replace(/\.+$/, '');
  return semPonto.charAt(0).toLocaleLowerCase('pt-BR') + semPonto.slice(1);
}

/**
 * A frase diz, nesta ordem: (1) o que se sabe — e aqui, ao contrário da dúvida
 * genérica, se sabe que NÃO entrou; (2) por quê. O (3) "qual o custo de agir"
 * da frase genérica não é preciso: com o canal bloqueado não há risco de
 * duplicar, porque não há primeira cópia.
 */
export function frasePara(canal: CanalBloqueado): string {
  return `não entrou — ${emendavel(canal.mensagem)}`;
}

/** A versão completa, para quem ouve a tela. O contador e a duração entram
 *  aqui porque respondem "é uma teimosia ou é a primeira vez?", que muda a
 *  decisão de quem escuta e não cabe na linha visível. */
export function anuncioPara(canal: CanalBloqueado, nomeDoAgente: string): string {
  const partes = [`A mensagem não chegou a ${nomeDoAgente}. ${canal.mensagem}`];
  if (canal.recusasConsecutivas > 1) {
    partes.push(`${canal.recusasConsecutivas} tentativas seguidas foram recusadas.`);
  }
  if (canal.bloqueadoHaSegundos > 0) {
    partes.push(`O canal está bloqueado há ${canal.bloqueadoHaSegundos} segundos.`);
  }
  partes.push('Destrave o agente antes de mandar de novo.');
  return partes.join(' ');
}
