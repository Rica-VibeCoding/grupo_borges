/**
 * Anexo do composer — foto, vídeo e documento pro agente.
 *
 * Toda a decisão mora aqui fora do React porque as duas perguntas que este
 * arquivo responde são caras de errar e baratas de testar: "este arquivo passa?"
 * e "o que o backend recusou?".
 *
 * A VALIDAÇÃO É DUPLA DE PROPÓSITO. O backend valida de novo (e a palavra final
 * é dele — só ele lê o conteúdo real do arquivo), mas esperar 50 MB subirem
 * por Tailscale para receber um 422 de "mime não suportado" é o tipo de espera
 * que faz alguém desistir do gesto. O cliente barra o que dá para barrar antes
 * do primeiro byte; o servidor barra o que só ele sabe.
 *
 * CLASSIFICAR PELO MIME, CAIR PRA EXTENSÃO. `file.type` vem vazio ou errado com
 * frequência para `.md`, `.csv` e `.json` dependendo do sistema — o Windows
 * registra pelo que estiver instalado. Recusar por causa disso seria recusar
 * arquivo legítimo, então a extensão é o segundo voto. Quem lê o conteúdo de
 * verdade é o backend.
 */

export type EspecieAnexo = 'image' | 'video' | 'document';

type Regra = {
  especie: EspecieAnexo;
  /** Rótulo em português, usado na mensagem de erro. */
  rotulo: string;
  mimes: readonly string[];
  extensoes: readonly string[];
  tetoBytes: number;
  /** O teto escrito como o Rica lê — "10 MB", não "10485760". */
  tetoRotulo: string;
};

const MB = 1024 * 1024;

/**
 * Os tetos e formatos são o contrato do `POST /{slug}/file`. Manter em sincronia
 * com o backend: um teto de cliente MAIOR que o do servidor só adia o 422 (chato,
 * não quebrado); um teto MENOR recusa arquivo que o servidor aceitaria — este é
 * o erro grave, porque não existe caminho para o Rica contornar pela tela.
 */
export const REGRAS: readonly Regra[] = [
  {
    especie: 'image',
    rotulo: 'Foto',
    // HEIC é o formato padrão da câmera do iPhone e CHEGA aqui: o Safari só
    // converte pra JPEG no upload em parte dos caminhos, e as notas do Safari 27
    // beta registram a remoção dessa conversão. Recusar no cliente seria barrar
    // a foto antes de o backend ter chance de convertê-la, que é o que ele faz.
    mimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/heic-sequence',
      'image/heif-sequence',
    ],
    extensoes: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
    tetoBytes: 10 * MB,
    tetoRotulo: '10 MB',
  },
  {
    especie: 'video',
    rotulo: 'Vídeo',
    mimes: ['video/mp4', 'video/quicktime', 'video/webm'],
    extensoes: ['mp4', 'mov', 'webm'],
    // 50MB é o teto do transporte, não do disco: o Next bufferiza o corpo
    // inteiro em memória para fazer o proxy, e esta VPS tem 7GB. Barrar AQUI é
    // o que faz o vídeo grande morrer em 200ms na tela, com o motivo escrito,
    // em vez de subir 50MB por Tailscale para se partir no caminho.
    tetoBytes: 50 * MB,
    tetoRotulo: '50 MB',
  },
  {
    especie: 'document',
    rotulo: 'Documento',
    mimes: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    extensoes: ['pdf', 'txt', 'md', 'csv', 'json', 'docx', 'xlsx'],
    tetoBytes: 25 * MB,
    tetoRotulo: '25 MB',
  },
];

/**
 * O `accept` de cada item da gaveta — um input só, com o `accept` trocado
 * conforme o item escolhido.
 *
 * `image/*` e `video/*` em vez da lista fechada NÃO é descuido: é o que faz o
 * iOS oferecer a CÂMERA além da galeria. A MDN amarra as duas coisas na mesma
 * frase — *"Many mobile devices also let the user take a picture with the
 * camera when this is used"* — e não documenta o que acontece com uma lista de
 * mimes concretos. Perder a câmera do iPhone é caro e é certo; o ganho do outro
 * lado, não.
 *
 * A OUTRA METADE DESTE COMENTÁRIO MORREU EM 05/08: dizia que `image/*` também
 * fazia o Safari converter HEIC em JPEG no upload. É o contrário. A regra do
 * WebKit (bug 212489) transcodifica quando o `accept` traz um MIME CONCRETO que
 * o CoreGraphics saiba encodar, e `image/*` não é concreto — no macOS ele é
 * justamente o valor que devolve HEIC. Não se trocou o `accept` por causa
 * disso: quem passou a resolver HEIC é o backend, que converte na gravação e
 * não depende do que a Apple decidir na próxima versão.
 *
 * O tipo real ainda é conferido depois, pela `validaAnexo`.
 *
 * Os documentos vão por mime E por extensão porque o Windows entrega `.md` e
 * `.csv` com `type` vazio, e um `accept` só de mime esconde o arquivo no picker.
 */
export const ACCEPT_POR_ESPECIE: Record<EspecieAnexo, string> = {
  image: 'image/*',
  video: 'video/*',
  document: [
    ...REGRAS[2]!.mimes,
    ...REGRAS[2]!.extensoes.map((ext) => `.${ext}`),
  ].join(','),
};

/**
 * Os três itens da gaveta, nesta ordem. É a lista inteira — "apenas foto, vídeo
 * e doc", ordem do Rica. A descrição ao lado do rótulo é o que a referência do
 * ChatGPT faz com a linha secundária, e aqui ela carrega a informação que evita
 * uma viagem perdida ao picker: os formatos e o teto.
 */
export const ITENS_DA_GAVETA: readonly {
  especie: EspecieAnexo;
  rotulo: string;
  descricao: string;
  accept: string;
}[] = [
  {
    especie: 'image',
    rotulo: 'Foto',
    descricao: 'jpg, png, webp · até 10 MB',
    accept: ACCEPT_POR_ESPECIE.image,
  },
  {
    especie: 'video',
    rotulo: 'Vídeo',
    descricao: 'mp4, mov, webm · até 50 MB',
    accept: ACCEPT_POR_ESPECIE.video,
  },
  {
    especie: 'document',
    rotulo: 'Documento',
    descricao: 'pdf, texto, planilha · até 25 MB',
    accept: ACCEPT_POR_ESPECIE.document,
  },
];

/** O arquivo pelo que a validação precisa dele — `File` serve, e o teste não
 *  precisa de DOM para construir um. */
export type ArquivoParaAnexar = {
  name: string;
  type: string;
  size: number;
};

export function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  if (ponto <= 0 || ponto === nome.length - 1) return '';
  return nome.slice(ponto + 1).toLowerCase();
}

/** A regra que reconhece o arquivo, ou `null` se nenhuma reconhece. Mime tem
 *  precedência; a extensão é o voto de desempate quando o mime é vazio ou
 *  desconhecido. */
export function classificaAnexo(arquivo: ArquivoParaAnexar): Regra | null {
  const mime = arquivo.type.split(';')[0]!.trim().toLowerCase();
  const porMime = REGRAS.find((regra) => regra.mimes.includes(mime));
  if (porMime) return porMime;
  const ext = extensaoDe(arquivo.name);
  if (!ext) return null;
  return REGRAS.find((regra) => regra.extensoes.includes(ext)) ?? null;
}

export function formataTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
}

export type Veredito =
  | { ok: true; especie: EspecieAnexo }
  | { ok: false; motivo: string };

const FORMATOS_ACEITOS =
  'foto (jpg, png, webp, heic), vídeo (mp4, mov, webm) ou documento (pdf, txt, md, csv, json, docx, xlsx)';

/**
 * A mensagem diz QUAL das duas coisas falhou — tipo ou tamanho — e diz o número.
 * "Falhou" genérico obriga a tentar de novo às cegas, que foi exatamente a
 * reclamação que gerou esta rodada.
 */
export function validaAnexo(arquivo: ArquivoParaAnexar): Veredito {
  const regra = classificaAnexo(arquivo);
  if (!regra) {
    const ext = extensaoDe(arquivo.name);
    const oQue = ext ? `.${ext}` : arquivo.type || 'tipo desconhecido';
    return { ok: false, motivo: `${oQue} não é um tipo aceito — vale ${FORMATOS_ACEITOS}.` };
  }
  if (arquivo.size <= 0) {
    return { ok: false, motivo: 'Arquivo vazio.' };
  }
  if (arquivo.size > regra.tetoBytes) {
    return {
      ok: false,
      motivo: `${regra.rotulo} de ${formataTamanho(arquivo.size)} — o teto é ${regra.tetoRotulo}.`,
    };
  }
  return { ok: true, especie: regra.especie };
}

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

  constructor(mensagem: string, status?: number) {
    super(mensagem);
    this.name = 'ErroAnexo';
    this.status = status;
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
    throw new ErroAnexo('A conexão caiu durante o envio — confira no agente antes de repetir.');
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

  const dados = (await resposta.json()) as RespostaAnexo;
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
    );
  }
  return dados;
}
