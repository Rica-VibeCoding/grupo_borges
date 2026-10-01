/**
 * Há quanto tempo o agente fez algo — o canto direito de baixo da linha da tropa.
 *
 * Fonte: `last_seen` do `/api/fleet`, que o back grava a cada linha nova do
 * JSONL do agente (`jsonl_watcher.py` → `touch_agent_run_heartbeat`) e na
 * troca de modelo. Unidade maior só: "agora", "12 min", "3 h", "2 d".
 *
 * Módulo neutro — sem React — para o teste.
 */
export function formataUltimaAtividade(lastSeen: number | null, agora: number): string {
  if (lastSeen === null || !Number.isFinite(lastSeen)) return '—';
  const segundos = Math.max(0, agora - lastSeen);
  if (segundos < 60) return 'agora';
  const min = Math.floor(segundos / 60);
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas} h`;
  return `${Math.floor(horas / 24)} d`;
}
