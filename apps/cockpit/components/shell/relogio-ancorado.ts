// O relógio que anda sem acreditar no relógio do celular.
//
// A statusline conta duração de sessão contra `pane_session_started_at`, que é
// um instante do SERVIDOR. Comparar isso com `Date.now()` do browser já custou
// caro: o iPhone do Rica adiantado quebrou a detecção de fim do `/compact`
// (09/08) porque a guarda comparava timestamp do servidor com relógio do
// cliente, e ficava falsa para sempre.
//
// Aqui o cliente entra só como CRONÔMETRO: quanto tempo passou desde a
// montagem. A hora em si continua sendo a que o servidor mandou. De quebra,
// isso mantém o primeiro quadro idêntico ao HTML do servidor — o relógio só
// começa a andar depois que a página monta, então não há divergência de
// hidratação.

/** O `agora` do servidor, avançado pelo tanto que o browser andou desde a
 *  montagem. Nunca recua abaixo da âncora: NTP que ajusta a hora para trás no
 *  meio da aba aberta não pode fazer a sessão do agente encolher. */
export function relogioAncorado(
  agoraServidorSeg: number,
  montouEmMs: number,
  agoraMs: number,
): number {
  return agoraServidorSeg + Math.max(0, Math.floor((agoraMs - montouEmMs) / 1000));
}
