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

/** Um dono somado por nome: agente, serviço ou container. CPU na escala da máquina. */
export type Consumidor = {
  nome: string;
  cpu_pct: number;
  ram_mb: number;
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
  /** Ausente em API antiga: aí a tela cai no vilão. */
  consumidores?: Consumidor[];
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

/** `12%`, `4,5%`, `0,3%`: abaixo de 10 a casa decimal separa quem trabalha de quem dorme. */
export function formataPct(pct: number): string {
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1).replace('.', ',')}%`;
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
export type LinhaDeProcesso = { nome: string; cpu: string | null; ram: string | null };

export function linhasDeVilao(dados: RecursosDaVps): LinhaDeProcesso[] {
  // 27/09: um vilão só escondia a frota inteira trabalhando. Com a lista, cada
  // dono aparece com os dois números, na ordem de quem mais come CPU. Os
  // números vão em colunas próprias (01/10): o rótulo CPU/RAM sai uma vez só,
  // no cabeçalho, e sobra linha para o nome inteiro.
  if (dados.consumidores?.length) {
    return dados.consumidores.map((c) => ({
      nome: c.nome,
      cpu: formataPct(c.cpu_pct),
      ram: formataTamanho(c.ram_mb),
    }));
  }
  const { cpu, ram } = dados.vilao;
  const deCpu = cpu ? `${Math.round(cpu.pct)}%` : null;
  const deRam = ram ? formataTamanho(ram.usado_mb) : null;

  if (cpu && ram && cpu.nome === ram.nome) {
    return [{ nome: cpu.nome, cpu: deCpu, ram: deRam }];
  }
  const linhas: LinhaDeProcesso[] = [];
  if (cpu) linhas.push({ nome: cpu.nome, cpu: deCpu, ram: null });
  if (ram) linhas.push({ nome: ram.nome, cpu: null, ram: deRam });
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

/** Nomes de sistema na palavra curta que o Rica reconhece. */
const DO_SISTEMA: Record<string, string> = {
  'cockpit-api': 'cockpit (API)',
  'cockpit-v2': 'cockpit',
  tailscaled: 'tailscale',
  dockerd: 'docker',
  'containerd-shim': 'containerd',
  'containerd-shim-runc-v2': 'containerd',
  chrome: 'Chrome',
  headless_shell: 'Chrome',
  kthreadd: 'kernel',
  // O back só sabe dar nome de agente ao `claude` que roda na frota (unit ou
  // socket tmux `borges-*`). O que sobra é sessão aberta fora dela.
  claude: 'Claude avulso',
};

/**
 * O nome do processo como gente: o back manda o slug capitalizado do agente
 * ("Fluytcom", "Pavan2") ou o nome cru do sistema ("cockpit-api"). Agente vira
 * o nome do painel ("Fluyt", "José Pavan 2"); sistema vira a palavra curta.
 */
export function nomeLegivel(nome: string, agentes: ReadonlyArray<{ slug: string; name: string }>): string {
  const casado = /^(.*?)(\d*)$/.exec(nome.toLowerCase());
  const base = casado?.[1] ?? nome.toLowerCase();
  const numero = casado?.[2] ?? '';
  const agente = agentes.find((a) => a.slug === nome.toLowerCase()) ?? agentes.find((a) => a.slug === base);
  if (agente) return agente.slug === nome.toLowerCase() || !numero ? agente.name : `${agente.name} ${numero}`;
  if (DO_SISTEMA[nome]) return DO_SISTEMA[nome];
  // Os cockpits de prévia sobem como `cockpit-ideia-<assunto>`.
  if (nome.startsWith('cockpit-ideia-')) return 'cockpit (prévia)';
  if (nome.startsWith('cockpit-')) return 'cockpit';
  return nome;
}
