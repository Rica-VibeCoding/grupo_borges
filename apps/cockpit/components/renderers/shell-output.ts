// Lógica do `shell-output.tsx` — normaliza as cinco famílias G1 de resultado
// de Bash (700 ocorrências) para um modelo único. Fica fora do JSX para que a
// forma real do payload seja provada pela suíte `node --test`.

export type OperacaoGitNormalizada = {
  acao: string;
  branch?: string;
};

export type SaidaDeShellNormalizada = {
  stdout: string;
  stderr: string;
  interrompido: boolean;
  semSaidaEsperada: boolean;
  backgroundTaskId?: string;
  operacaoGit?: OperacaoGitNormalizada;
  caminhoDaSaidaCompleta?: string;
  tamanhoDaSaidaCompleta?: number;
  interpretacaoDoRetorno?: string;
};

export type TrechoDeShell =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'link'; valor: string };

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function stringPreenchida(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}

function normalizarOperacaoGit(valor: unknown): OperacaoGitNormalizada | undefined {
  if (!ehObjeto(valor)) return undefined;
  const entrada = Object.entries(valor)[0];
  if (!entrada) return undefined;

  const [acao, detalhes] = entrada;
  const branch = ehObjeto(detalhes) ? stringPreenchida(detalhes.branch) : undefined;
  return { acao, ...(branch ? { branch } : {}) };
}

/** Aceita o `tool_use_result` cru das cinco famílias G1. `isImage:true`
 *  deliberadamente não casa: o contrato exige fixture real antes do ramo de
 *  imagem, e as cinco fixtures atuais têm `false`. */
export function normalizarSaidaDeShell(valor: unknown): SaidaDeShellNormalizada | null {
  if (!ehObjeto(valor)) return null;
  if (valor.isImage !== false) return null;
  if (typeof valor.interrupted !== 'boolean') return null;
  if (typeof valor.noOutputExpected !== 'boolean') return null;
  if (typeof valor.stderr !== 'string') return null;
  if (valor.stdout !== undefined && typeof valor.stdout !== 'string') return null;

  const backgroundTaskId = stringPreenchida(valor.backgroundTaskId);
  const operacaoGit = normalizarOperacaoGit(valor.gitOperation);
  const caminhoDaSaidaCompleta = stringPreenchida(valor.persistedOutputPath);
  const tamanhoDaSaidaCompleta =
    typeof valor.persistedOutputSize === 'number' &&
    Number.isFinite(valor.persistedOutputSize) &&
    valor.persistedOutputSize >= 0
      ? valor.persistedOutputSize
      : undefined;
  const interpretacaoDoRetorno = stringPreenchida(valor.returnCodeInterpretation);

  return {
    stdout: typeof valor.stdout === 'string' ? valor.stdout : '',
    stderr: valor.stderr,
    interrompido: valor.interrupted,
    semSaidaEsperada: valor.noOutputExpected,
    ...(backgroundTaskId ? { backgroundTaskId } : {}),
    ...(operacaoGit ? { operacaoGit } : {}),
    ...(caminhoDaSaidaCompleta ? { caminhoDaSaidaCompleta } : {}),
    ...(tamanhoDaSaidaCompleta !== undefined ? { tamanhoDaSaidaCompleta } : {}),
    ...(interpretacaoDoRetorno ? { interpretacaoDoRetorno } : {}),
  };
}

/** Silêncio real não cria uma caixa vazia. Metadados acionáveis ainda contam
 *  como conteúdo mesmo quando os dois canais vieram vazios. */
export function temCorpoDeShell(dados: SaidaDeShellNormalizada): boolean {
  return (
    dados.stdout.length > 0 ||
    dados.stderr.length > 0 ||
    dados.interrompido ||
    dados.backgroundTaskId !== undefined ||
    dados.operacaoGit !== undefined ||
    dados.caminhoDaSaidaCompleta !== undefined ||
    dados.interpretacaoDoRetorno !== undefined
  );
}

export function formatoBytesDeShell(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const casas = (numero: number) => numero.toFixed(1).replace('.', ',');
  if (bytes < 1024 * 1024) return `${casas(bytes / 1024)} kB`;
  return `${casas(bytes / (1024 * 1024))} MB`;
}

/** URLs web absolutas viram link sem interpretar o restante do shell como
 *  markdown. Pontuação comum de fim de frase fica fora do href. */
export function separarLinksDeShell(texto: string): TrechoDeShell[] {
  const trechos: TrechoDeShell[] = [];
  const padrao = /https?:\/\/[^\s<>"']+/giu;
  let cursor = 0;

  for (const resultado of texto.matchAll(padrao)) {
    const indice = resultado.index;
    if (indice > cursor) trechos.push({ tipo: 'texto', valor: texto.slice(cursor, indice) });

    const bruto = resultado[0];
    const semPontuacao = bruto.replace(/[),.;:!?]+$/u, '');
    const pontuacao = bruto.slice(semPontuacao.length);
    trechos.push({ tipo: 'link', valor: semPontuacao });
    if (pontuacao) trechos.push({ tipo: 'texto', valor: pontuacao });
    cursor = indice + bruto.length;
  }

  if (cursor < texto.length) trechos.push({ tipo: 'texto', valor: texto.slice(cursor) });
  return trechos.length > 0 ? trechos : [{ tipo: 'texto', valor: texto }];
}

export function separarCaminhoDeShell(caminho: string): {
  diretorio: string;
  arquivo: string;
} {
  const separador = Math.max(caminho.lastIndexOf('/'), caminho.lastIndexOf('\\'));
  return separador < 0
    ? { diretorio: '', arquivo: caminho }
    : {
        diretorio: caminho.slice(0, separador + 1),
        arquivo: caminho.slice(separador + 1),
      };
}
