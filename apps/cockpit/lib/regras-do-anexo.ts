/**
 * As regras do anexo — "este arquivo passa?", respondida antes do primeiro byte.
 * Quem sobe e lê a resposta do backend é o `anexo.ts`.
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
