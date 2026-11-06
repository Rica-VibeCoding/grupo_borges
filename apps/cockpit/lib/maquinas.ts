// Abertos (`/abertos`) — o que está aberto em cada máquina da casa e quanto come. O back
// é a ponte `apps/api/routers/maquinas.py`, que fala com o painel de cada
// máquina pela tailnet; aqui mora o contrato, os fetchers e o texto que cada
// estado mostra. Sem React: a lógica que decide o que a tela diz é testável em
// `node --test`.

import { formataTamanho, type Recurso } from '../components/shell/recursos-da-vps.ts';

export type Maquina = { id: string; nome: string };

export type Tela = { em_uso: boolean | null; ultimo_uso_s: number | null };

export type ResumoOnline = {
  online: true;
  cpu_pct: number | null;
  ram: Recurso;
  disco: Recurso;
  temperatura_c: number | null;
  parados_30min: number | null;
  tela: Tela;
  medido_em: number;
};

export type ResumoOffline = { online: false; motivo: string };

export type Resumo = ResumoOnline | ResumoOffline;

export type Grupo = 'seus' | 'terminal' | 'agente' | 'protegido' | 'residual';

export type ItemAberto = {
  id: string;
  grupo: Grupo;
  rotulo: string;
  dono: string | null;
  memoria_mb: number | null;
  /** Fatia da máquina inteira entre amostras de 3 s; null sem delta válido. */
  cpu_pct?: number | null;
  parado_s: number | null;
  abas: string[];
  pede_confirmacao: boolean;
  acao_rotulo: string | null;
};

export type Abertos = { observado_desde: number; itens: ItemAberto[] };

/** Falha que o painel explicou (403/404/409/502 com `{mensagem}`). */
export class FalhaDaMaquina extends Error {
  status?: number;
  constructor(mensagem: string, status?: number) {
    super(mensagem);
    this.status = status;
  }
}

export function textoDaFalhaDosAbertos(mensagem: string, status?: number): string {
  return status === 501 ? mensagem : `Não consegui listar o que está aberto: ${mensagem}. Tento de novo sozinho.`;
}

export function textoDoFechado(mb: number | null): string {
  return mb === null ? 'Fechado · RAM sem leitura' : `Liberou ${formataTamanho(mb)}`;
}

// No servidor o fetch precisa de URL absoluta; no cliente o rewrite do
// `next.config` resolve o caminho relativo — mesma divisão da `faxina.ts`.
function base(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';
}

async function mensagemDe(res: Response): Promise<string> {
  try {
    const corpo = await res.json();
    if (typeof corpo?.mensagem === 'string') return corpo.mensagem;
  } catch {
    /* corpo sem JSON: cai no código */
  }
  return `erro ${res.status}`;
}

export async function fetchMaquinas(): Promise<Maquina[]> {
  const res = await fetch(`${base()}/api/maquinas`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchMaquinas failed: ${res.status}`);
  return res.json();
}

/** O nome da máquina que o próprio cockpit mede (`/api/vps`): a aba local da tela Abertos. */
export async function fetchNomeLocal(): Promise<string> {
  const res = await fetch(`${base()}/api/vps`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchNomeLocal failed: ${res.status}`);
  return (await res.json()).nome;
}

export async function fetchResumo(id: string): Promise<Resumo> {
  const res = await fetch(`/api/maquinas/${id}/resumo`, { cache: 'no-store' });
  if (!res.ok) throw new FalhaDaMaquina(await mensagemDe(res), res.status);
  return res.json();
}

export async function fetchAbertos(id: string): Promise<Abertos> {
  const res = await fetch(`/api/maquinas/${id}/abertos`, { cache: 'no-store' });
  if (!res.ok) throw new FalhaDaMaquina(await mensagemDe(res), res.status);
  return res.json();
}

export async function postFechar(maquina: string, item: string): Promise<{ liberou_mb: number | null }> {
  const res = await fetch(`/api/maquinas/${maquina}/fechar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: item }),
  });
  if (!res.ok) throw new FalhaDaMaquina(await mensagemDe(res), res.status);
  return res.json();
}

/**
 * Acima disto a temperatura acende. 85 °C é onde o processador da máquina começa a baixar o
 * clock sozinho (o limite do pacote é 100 °C): acender antes disso seria cor
 * num dia normal de compilação.
 */
export const TETO_TEMPERATURA_C = 85;

export function temperaturaEmAlerta(c: number | null): boolean {
  return c !== null && c > TETO_TEMPERATURA_C;
}

/** RAM acima disto pinta o selo do atalho de vermelho — o mesmo teto da barra. */
export const TETO_RAM_DO_SELO = 85;

const NOME_DO_GRUPO: Record<Grupo, string> = {
  seus: 'Seus',
  terminal: 'Agentes',
  agente: 'Chrome de agente',
  protegido: 'Protegido',
  residual: 'Fora da lista',
};

const ORDEM_DOS_GRUPOS: Grupo[] = ['seus', 'terminal', 'agente', 'protegido', 'residual'];

export type GrupoDeItens = { grupo: Grupo; nome: string; itens: ItemAberto[]; memoria_mb: number | null };

/** Os grupos na ordem da tela, cada um do que mais come ao que menos. Grupo vazio não vem. */
export function agrupa(itens: ItemAberto[]): GrupoDeItens[] {
  // Compatível com painéis antigos durante a instalação: o residual nunca é app.
  itens = itens.map((i) => i.id === 'fora-da-lista' ? { ...i, grupo: 'residual' } : i);
  return ORDEM_DOS_GRUPOS.flatMap((grupo) => {
    const doGrupo = itens.filter((i) => i.grupo === grupo).sort((a, b) => (b.memoria_mb ?? -1) - (a.memoria_mb ?? -1));
    if (doGrupo.length === 0) return [];
    const memoria_mb = doGrupo.some((i) => i.memoria_mb === null) ? null : doGrupo.reduce((soma, i) => soma + i.memoria_mb!, 0);
    return [{ grupo, nome: NOME_DO_GRUPO[grupo], itens: doGrupo, memoria_mb }];
  });
}

export function textoDoGrupo(grupo: GrupoDeItens): string {
  const memoria = formataTamanho(grupo.memoria_mb);
  const n = grupo.itens.length;
  return grupo.grupo === 'residual' ? memoria : `${n} ${n === 1 ? 'aberto' : 'abertos'} · ${memoria}`;
}

/**
 * O nome na coluna estreita: sem o que o grupo já diz. Em 390 px, dois "Chrome do
 * Fluyt…" ficariam iguais. O rótulo inteiro segue no nome acessível do Fechar.
 */
export function nomeNaLinha(item: Pick<ItemAberto, 'grupo' | 'rotulo'>): string {
  if (item.grupo === 'terminal') return item.rotulo.replace(/^Terminal\s+/, '');
  if (item.grupo === 'agente') return item.rotulo.replace(/^Chrome d[oa]\s+/, '');
  return item.rotulo;
}

/** `12 min`, `2 h`, `3 d` — a unidade maior basta. Abaixo de um minuto, `1 min`. */
export function duracao(segundos: number): string {
  const min = Math.max(1, Math.floor(segundos / 60));
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas} h`;
  return `${Math.floor(horas / 24)} d`;
}

/** Abaixo de um minuto a tela diz em uso; o painel amostra a CPU a cada 3 s. */
const PARADO_MINIMO_S = 60;

/**
 * "parado há 40 min" só se o painel viu os 40 min. Quando o parado alcança o
 * tempo de observação, o número é o piso, não a verdade (o painel reinicia e
 * zera — R1 do plano), e o "+" diz isso: "parado há 12+ min".
 */
export function textoDoParado(parado_s: number | null, observado_desde: number, agora: number): string | null {
  if (parado_s === null || parado_s < PARADO_MINIMO_S) return null;
  const observado = Math.max(0, agora - observado_desde);
  if (parado_s >= observado) return `parado há ${duracao(observado).replace(' ', '+ ')}`;
  return `parado há ${duracao(parado_s)}`;
}

/**
 * A coluna "Atividade": em uso (o painel viu mexer no último minuto), parado com o
 * tempo ("8 min", "12+ min") ou desconhecido (o painel ainda não viu — traço).
 */
export type Atividade = { estado: 'em-uso' } | { estado: 'parado'; texto: string } | { estado: 'desconhecido' };

export function atividade(parado_s: number | null, observado_desde: number, agora: number): Atividade {
  if (parado_s === null) return { estado: 'desconhecido' };
  const parado = textoDoParado(parado_s, observado_desde, agora);
  return parado ? { estado: 'parado', texto: parado.replace('parado há ', '') } : { estado: 'em-uso' };
}

/** "3%", "<1%" ou "—" enquanto o painel não tem duas amostras. */
export function textoDaCpu(cpu_pct: number | null | undefined): string {
  if (cpu_pct == null || !Number.isFinite(cpu_pct) || cpu_pct < 0) return '—';
  if (cpu_pct > 0 && cpu_pct < 1) return '<1%';
  return `${Math.round(cpu_pct)}%`;
}

/** "2 abas: Supabase, Vercel". Sem abas (ou sem CDP), nada. */
export function textoDasAbas(abas: string[]): string | null {
  if (abas.length === 0) return null;
  return `${abas.length} ${abas.length === 1 ? 'aba' : 'abas'}: ${abas.join(', ')}`;
}

/**
 * Sem o nome da máquina na frase: a aba logo acima já diz qual é, e nome
 * próprio muda de gênero ("o Arsenal", "a Fábrica") — o artigo erraria.
 */
export function textoDaTela(tela: Tela): string {
  if (tela.em_uso === true) return 'Alguém está usando agora';
  if (tela.em_uso === false && tela.ultimo_uso_s !== null) {
    return `Ninguém mexe há ${duracao(tela.ultimo_uso_s)}`;
  }
  return 'Não sei se alguém está usando';
}

/**
 * As máquinas que o mini cartão da tropa mostra: todas, menos a que o cockpit
 * já mede no cartão de recursos (o cockpit rodando no próprio Arsenal teria o
 * Arsenal duas vezes). Casa pelo nome, sem diferenciar maiúscula. Selo e tela
 * Abertos seguem com a lista inteira.
 */
export function maquinasDeFora(maquinas: Maquina[], nomeLocal: string): Maquina[] {
  const local = nomeLocal.trim().toLocaleLowerCase('pt-BR');
  return maquinas.filter((m) => m.nome.trim().toLocaleLowerCase('pt-BR') !== local);
}

export type Selo = {
  /** O que o selo escreve: a contagem, "!" (só RAM alta) ou nada. */
  texto: string | null;
  vermelho: boolean;
  /** O motivo por extenso, para leitor de tela e `title` — a cor nunca vai sozinha. */
  descricao: string;
};

export function seloDaMaquina(resumo: Resumo | null, nome: string): Selo {
  if (!resumo || !resumo.online) return { texto: null, vermelho: false, descricao: '' };
  const parados = resumo.parados_30min;
  const ramAlta = resumo.ram.pct > TETO_RAM_DO_SELO;
  const partes: string[] = [];
  if (parados !== null && parados > 0) partes.push(`${parados} ${parados === 1 ? 'parado' : 'parados'} há mais de 30 min`);
  if (ramAlta) partes.push(`RAM em ${Math.round(resumo.ram.pct)}%`);
  return {
    texto: parados !== null && parados > 0 ? String(parados) : ramAlta ? '!' : null,
    vermelho: ramAlta,
    descricao: partes.length ? `${nome}: ${partes.join(', ')}` : '',
  };
}
