/**
 * A régua do bloco da VPS — a aritmética e os textos, fora do componente.
 *
 * Ordem do Rica (07/09): *"na sidebar do cockpit tivesse os consumos mais
 * importantes da vps, tipo ram e cpu e espaço"*. Aqui mora o que decide como
 * cada número vira texto e QUANDO ele ganha cor; o `.tsx` só desenha.
 *
 * Módulo neutro de propósito — sem `'use client'`, igual ao `medidor.ts`.
 */

export type Recurso = {
  usado_mb: number;
  livre_mb: number;
  total_mb: number;
  pct: number;
};

/** Quem mais come de uma das coisas que travam a máquina. */
export type Vilao = {
  nome: string;
  pct: number;
  usado_mb: number;
};

/** O corpo do `GET /api/vps`. */
export type RecursosDaVps = {
  cpu_pct: number | null;
  carga_1m: number;
  nucleos: number;
  ram: Recurso;
  swap: Recurso | null;
  disco: Recurso;
  vilao: { cpu: Vilao | null; ram: Vilao | null };
  no_ar_segundos: number;
  medido_em: number;
};

export type Medida = 'cpu' | 'ram' | 'swap' | 'disco';

/**
 * Acima disto a barra fica da cor de atenção — e só acima disto. Cor só onde há
 * julgamento (regra 6 da tropa): 60% de RAM numa máquina de 12 GB é o dia
 * normal da frota, não um aviso.
 *
 * Swap tem o teto mais baixo porque swap usada não é "memória a mais", é RAM que
 * já acabou: acima da metade a máquina está trocando página com o disco, e é
 * isso que deixa tudo lento antes de qualquer OOM.
 */
export const TETO_PCT: Record<Medida, number> = {
  cpu: 90,
  ram: 85,
  swap: 50,
  disco: 85,
};

export function emAlerta(medida: Medida, pct: number | null): boolean {
  return pct !== null && pct > TETO_PCT[medida];
}

/** Quanto da barra o valor preenche, de 0 a 1. Linear: aqui 0 a 100 é a escala
 *  inteira e faz sentido — diferente do contexto, a VPS vive em qualquer faixa. */
export function fracaoDaBarra(pct: number | null): number {
  if (pct === null || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(1, pct / 100);
}

const MB_POR_GB = 1024;

/** `996 MB`, `7,2 GB`, `35 GB`: uma casa só quando ela ainda distingue alguma
 *  coisa. Vírgula porque a tela é em português. */
export function formataTamanho(mb: number): string {
  if (mb < MB_POR_GB) return `${Math.round(mb)} MB`;
  const gb = mb / MB_POR_GB;
  return `${(gb < 10 ? gb.toFixed(1) : Math.round(gb).toString()).replace('.', ',')} GB`;
}

/** `há 34 d`, `há 23 h`, `há 12 min`. A unidade maior basta: o rodapé lê "há
 *  quanto tempo sem reiniciar", não um cronômetro. */
export function formataNoAr(segundos: number): string {
  const min = Math.floor(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}

export function formataCarga(carga: number): string {
  return carga.toFixed(1).replace('.', ',');
}

/**
 * As linhas do vilão — ordem do Rica (07/09): *"o que estiver usando mais do
 * que nos importa, menos de disco, só do que realmente trava"*.
 *
 * Quando o mesmo dono lidera CPU e RAM — que é o caso comum, um agente pensando
 * grande — as duas viram UMA linha. Repetir o nome em duas linhas seguidas
 * gastaria o dobro da altura pra dizer a mesma coisa, e ele pediu denso.
 */
export function linhasDeVilao(dados: RecursosDaVps): Array<{ nome: string; detalhe: string }> {
  const { cpu, ram } = dados.vilao;
  const deCpu = cpu ? `CPU ${Math.round(cpu.pct)}%` : null;
  const deRam = ram ? `RAM ${formataTamanho(ram.usado_mb)}` : null;

  if (cpu && ram && cpu.nome === ram.nome) {
    return [{ nome: cpu.nome, detalhe: `${deCpu} · ${deRam}` }];
  }
  const linhas: Array<{ nome: string; detalhe: string }> = [];
  if (cpu && deCpu) linhas.push({ nome: cpu.nome, detalhe: deCpu });
  if (ram && deRam) linhas.push({ nome: ram.nome, detalhe: deRam });
  return linhas;
}

/** O `title` de cada linha e o texto lido por leitor de tela: o absoluto que a
 *  barra resume. `usado de total`, e no disco o que ainda cabe. */
export function descreve(medida: Medida, dados: RecursosDaVps): string {
  switch (medida) {
    case 'cpu':
      return `carga ${formataCarga(dados.carga_1m)} em ${dados.nucleos} núcleo${dados.nucleos === 1 ? '' : 's'}`;
    case 'ram':
      return `${formataTamanho(dados.ram.usado_mb)} de ${formataTamanho(dados.ram.total_mb)}`;
    case 'swap':
      return dados.swap
        ? `${formataTamanho(dados.swap.usado_mb)} de ${formataTamanho(dados.swap.total_mb)}`
        : 'sem swap';
    case 'disco':
      return `${formataTamanho(dados.disco.livre_mb)} livres de ${formataTamanho(dados.disco.total_mb)}`;
  }
}
