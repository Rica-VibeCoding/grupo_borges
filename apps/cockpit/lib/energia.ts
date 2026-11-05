// Ligar e Desligar as máquinas da casa (Rica, 05/11 14:59). Quem manda é a
// `cockpit-api` da VPS (`/api/energia`): um Arsenal desligado não se religa
// sozinho. Aqui moram o contrato, os fetchers e o texto que cada estado mostra.
// Sem React: testável em `node --test`. A VPS nunca entra aqui.

import type { MaquinaDaCasa, Trecho } from './linhas-das-maquinas.ts';

export type Andamento = 'ligando' | 'desligando' | null;

export type EnergiaMaquina = {
  id: string;
  nome: string;
  ligado: boolean;
  ligar: { pode: boolean; motivo: string | null };
  em_andamento: Andamento;
};

export type Impacto = {
  agentes: string[];
  chromes: number;
  em_uso: boolean | null;
  aviso: string | null;
};

/** Falha que a API explicou (`{mensagem}` ou `{detail}`). */
export class FalhaDaEnergia extends Error {}

function base(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';
}

async function falha(res: Response): Promise<FalhaDaEnergia> {
  try {
    const corpo = await res.json();
    const texto = corpo?.mensagem ?? corpo?.detail;
    if (typeof texto === 'string') return new FalhaDaEnergia(texto);
  } catch {
    /* corpo sem JSON: cai no código */
  }
  return new FalhaDaEnergia(`erro ${res.status}`);
}

export async function fetchEnergia(): Promise<EnergiaMaquina[]> {
  const res = await fetch(`${base()}/api/energia`, { cache: 'no-store' });
  if (!res.ok) throw await falha(res);
  return res.json();
}

export async function fetchImpacto(id: string): Promise<Impacto> {
  const res = await fetch(`/api/energia/${encodeURIComponent(id)}/impacto`, { cache: 'no-store' });
  if (!res.ok) throw await falha(res);
  return res.json();
}

export async function postDesligar(id: string): Promise<void> {
  const res = await fetch(`/api/energia/${encodeURIComponent(id)}/desligar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmo: true }),
  });
  if (!res.ok) throw await falha(res);
}

export async function postLigar(id: string): Promise<void> {
  const res = await fetch(`/api/energia/${encodeURIComponent(id)}/ligar`, { method: 'POST' });
  if (!res.ok) throw await falha(res);
}

/** 15 s parado; 5 s com uma ação em curso, para a faixa acompanhar o desfecho. */
export function intervaloDaEnergia(lista: EnergiaMaquina[] | null): number {
  return lista?.some((m) => m.em_andamento !== null) ? 5_000 : 15_000;
}

export type Faixa = {
  estado: string;
  ligado: boolean;
  /** O botão da faixa; `null` com uma ação em curso. */
  acao: 'desligar' | 'ligar' | null;
  /** Ligar sem caminho: desabilitado, com o motivo escrito ao lado. */
  motivo: string | null;
};

export function faixaDaEnergia(e: EnergiaMaquina): Faixa {
  if (e.em_andamento === 'desligando') return { estado: 'Desligando…', ligado: true, acao: null, motivo: null };
  if (e.em_andamento === 'ligando') return { estado: 'Ligando…', ligado: false, acao: null, motivo: null };
  if (e.ligado) return { estado: 'Ligado', ligado: true, acao: 'desligar', motivo: null };
  return { estado: 'Desligado', ligado: false, acao: 'ligar', motivo: e.ligar.pode ? null : e.ligar.motivo ?? 'sem caminho para ligar' };
}

/** O que cai junto, só as contas: "6 agentes" e "1 Chrome" (Rica, 05/11: sucinto, sem os nomes). */
export function textoDoImpacto(impacto: Impacto): string[] {
  const linhas: string[] = [];
  const n = impacto.agentes.length;
  if (n > 0) linhas.push(`${n} ${n === 1 ? 'agente' : 'agentes'}`);
  if (impacto.chromes > 0) linhas.push(`${impacto.chromes} ${impacto.chromes === 1 ? 'Chrome' : 'Chromes'}`);
  return linhas;
}

/** A linha da home para quem só tem energia (PC, note), ou para a remota desligada. */
export function trechosDaEnergia(e: EnergiaMaquina): Trecho[] {
  const texto =
    e.em_andamento === 'desligando'
      ? 'desligando…'
      : e.em_andamento === 'ligando'
        ? 'ligando…'
        : e.ligado
          ? 'ligado'
          : 'desligado';
  return [{ texto, alerta: false }];
}

export type Aba = MaquinaDaCasa & { energia: boolean };

/**
 * As abas da casa: as remotas com painel, depois as que só têm energia (PC,
 * note), depois a local. Máquina com energia e painel (o Arsenal) é uma aba
 * só; casa pelo id ou pelo nome, sem diferenciar maiúscula.
 */
export function abasDaCasa(casa: MaquinaDaCasa[], energia: EnergiaMaquina[]): Aba[] {
  const chave = (s: string) => s.trim().toLocaleLowerCase('pt-BR');
  const comEnergia = (m: MaquinaDaCasa) =>
    !m.local && energia.some((e) => e.id === m.id || chave(e.nome) === chave(m.nome));
  const remotas = casa.filter((m) => !m.local).map((m) => ({ ...m, energia: comEnergia(m) }));
  const soEnergia = energia
    .filter((e) => !casa.some((m) => m.id === e.id || chave(m.nome) === chave(e.nome)))
    .map((e) => ({ id: e.id, nome: e.nome, local: false, energia: true }));
  const local = casa.filter((m) => m.local).map((m) => ({ ...m, energia: false }));
  return [...remotas, ...soEnergia, ...local];
}

/** A entrada de energia de uma aba, pelo id ou pelo nome. */
export function energiaDe(aba: { id: string; nome: string }, energia: EnergiaMaquina[] | null): EnergiaMaquina | null {
  const chave = (s: string) => s.trim().toLocaleLowerCase('pt-BR');
  return energia?.find((e) => e.id === aba.id || chave(e.nome) === chave(aba.nome)) ?? null;
}
