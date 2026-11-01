/**
 * O `/voltar` do composer: o rewind do Claude Code dirigido pelo cockpit.
 * Lógica pura — leitura da lista de pontos, opções de cada ponto, a hora que
 * aparece na linha e a frase de cada erro da API. O modal só desenha.
 *
 * Contrato: GET `/api/agents/{slug}/rewind/pontos` e POST `/api/agents/{slug}/rewind`
 * (`apps/api/routers/agents.py`, `apps/api/services/rewind.py`).
 */

export type PontoDeVolta = {
  id: string;
  texto: string;
  horario: string | null;
  arquivo_editado_depois: boolean;
};

export type AcaoDeVolta =
  | 'conversa_e_codigo'
  | 'conversa'
  | 'codigo'
  | 'resumir_daqui'
  | 'resumir_ate_aqui';

/** `desfazArquivo`: a opção mexe no disco, não só na conversa — pede segundo toque. */
export type OpcaoDeVolta = { acao: AcaoDeVolta; rotulo: string; desfazArquivo: boolean };

function ePonto(valor: unknown): valor is PontoDeVolta {
  if (typeof valor !== 'object' || valor === null) return false;
  const ponto = valor as Partial<PontoDeVolta>;
  return (
    typeof ponto.id === 'string' &&
    typeof ponto.texto === 'string' &&
    (typeof ponto.horario === 'string' || ponto.horario === null || ponto.horario === undefined) &&
    typeof ponto.arquivo_editado_depois === 'boolean'
  );
}

/** Lê o corpo do GET. Item malformado sai da lista; corpo sem `pontos` é erro. */
export function lerPontos(corpo: unknown): PontoDeVolta[] {
  const pontos = (corpo as { pontos?: unknown } | null)?.pontos;
  if (!Array.isArray(pontos)) throw new Error('rewind: resposta sem pontos');
  return pontos.filter(ePonto).map((p) => ({ ...p, horario: p.horario ?? null }));
}

/**
 * Primeiro as que só mexem na conversa, depois — num bloco à parte — as que
 * desfazem arquivo no disco. O menu do Claude Code põe "conversa e código" no
 * topo; aqui a que não volta atrás fica longe do polegar. As duas de código só
 * existem quando houve edição depois do ponto — a API recusa sem
 * (`acao_indisponivel`).
 */
export function opcoesDoPonto(ponto: PontoDeVolta): OpcaoDeVolta[] {
  const opcoes: OpcaoDeVolta[] = [
    { acao: 'conversa', rotulo: 'Só a conversa', desfazArquivo: false },
    { acao: 'resumir_daqui', rotulo: 'Resumir daqui pra frente', desfazArquivo: false },
    { acao: 'resumir_ate_aqui', rotulo: 'Resumir até aqui', desfazArquivo: false },
  ];
  if (ponto.arquivo_editado_depois) {
    opcoes.push(
      { acao: 'conversa_e_codigo', rotulo: 'Conversa e código', desfazArquivo: true },
      { acao: 'codigo', rotulo: 'Só o código', desfazArquivo: true },
    );
  }
  return opcoes;
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** `14:05` hoje, `ontem 14:05`, `30/10 14:05` antes disso. Sem hora, vazio. */
export function horaDoPonto(horario: string | null, agora: Date = new Date()): string {
  if (!horario) return '';
  const quando = new Date(horario);
  if (Number.isNaN(quando.getTime())) return '';
  const hora = `${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}`;
  if (mesmoDia(quando, agora)) return hora;
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(quando, ontem)) return `ontem ${hora}`;
  return `${doisDigitos(quando.getDate())}/${doisDigitos(quando.getMonth() + 1)} ${hora}`;
}

const FRASE_DO_ERRO: Record<string, string> = {
  agente_ocupado: 'O agente está trabalhando. Espere ele terminar e tente de novo.',
  campo_ocupado: 'Tem texto esperando no campo do agente. Esvazie e tente de novo.',
  troca_de_conversa_em_curso: 'Uma troca de conversa está em andamento. Tente em instantes.',
  sem_conversa_atual: 'Este agente não tem conversa aberta.',
  acao_indisponivel: 'Essa opção não vale pra esse ponto. Escolha outra.',
  acao_nao_encontrada: 'Essa opção não vale pra esse ponto. Escolha outra.',
  ponto_inexistente: 'Esse ponto não existe mais. A lista foi atualizada.',
  ponto_nao_encontrado: 'Esse ponto não existe mais. A lista foi atualizada.',
  tmux_busy: 'O terminal do agente está ocupado. Tente de novo.',
  sessao_ausente: 'O terminal do agente não está aberto.',
};

const FRASE_PADRAO = 'O Claude Code não confirmou a volta. Confira o agente antes de tentar de novo.';

/** Erros em que a lista na tela ficou velha e precisa ser relida. */
export function erroPedeReleitura(detalhe: string | null): boolean {
  return detalhe === 'ponto_inexistente' || detalhe === 'ponto_nao_encontrado';
}

/** `detail` da API → frase pro Rica. `null` é falha de rede. */
export function fraseDoErro(detalhe: string | null): string {
  if (detalhe === null) return 'Sem conexão com o servidor. Tente de novo.';
  return FRASE_DO_ERRO[detalhe] ?? FRASE_PADRAO;
}

/** Corpo do 200 do POST. Só o texto interessa pro composer. */
export function textoRestaurado(corpo: unknown): string | null {
  const texto = (corpo as { texto_restaurado?: unknown } | null)?.texto_restaurado;
  return typeof texto === 'string' && texto.length > 0 ? texto : null;
}

/** O `detail` de um corpo de erro do FastAPI, se for texto. */
export function detalheDoErro(corpo: unknown): string | null {
  const detalhe = (corpo as { detail?: unknown } | null)?.detail;
  return typeof detalhe === 'string' ? detalhe : null;
}
