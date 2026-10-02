/**
 * Anexo do composer — foto, vídeo e documento pro agente.
 *
 * Toda a decisão mora aqui fora do React porque as duas perguntas que este
 * arquivo responde são caras de errar e baratas de testar: "este arquivo passa?"
 * e "o que o backend recusou?". A primeira mora em `regras-do-anexo.ts` (tetos,
 * formatos, `accept` e a validação), reexportada daqui; a segunda é o resto
 * deste arquivo — o upload e a leitura do que o `/file` devolve.
 */

import { validaAnexo, type EspecieAnexo } from './regras-do-anexo.ts';

export {
  ACCEPT_POR_ESPECIE,
  ITENS_DA_GAVETA,
  REGRAS,
  classificaAnexo,
  formataTamanho,
  validaAnexo,
  type EspecieAnexo,
} from './regras-do-anexo.ts';

/** O estado do canal de entrega que o `/file` devolve junto (mesmo shape do
 *  `/painel`). Quem importa é a recusa: quando `tmux_delivered` é `false`, este
 *  campo é o que o backend ESCREVE sobre o porquê — ex: "input ocupado ou
 *  travado". Ausente numa API mais velha ou num proxy que trunque — daí ser
 *  opcional e lido defensivo. */
export type CanalEntregaDaResposta = {
  estado?: string;
  mensagem?: string;
};

export type RespostaAnexo = {
  path: string;
  kind: EspecieAnexo;
  filename: string;
  size: number;
  tmux_delivered: boolean;
  duration_ms: number;
  canal_entrega?: CanalEntregaDaResposta | null;
};

export class ErroAnexo extends Error {
  readonly status: number | undefined;
  /** `true` quando o arquivo PODE ter chegado: `tmux_delivered: false` sem
   *  recusa explicada, ou rede caindo depois do upload. É o `nao-confirmado` do
   *  texto — a bolha fica e o arquivo não volta para reenviar. */
  readonly incerto: boolean;
  /** A resposta do `/file` quando ela veio (o `tmux_delivered: false`): traz o
   *  nome gravado, que é o que a bolha otimista casa com o eco. */
  readonly resposta: RespostaAnexo | null;

  constructor(
    mensagem: string,
    status?: number,
    opcoes: { incerto?: boolean; resposta?: RespostaAnexo | null } = {},
  ) {
    super(mensagem);
    this.name = 'ErroAnexo';
    this.status = status;
    this.incerto = opcoes.incerto ?? false;
    this.resposta = opcoes.resposta ?? null;
  }
}

/**
 * O `detail` do FastAPI vem em três formas: string (o que o `/file` usa para
 * "mime não suportado"), lista de erros de validação do Pydantic, ou nada.
 * As três precisam virar uma frase — o objetivo desta função é que NUNCA sobre
 * um "falhou" sem causa na tela.
 */
export function detalheDoErro(corpo: unknown, alternativa: string): string {
  if (typeof corpo === 'string' && corpo.trim()) return corpo.trim();
  if (typeof corpo !== 'object' || corpo === null) return alternativa;
  const detail = (corpo as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const frases = detail
      .map((item) =>
        typeof item === 'object' && item !== null && typeof (item as { msg?: unknown }).msg === 'string'
          ? (item as { msg: string }).msg
          : null,
      )
      .filter((frase): frase is string => Boolean(frase));
    if (frases.length > 0) return frases.join('; ');
  }
  return alternativa;
}

/**
 * 5xx num upload quase nunca é recusa: é o envio se partindo no caminho —
 * proxy que trunca o corpo, socket que cai, backend que morreu no meio. Dizer
 * "o servidor recusou o arquivo (500)" mente duas vezes, e as duas mandam o
 * Rica para o lado errado: ele vai procurar o que há de errado com o ARQUIVO
 * quando o arquivo está bom, e vai culpar o backend quando o backend nem viu o
 * upload inteiro. Foi exatamente o que aconteceu com o .mov do iPhone em 04/08.
 *
 * Aqui repetir é a coisa certa a fazer, ao contrário do `tmux_delivered` falso:
 * transporte partido significa que nada chegou completo, então não há entrega
 * para duplicar.
 */
const RECADO_DE_TRANSPORTE =
  'O envio se partiu no caminho e o arquivo não chegou inteiro — pode tentar de novo.';

const RECADO_POR_STATUS: Record<number, string> = {
  404: 'Este agente não existe mais no backend.',
  409: 'A sessão do agente não está no ar — suba a sessão e tente de novo.',
  413: 'O arquivo passou do teto aceito pelo servidor.',
};

export type DependenciasAnexo = {
  fetch?: typeof globalThis.fetch;
};

/** A frase de operação que o backend escreveu sobre a última entrega, se ele a
 *  enviou. `null` quando ausente ou ilegível — o caso normal de uma API mais
 *  velha ou de um proxy que trunque a resposta. */
function fraseDoCanal(canal: unknown): string | null {
  if (typeof canal !== 'object' || canal === null) return null;
  const frase = (canal as { mensagem?: unknown }).mensagem;
  return typeof frase === 'string' && frase.trim() ? frase.trim() : null;
}

/**
 * Sobe UM arquivo. O `caption` é o que estava digitado no composer: vai junto no
 * mesmo multipart, não como mensagem separada — duas requisições dariam duas
 * entregas ao tmux e o agente veria a legenda antes ou depois do arquivo sem
 * ordem garantida.
 */
export async function enviaAnexo(
  slug: string,
  arquivo: File,
  caption: string,
  dependencias: DependenciasAnexo = {},
): Promise<RespostaAnexo> {
  const veredito = validaAnexo(arquivo);
  if (!veredito.ok) throw new ErroAnexo(veredito.motivo);

  const requisitar = dependencias.fetch ?? globalThis.fetch;
  const fd = new FormData();
  fd.append('file', arquivo, arquivo.name);
  const legenda = caption.trim();
  if (legenda) fd.append('caption', legenda);

  let resposta: Response;
  try {
    resposta = await requisitar(`/api/agents/${encodeURIComponent(slug)}/file`, {
      method: 'POST',
      body: fd,
    });
  } catch {
    // Rede caiu no meio: o arquivo PODE ter chegado. A frase não afirma que
    // não chegou — afirmar seria convidar a um reenvio duplicado.
    throw new ErroAnexo('A conexão caiu durante o envio — confira no agente antes de repetir.', undefined, {
      incerto: true,
    });
  }

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    // "Recusou" só vale para 4xx, que é o servidor tendo LIDO o arquivo e dito
    // não. 5xx não é veredito sobre o arquivo. Um `detail` de verdade no corpo
    // ainda ganha das duas frases — quando o backend explica, é ele quem manda.
    const alternativa =
      RECADO_POR_STATUS[resposta.status] ??
      (resposta.status >= 500
        ? RECADO_DE_TRANSPORTE
        : `O servidor recusou o arquivo (${resposta.status}).`);
    throw new ErroAnexo(detalheDoErro(corpo, alternativa), resposta.status);
  }

  let dados: RespostaAnexo;
  try {
    dados = (await resposta.json()) as RespostaAnexo;
  } catch {
    // O 200 chegou e o corpo se partiu: o upload terminou, a prova é que não
    // voltou inteira. Mesma incerteza da rede caindo.
    throw new ErroAnexo('A conexão caiu durante o envio — confira no agente antes de repetir.', resposta.status, {
      incerto: true,
    });
  }
  // `tmux_delivered: false` é o backend dizendo "NÃO CONSEGUI PROVAR", não "não
  // entregou". O `send_message` só devolve `true` com prova observável no pane
  // (input vazio ou linha transcrita, tetos de 8s e 6s), e pane em turno ativo
  // nunca mostra essa prova — o texto entra na fila do CC do mesmo jeito.
  // Medido em 04/08: 2 de 3 vídeos voltaram `false` e chegaram nas duas vezes,
  // com o agente confirmando no pane.
  //
  // Daí a frase ser de INCERTEZA e não de falha, e desaconselhar o reenvio: o
  // arquivo já está salvo com path válido, o agente alcança por ele, e reenviar
  // duplica a entrega. Cantar sucesso continua fora de questão — a tela não
  // afirma o que não sabe. Separar entregue / não confirmado / falhou é mudança
  // de contrato do backend, e está na `tropa_task`, não aqui.
  if (dados.tmux_delivered === false) {
    // `canal_entrega` (quando o backend o envia) diz que a entrega foi
    // RECUSADA e por quê — ex: "input ocupado ou travado". Aí o arquivo foi
    // salvo mas o agente não recebeu, e a saída é tentar de novo. Sem o campo,
    // fica a incerteza original: o texto PODE ter entrado, e reenviar duplicaria.
    const canal = fraseDoCanal(dados.canal_entrega);
    throw new ErroAnexo(
      canal
        ? `${canal} O arquivo ficou salvo, mas não chegou ao agente — toque em enviar de novo.`
        : 'enviado, mas não deu para confirmar que o agente viu. Não reenvie: o arquivo já está salvo e o agente alcança por ele — reenviar duplica.',
      resposta.status,
      // Recusa explicada pelo canal é falha: o agente não recebeu e o arquivo
      // volta para a mão. Sem ela, é ausência de prova.
      { incerto: canal === null, resposta: dados },
    );
  }
  return dados;
}
