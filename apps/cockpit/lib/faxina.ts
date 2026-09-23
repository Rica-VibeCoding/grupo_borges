// Faxina — docs e skills da frota que ninguém lê há 20+ dias. A varredura e o
// parecer do Jev nascem no back (`apps/api/routers/faxina.py`); aqui mora o
// contrato, os fetchers e o texto que cada estado mostra. Sem React: a lógica
// que decide o que o cartão diz é testável em `node --test`.

export type FaxinaStatus =
  | 'pendente'
  | 'mantido'
  | 'arquivar_pedido'
  | 'arquivado'
  | 'desfazer_pedido'
  | 'erro';

export type FaxinaVeredito = 'manter' | 'arquivar' | 'duplica';

export type FaxinaItem = {
  id: number;
  caminho: string;
  workspace: string;
  tipo: 'doc' | 'skill' | 'plano';
  ultima_leitura: number | null;
  ultimo_commit: number | null;
  dias_parado: number | null;
  citado_em: string[] | null;
  jev_veredito: FaxinaVeredito | null;
  jev_motivo: string | null;
  jev_duplica_de: string | null;
  status: FaxinaStatus;
  erro: string | null;
  arquivado_para: string | null;
  commit_sha: string | null;
  decidido_em: number | null;
  criado_em: number;
};

export type FaxinaResumo = {
  pendentes: number;
  arquivados: number;
  ultima_varredura: number | null;
};

export type FaxinaLista = { itens: FaxinaItem[]; resumo: FaxinaResumo };

export type FaxinaAba = 'pendente' | 'arquivado';

export type FaxinaAcao = 'manter' | 'arquivar' | 'desfazer';

// No servidor o fetch precisa de URL absoluta; no cliente o rewrite do
// `next.config` resolve o caminho relativo — mesma divisão do `fetchFleet`.
function base(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';
}

export async function fetchFaxina(aba: FaxinaAba | 'todos'): Promise<FaxinaLista> {
  const res = await fetch(`${base()}/api/faxina?status=${aba}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchFaxina failed: ${res.status}`);
  return res.json();
}

export async function postFaxinaAcao(id: number, acao: FaxinaAcao): Promise<FaxinaItem> {
  const res = await fetch(`/api/faxina/${id}/${acao}`, { method: 'POST' });
  if (!res.ok) throw new Error(`faxina ${acao} failed: ${res.status}`);
  return res.json();
}

export async function fetchFaxinaConteudo(
  id: number,
  signal?: AbortSignal,
): Promise<{ caminho: string; texto: string }> {
  const res = await fetch(`/api/faxina/${id}/conteudo`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchFaxinaConteudo failed: ${res.status}`);
  return res.json();
}

/** Status que o próximo passo transforma em outro: o executor ainda não rodou. */
export function emTransito(status: FaxinaStatus): boolean {
  return status === 'arquivar_pedido' || status === 'desfazer_pedido';
}

/** Status que o otimista assume ao tocar o botão, antes da resposta. */
export function statusAposAcao(acao: FaxinaAcao): FaxinaStatus {
  if (acao === 'manter') return 'mantido';
  if (acao === 'arquivar') return 'arquivar_pedido';
  return 'desfazer_pedido';
}

/** Ações que fazem sentido em cada status — o cartão só mostra estas. */
export function acoesPermitidas(status: FaxinaStatus): FaxinaAcao[] {
  if (status === 'pendente') return ['manter', 'arquivar'];
  if (status === 'arquivado') return ['desfazer'];
  return [];
}

export function rotuloVeredito(item: Pick<FaxinaItem, 'jev_veredito' | 'jev_duplica_de'>): string | null {
  if (item.jev_veredito === 'manter') return 'Jev: manter';
  if (item.jev_veredito === 'arquivar') return 'Jev: arquivar';
  if (item.jev_veredito === 'duplica') {
    return item.jev_duplica_de ? `Jev: duplica ${item.jev_duplica_de}` : 'Jev: duplica outro doc';
  }
  return null;
}

export function rotuloStatus(item: Pick<FaxinaItem, 'status' | 'erro'>): string | null {
  switch (item.status) {
    case 'mantido':
      return 'mantido';
    case 'arquivar_pedido':
      return 'arquivando…';
    case 'desfazer_pedido':
      return 'voltando…';
    case 'erro':
      return item.erro ? `não arquivou: ${item.erro}` : 'não arquivou';
    default:
      return null;
  }
}

/** "nunca lido · 34 dias sem commit" ou "lido há 27 dias". */
export function descreverParado(
  item: Pick<FaxinaItem, 'ultima_leitura' | 'ultimo_commit'>,
  agora: number,
): string {
  const dias = (t: number) => Math.max(0, Math.floor((agora - t) / 86400));
  const partes: string[] = [];
  partes.push(item.ultima_leitura == null ? 'nunca lido' : `lido há ${plural(dias(item.ultima_leitura), 'dia')}`);
  if (item.ultimo_commit != null) partes.push(`${plural(dias(item.ultimo_commit), 'dia')} sem commit`);
  return partes.join(' · ');
}

function plural(n: number, palavra: string): string {
  return `${n} ${palavra}${n === 1 ? '' : 's'}`;
}
