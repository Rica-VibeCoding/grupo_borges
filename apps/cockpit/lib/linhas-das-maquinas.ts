// Quais máquinas a casa mostra e o que a linha de cada uma diz — a lógica da
// linha por máquina no pé da tropa e das abas da tela Abertos (Rica, 05/11).
// A local é a que o próprio cockpit mede (`/api/vps`); as remotas vêm de
// `/api/maquinas` e têm Fechar. Nenhum nome fixo: o id da local sai do nome.

import {
  emAlerta,
  swapEmTroca,
  type RecursosDaVps,
} from '../components/shell/recursos-da-vps.ts';
import { maquinasDeFora, temperaturaEmAlerta, type Maquina, type ResumoOnline } from './maquinas.ts';

/** "VPS" → "vps", "Estúdio 2" → "estudio-2": o id da aba da máquina local. */
export function idDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type MaquinaDaCasa = Maquina & { local: boolean };

/**
 * As remotas primeiro (têm Fechar; a 1ª é a aba que abre), a local por último.
 * Remota com o nome da local vence: no cockpit do Arsenal, o Arsenal aparece
 * uma vez só, e é o que fecha. Sem leitura da local, só as remotas.
 */
export function maquinasDaCasa(nomeLocal: string | null, remotas: Maquina[]): MaquinaDaCasa[] {
  const lista: MaquinaDaCasa[] = remotas.map((m) => ({ ...m, local: false }));
  if (nomeLocal === null) return lista;
  const repetida = maquinasDeFora(remotas, nomeLocal).length < remotas.length;
  const id = idDoNome(nomeLocal);
  if (repetida || !id || remotas.some((m) => m.id === id)) return lista;
  return [...lista, { id, nome: nomeLocal, local: true }];
}

/**
 * `curto`: o que a coluna estreita escreve (tropa do chat), sem o rótulo, que
 * lá vira cabeçalho. `falado`: o que o leitor de tela diz, quando difere.
 */
export type Trecho = { texto: string; alerta: boolean; curto?: string; falado?: string };

/**
 * O que a linha da máquina mostra. `medidas` é CPU, RAM e temperatura, sempre
 * nessa ordem, ou um trecho só com o estado (desligado, ligando…). `avisos` só
 * existe em alerta: o que não é medida fixa, mas não pode passar em branco.
 */
export type Leitura = { medidas: Trecho[]; avisos: Trecho[] };

/** A linha que só diz um estado: "desligado", "fora do ar". */
export function leituraDeEstado(medidas: Trecho[]): Leitura {
  return { medidas, avisos: [] };
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/**
 * Uma medida. Em alerta ganha "!" (a cor nunca vai sozinha, §3) e a palavra só
 * na voz: "CPU 95% alta" não cabe três vezes na coluna da tropa.
 */
function medida(texto: string, curto: string, alerta: boolean, palavra: string): Trecho {
  return alerta
    ? { texto: `${texto}!`, curto: `${curto}!`, alerta, falado: `${texto} ${palavra}` }
    : { texto, curto, alerta };
}

function cpu(valor: number | null): Trecho {
  if (valor === null) return { texto: 'CPU —', curto: '—', alerta: false, falado: 'CPU sem leitura' };
  return medida(`CPU ${pct(valor)}`, pct(valor), emAlerta('cpu', valor), 'alta');
}

function ram(valor: number): Trecho {
  return medida(`RAM ${pct(valor)}`, pct(valor), emAlerta('ram', valor), 'alta');
}

function temperatura(c: number): Trecho {
  return medida(`${Math.round(c)} °C`, `${Math.round(c)}°`, temperaturaEmAlerta(c), 'quente');
}

/** Disco e swap entram só em alerta, com a mesma regra das medidas. */
function discoCheio(valor: number): Trecho[] {
  // O número fica só na voz: no vão entre o nome e as colunas, cabe "disco!".
  return emAlerta('disco', valor) ? [{ texto: 'disco!', curto: '!', alerta: true, falado: `disco ${pct(valor)} cheio` }] : [];
}

/**
 * A linha da máquina local. Sem sensor a temperatura some, sem nada no lugar.
 * `comSensor` vem do componente: uma leitura com temperatura basta, e a coluna
 * não some se o sensor falhar numa rodada ("— °C").
 */
export function leituraDaLocal(dados: RecursosDaVps, comSensor: boolean): Leitura {
  const medidas = [cpu(dados.cpu_pct), ram(dados.ram.pct)];
  if (comSensor) {
    const c = dados.temperatura_c;
    medidas.push(c === null ? { texto: '— °C', curto: '—', alerta: false, falado: 'temperatura sem leitura' } : temperatura(c));
  }
  const avisos = discoCheio(dados.disco.pct);
  if (swapEmTroca(dados)) avisos.push({ texto: 'swap!', curto: '!', alerta: true, falado: 'swap em troca' });
  return { medidas, avisos };
}

/**
 * A linha de uma remota. Os parados não entram (não cabem com as três medidas):
 * na raiz o selo do atalho Abertos conta; no chat, só a tela Abertos mostra.
 */
export function leituraDaRemota(resumo: ResumoOnline): Leitura {
  const medidas = [cpu(resumo.cpu_pct), ram(resumo.ram.pct)];
  if (resumo.temperatura_c !== null) medidas.push(temperatura(resumo.temperatura_c));
  return { medidas, avisos: discoCheio(resumo.disco.pct) };
}
