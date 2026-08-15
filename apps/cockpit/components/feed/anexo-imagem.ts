/**
 * O envelope continua sendo o contrato entre o backend e o agente; esta camada
 * só o traduz para apresentação. O caminho absoluto nunca chega ao DOM.
 *
 * Formato produzido por `_agent_file_message`:
 *   Imagem enviada via cockpit:
 *   /.../uploads/agents/<slug>/<arquivo>
 *   Caption: <legenda opcional, inclusive com novas linhas>
 *
 * O CC anexa a imagem por conta própria e o envelope chega picado em DUAS
 * mensagens (medido 08/08): a primeira perde a linha que cita a imagem e ganha
 * o prefixo `[Image #N]` — às vezes sobra só `[Image #N]Caption: …` —, e a
 * segunda é uma linha só, `[Image: source: /caminho>]`, com o caminho de volta.
 * Por isso `filename` e `legenda` chegam separados: cada metade traz uma.
 *
 * Pôr o nome do arquivo no cabeçalho NÃO resolve — foi tentado e o CC comeu a
 * linha do cabeçalho junto, por citar a imagem.
 */

export type AnexoImagem = {
  /** `null` quando o CC engoliu o caminho e só a legenda sobreviveu. */
  filename: string | null;
  legenda: string | null;
};

/** A metade que tem foto para desenhar. */
export type AnexoComFoto = AnexoImagem & { filename: string };

/** Prefixo que o CC cola no texto ao anexar a imagem sozinho. */
const MARCADOR_DE_ANEXO = /^\[Image #\d+]/;

/** A linha que ele grava DEPOIS da mensagem, com o caminho de origem. */
const MARCADOR_DE_ORIGEM = /^\[Image: source: (.+)]$/;

const ABERTURA = /^Imagem enviada via cockpit:/i;

/** A linha inteira tem de ser o caminho: com `(?:^|[\\/])` bastava TERMINAR nele,
 * e "olha este arquivo /…/uploads/agents/daniel/x.png" virava cartão de foto com
 * a fala do Rica engolida (auditoria de 09/08). */
const CAMINHO_DO_UPLOAD =
  /^(?:\S*[\\/])?uploads[\\/]agents[\\/][^\\/\s]+[\\/]([^\\/\s]+\.(?:jpg|png|webp))$/i;

/** A outra forma de "linha inteira é a imagem": uma URL já pronta, sem passar
 *  pelo disco de uploads (data-URL em base64). Quem manda a foto embutida na
 *  própria mensagem — hoje só a Tara, `lib/codex/adapta-mensagens.ts` — usa
 *  esta linha em vez do caminho relativo; `urlDoAnexoImagem` reconhece o
 *  prefixo e devolve a URL direto, sem montar rota de arquivo. */
const URL_DE_IMAGEM_EMBUTIDA = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i;

const LEGENDA = /^Caption:[ \t]*([\s\S]*)$/;

/** Só reconhece o envelope inteiro. Texto comum que apenas menciona o prefixo
 * continua sendo fala do Rica, sem desaparecer dentro de uma imagem. */
export function leAnexoImagem(texto: string): AnexoImagem | null {
  const origem = texto.trim().match(MARCADOR_DE_ORIGEM);
  if (origem) {
    // Imagem lida de fora de `uploads/` (um Read do próprio agente) não tem
    // rota que a sirva: sem nome nem legenda, o item não desenha nada.
    return { filename: origem[1]?.match(CAMINHO_DO_UPLOAD)?.[1] ?? null, legenda: null };
  }

  const linhas = texto.split(/\r?\n/);
  const anexada = MARCADOR_DE_ANEXO.test(linhas[0] ?? '');
  if (anexada) linhas[0] = (linhas[0] ?? '').replace(MARCADOR_DE_ANEXO, '');

  // Cabeçalho e caminho são do envelope, não da fala: saem os dois quando
  // estão lá. Depois do CC, pode não ter sobrado nenhum dos dois.
  if (ABERTURA.test(linhas[0] ?? '')) linhas.shift();
  const primeiraLinha = (linhas[0] ?? '').trim();
  const filename =
    primeiraLinha.match(CAMINHO_DO_UPLOAD)?.[1]
    ?? (URL_DE_IMAGEM_EMBUTIDA.test(primeiraLinha) ? primeiraLinha : null);
  if (filename) linhas.shift();
  if (!anexada && !filename) return null;

  const resto = linhas.join('\n');
  if (!resto) return { filename, legenda: null };

  const legenda = resto.match(LEGENDA);
  // Sem `Caption:` e sem o prefixo do CC, o que sobrou não é envelope nenhum.
  if (!legenda) return anexada ? { filename, legenda: resto } : null;
  return { filename, legenda: legenda[1]?.trim() || null };
}

export function urlDoAnexoImagem(agentSlug: string, filename: string): string {
  // A URL embutida já é a imagem — não existe rota de arquivo pra montar em
  // cima dela, e `encodeURIComponent` destruiria o `data:` codificando as
  // barras e o `+`/`=` do base64.
  if (URL_DE_IMAGEM_EMBUTIDA.test(filename)) return filename;
  return `/api/agents/${encodeURIComponent(agentSlug)}/file/${encodeURIComponent(filename)}`;
}
