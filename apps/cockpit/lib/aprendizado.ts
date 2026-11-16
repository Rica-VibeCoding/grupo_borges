// Aprendizado — o que cada agente da frota aprendeu (memória, memória
// compartilhada, skill), no tempo, e a poda do que estiver errado. O contrato
// mora em `docs/aprendizado/contrato-api.md`; aqui ficam os tipos, os fetchers e
// o texto que cada estado mostra. Sem React: testável em `node --test`.
//
// ⚠️ Só a rota `/aprendizado` importa este módulo. Ele não entra em layout,
// shell nem componente comum — a tela é pouco consultada e não pode pesar no
// carregamento do resto (ordem do Rica, 16/11).

export type TipoAprendizado = 'memoria' | 'memoria_compartilhada' | 'skill';

export type NoAprendizado = {
  id: string;
  /** Estável por arquivo: os nós "criou" e "mudou" do mesmo arquivo o
   *  compartilham. É por ele que a poda se marca na tela. */
  alvo_id: string;
  agente: string;
  tipo: TipoAprendizado;
  acao: 'criou' | 'mudou';
  /** Segundos UTC. */
  data: number;
  titulo: string;
  descricao: string | null;
  origem: 'agente' | 'sonho';
  caminho: string;
  fonte_data: string;
};

export type ListaAprendizado = {
  itens: NoAprendizado[];
  total: number;
  /** Nós do inventário inteiro por agente, só com o filtro de tipo. */
  por_agente: Record<string, number>;
  /** Soma de `por_agente`. */
  total_geral: number;
  proximo_offset: number | null;
};

export type Filtros = { agente: string | null; tipo: TipoAprendizado | null };

/** Uma poda feita por esta tela. Guardada no aparelho para o Desfazer
 *  sobreviver ao nó sair da lista e à página recarregar. */
export type Poda = {
  /** O arquivo podado: marca todos os nós dele, criou e mudou. */
  alvo_id: string;
  /** O nó em que a poda foi feita. */
  no_id: string;
  operacao_id: string;
  tipo: 'memoria' | 'skill';
  titulo: string;
  agente: string;
  /** Epoch em segundos. */
  em: number;
  /** `apagada`: memória já foi para o arquivo. `pedido`: a Faxina ainda vai
   *  arquivar a skill. `volta_pedida`: o Desfazer da skill foi pedido à Faxina. */
  estado: 'apagada' | 'pedido' | 'volta_pedida';
};

export const TIPOS: TipoAprendizado[] = ['memoria', 'memoria_compartilhada', 'skill'];
export const AGENTE_COMPARTILHADO = 'ze-shared';
export const LIMITE_DA_PAGINA = 100;

export function lerTipo(valor: string | undefined): TipoAprendizado | null {
  return TIPOS.includes(valor as TipoAprendizado) ? (valor as TipoAprendizado) : null;
}

// No servidor o fetch precisa de URL absoluta; no cliente o rewrite do
// `next.config` resolve o caminho relativo — a mesma divisão da Faxina.
function base(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';
}

export function consulta(filtros: Filtros, offset: number, limite = LIMITE_DA_PAGINA): string {
  const q = new URLSearchParams();
  if (filtros.agente) q.set('agente', filtros.agente);
  if (filtros.tipo) q.set('tipo', filtros.tipo);
  q.set('offset', String(offset));
  q.set('limite', String(limite));
  return q.toString();
}

export class ErroDaApi extends Error {
  readonly status: number;
  readonly detalhe: string | null;
  constructor(status: number, detalhe: string | null) {
    super(`aprendizado: ${status}${detalhe ? ` ${detalhe}` : ''}`);
    this.status = status;
    this.detalhe = detalhe;
  }
}

async function exigirOk<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();
  let detalhe: string | null = null;
  try {
    const corpo = await res.json();
    if (typeof corpo?.detail === 'string') detalhe = corpo.detail;
  } catch {
    /* corpo sem JSON: fica só o status */
  }
  throw new ErroDaApi(res.status, detalhe);
}

export async function fetchAprendizado(filtros: Filtros, offset = 0, limite = LIMITE_DA_PAGINA) {
  const res = await fetch(`${base()}/api/aprendizado?${consulta(filtros, offset, limite)}`, { cache: 'no-store' });
  return exigirOk<ListaAprendizado>(res);
}

export async function fetchConteudo(id: string): Promise<{ caminho: string; texto: string }> {
  const res = await fetch(`/api/aprendizado/${encodeURIComponent(id)}/conteudo`, { cache: 'no-store' });
  return exigirOk(res);
}

export type RespostaPoda = { operacao_id: string; tipo: 'memoria' | 'skill'; status: string };

/** Só depois da confirmação na tela: o corpo `{confirmar: true}` é o aceite. */
export async function postPoda(no: Pick<NoAprendizado, 'id' | 'tipo'>): Promise<RespostaPoda> {
  const acao = no.tipo === 'skill' ? 'arquivar' : 'apagar';
  const res = await fetch(`/api/aprendizado/${encodeURIComponent(no.id)}/${acao}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmar: true }),
  });
  return exigirOk(res);
}

export async function postDesfazer(operacaoId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/aprendizado/podas/${encodeURIComponent(operacaoId)}/desfazer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmar: true }),
  });
  return exigirOk(res);
}

/** O que se poda em cada tipo. Memória compartilhada é só leitura. */
export function podaPermitida(tipo: TipoAprendizado): 'apagar' | 'arquivar' | null {
  if (tipo === 'memoria') return 'apagar';
  if (tipo === 'skill') return 'arquivar';
  return null;
}

/** Frase de erro que diz o que houve e o que fazer. */
export function mensagemDeErro(erro: unknown, momento: 'abrir' | 'podar' | 'desfazer', tipo?: 'memoria' | 'skill'): string {
  const status = erro instanceof ErroDaApi ? erro.status : 0;
  if (status === 0) return 'Sem resposta da API. Confira a conexão e tente de novo.';
  if (status === 413) return 'O arquivo passa de 200 KiB e não abre por aqui.';
  if (status === 404) {
    return momento === 'desfazer'
      ? 'Essa poda não foi encontrada no servidor. Confira o arquivo à mão.'
      : 'Não está mais lá: alguém já mexeu nele. Recarregue a lista.';
  }
  if (status === 403) return 'Este item é só leitura por aqui.';
  if (status === 409) {
    if (momento === 'desfazer' && tipo === 'skill') {
      return 'A Faxina ainda não arquivou. O Desfazer funciona depois que ela arquivar, em até 1 min.';
    }
    if (tipo === 'skill') return 'A Faxina tem um pedido com problema para esta skill. Confira na tela Faxina.';
    return `O arquivo ou o índice mudou e não foi sobrescrito${detalheDe(erro)}. Confira à mão.`;
  }
  return `A API recusou (${status})${detalheDe(erro)}. Tente de novo em instantes.`;
}

function detalheDe(erro: unknown): string {
  return erro instanceof ErroDaApi && erro.detalhe ? `: ${erro.detalhe}` : '';
}

// ——— texto ———

const PREFIXOS = /^(feedback|project|projeto|user|reference|shared|referencia)_/;

/** `feedback_veto_do_rica_se_anota_na_hora` → `Veto do rica se anota na hora`.
 *  Skill guarda o nome (`promob-catalogo`): é por ele que o Rica a chama. */
export function tituloLegivel(no: Pick<NoAprendizado, 'titulo' | 'tipo'>): string {
  if (no.tipo === 'skill') return no.titulo;
  const limpo = no.titulo.replace(PREFIXOS, '').replace(/[_-]+/g, ' ').trim();
  return limpo ? limpo[0].toLocaleUpperCase('pt-BR') + limpo.slice(1) : no.titulo;
}

export function nomeDoAgente(slug: string): string {
  // Quem escreve a memória compartilhada é a frota, não um agente.
  if (slug === AGENTE_COMPARTILHADO) return 'Frota';
  const nome = slug.replace(/[_-]+/g, ' ');
  return nome[0].toLocaleUpperCase('pt-BR') + nome.slice(1);
}

const NOME_DO_TIPO: Record<TipoAprendizado, string> = {
  memoria: 'memória',
  memoria_compartilhada: 'memória compartilhada',
  skill: 'skill',
};

/** "criou memória", "mudou skill". */
export function oQueAconteceu(no: Pick<NoAprendizado, 'acao' | 'tipo'>): string {
  return `${no.acao} ${NOME_DO_TIPO[no.tipo]}`;
}

// ——— tempo (sempre no fuso do Rica) ———

const FUSO = 'America/Sao_Paulo';
const formatoDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const formatoTitulo = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' });
const formatoTituloAno = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `2026-11-16` no fuso de São Paulo — a chave do agrupamento. */
export function chaveDoDia(segundos: number): string {
  const [d, m, a] = formatoDia.format(segundos * 1000).split('/');
  return `${a}-${m}-${d}`;
}

export function hora(segundos: number): string {
  return formatoHora.format(segundos * 1000);
}

/** "Hoje", "Ontem", "sábado, 14 de novembro" (com o ano só se não for o corrente). */
export function rotuloDoDia(segundos: number, agora: number): string {
  const chave = chaveDoDia(segundos);
  if (chave === chaveDoDia(agora)) return 'Hoje';
  if (chave === chaveDoDia(agora - 86400)) return 'Ontem';
  const mesmoAno = chave.slice(0, 4) === chaveDoDia(agora).slice(0, 4);
  const texto = (mesmoAno ? formatoTitulo : formatoTituloAno).format(segundos * 1000);
  return texto[0].toLocaleUpperCase('pt-BR') + texto.slice(1);
}

export type Dia = { chave: string; data: number; itens: NoAprendizado[] };

/** Agrupa preservando a ordem da API (mais novo primeiro). */
export function agruparPorDia(itens: NoAprendizado[]): Dia[] {
  const dias: Dia[] = [];
  for (const no of itens) {
    const chave = chaveDoDia(no.data);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.itens.push(no);
    else dias.push({ chave, data: no.data, itens: [no] });
  }
  return dias;
}

// ——— podas guardadas no aparelho ———

export const CHAVE_DAS_PODAS = 'ck-aprendizado-podas';
const VALIDADE_DA_PODA = 7 * 86400;

export function lerPodas(bruto: string | null, agora: number): Poda[] {
  if (!bruto) return [];
  try {
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    return lista
      .filter(
        (p): p is Poda =>
          typeof p?.no_id === 'string' && typeof p?.operacao_id === 'string' && agora - Number(p.em) < VALIDADE_DA_PODA,
      )
      // Poda guardada antes do `alvo_id`: o Desfazer continua, em "Podados por você".
      .map((p) => (typeof p.alvo_id === 'string' ? p : { ...p, alvo_id: p.no_id }));
  } catch {
    return [];
  }
}
