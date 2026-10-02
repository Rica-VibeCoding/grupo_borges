// O que o `/compact` guarda no localStorage, por agente: as durações medidas
// (alimentam o ETA), o início da espera em curso e o marco do servidor. A
// leitura é desconfiada de propósito — storage de outra versão ou corrompido
// vira registro vazio, nunca exceção.

export type ArmazenamentoCompact = Pick<Storage, 'getItem' | 'setItem'>;

export type RegistroStorage = { duracoes?: unknown; inicio?: unknown; marco?: unknown };

export function chaveStorage(agentSlug: string): string {
  return `cockpit:compact:v1:${agentSlug}`;
}

export function lerRegistro(storage: ArmazenamentoCompact | null, slug: string): RegistroStorage {
  if (!storage) return {};
  try {
    const cru = storage.getItem(chaveStorage(slug));
    if (!cru) return {};
    const parsed: unknown = JSON.parse(cru);
    return parsed && typeof parsed === 'object' ? (parsed as RegistroStorage) : {};
  } catch {
    return {};
  }
}

export function duracoesDe(registro: RegistroStorage): number[] {
  if (!Array.isArray(registro.duracoes)) return [];
  return registro.duracoes.filter(
    (d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0,
  );
}
