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

export type Trecho = { texto: string; alerta: boolean };

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Um trecho; em alerta ganha a palavra (a cor nunca vai sozinha, §3). */
function trecho(texto: string, alerta: boolean, palavra: string): Trecho {
  return { texto: alerta ? `${texto} ${palavra}` : texto, alerta };
}

/** Alerta primeiro: com a linha cortada no celular, o que some é o neutro. */
function alertaPrimeiro(trechos: Trecho[]): Trecho[] {
  return [...trechos.filter((t) => t.alerta), ...trechos.filter((t) => !t.alerta)];
}

/**
 * A linha da máquina local: RAM e, no lugar da temperatura, a Swap onde não há
 * sensor. CPU e disco só entram em alerta — o resto do tempo moram na aba.
 * `comSensor` vem do componente: uma leitura com temperatura basta, e a linha
 * não volta à Swap se o sensor falhar numa rodada ("— °C").
 */
export function trechosDaLocal(dados: RecursosDaVps, comSensor: boolean): Trecho[] {
  const trechos: Trecho[] = [trecho(`RAM ${pct(dados.ram.pct)}`, emAlerta('ram', dados.ram.pct), 'alta')];
  if (comSensor) {
    const c = dados.temperatura_c;
    trechos.push(trecho(c === null ? '— °C' : `${Math.round(c)} °C`, temperaturaEmAlerta(c), 'quente'));
  } else if (dados.swap) {
    trechos.push(trecho(`Swap ${pct(dados.swap.pct)}`, swapEmTroca(dados), 'em troca'));
  }
  if (dados.cpu_pct !== null && emAlerta('cpu', dados.cpu_pct)) trechos.push(trecho(`CPU ${pct(dados.cpu_pct)}`, true, 'alta'));
  if (emAlerta('disco', dados.disco.pct)) trechos.push(trecho(`disco ${pct(dados.disco.pct)}`, true, 'cheio'));
  return alertaPrimeiro(trechos);
}

/** A linha de uma remota: RAM, temperatura e quantos estão parados há 30 min. */
export function trechosDaRemota(resumo: ResumoOnline): Trecho[] {
  const trechos: Trecho[] = [trecho(`RAM ${pct(resumo.ram.pct)}`, emAlerta('ram', resumo.ram.pct), 'alta')];
  const c = resumo.temperatura_c;
  if (c !== null) trechos.push(trecho(`${Math.round(c)} °C`, temperaturaEmAlerta(c), 'quente'));
  if (emAlerta('cpu', resumo.cpu_pct)) trechos.push(trecho(`CPU ${pct(resumo.cpu_pct)}`, true, 'alta'));
  if (emAlerta('disco', resumo.disco.pct)) trechos.push(trecho(`disco ${pct(resumo.disco.pct)}`, true, 'cheio'));
  const parados = resumo.parados_30min;
  if (parados > 0) trechos.push({ texto: `${parados} ${parados === 1 ? 'parado' : 'parados'}`, alerta: false });
  return alertaPrimeiro(trechos);
}
