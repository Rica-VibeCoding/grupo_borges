'use client';

/**
 * A MINIATURA DO ANEXO RETIDO — dentro da caixa do composer, acima do campo.
 *
 * O composer CRESCE por causa dela; ela não flutua nem sobrepõe o campo. É o
 * que a referência do Rica mostra e é o que separa "o arquivo está aqui" de
 * "algo passou pela tela".
 *
 * O MOVIMENTO É O DA CASA (`.ck-miniatura` em `globals.css`, mesmos tokens e
 * mesmo `data-aberto` do `.ck-surge`) e nenhuma linha dele mora aqui. O nó fica
 * SEMPRE montado — elemento removido não anima a saída, §17 da estética — e
 * quem some é a altura, em `0s`, depois do fade. Por isso este arquivo não tem
 * `setTimeout`, não tem `requestAnimationFrame` e não sabe quanto dura nada.
 *
 * O ARQUIVO MOSTRADO SOBREVIVE À REMOÇÃO. Quando o Rica toca no ×, o estado
 * volta para `ocioso` no mesmo instante — se a miniatura lesse só o estado, ela
 * ficaria sem imagem no primeiro frame da saída e o que sairia animando seria
 * um quadrado vazio. Guardamos o último arquivo visto e ele só é trocado pelo
 * PRÓXIMO, nunca apagado.
 */
import { useCallback, useState } from 'react';

import type { EspecieAnexo } from '../../lib/anexo';
import { arquivoRetido, type EstadoAnexo, type Retido } from '../../lib/usa-anexo';
import { IconeDescartar, IconeDocumento, IconeVideo } from './icones';

/**
 * ~146px é a medida da referência (05/08), e ela é 20% da largura do composer
 * (`--ck-w-composer: 768px`) — o mesmo quadrado no iPhone seria quase metade da
 * altura útil da caixa com o teclado aberto. A porcentagem preserva a PROPORÇÃO
 * da referência onde a tela é estreita, e o teto entrega o número medido no
 * desktop. Não é valor escolhido a olho: os dois lados vêm da mesma captura.
 */
const LARGURA = 'min(20%, 146px)';

const ICONE_DA_ESPECIE: Record<
  Exclude<EspecieAnexo, 'image'>,
  (props: { tamanho: number }) => React.ReactElement
> = {
  video: IconeVideo,
  document: IconeDocumento,
};

export function MiniaturaAnexo({
  estado,
  aoRemover,
}: {
  estado: EstadoAnexo;
  aoRemover: () => void;
}) {
  // A foto fica na tela do primeiro toque até a entrega — ela atravessa
  // `escolhido`, `enviando` e o `erro` de upload, que são as três fases que
  // seguram o arquivo. Fechar a miniatura assim que o upload começa daria ao
  // olho a impressão de que a foto já foi, e no 422 ele não teria o que
  // reenviar.
  const retido = arquivoRetido(estado);
  const emVoo = estado.fase === 'enviando';
  // A recusa de entrega (ex: 200 com `tmux_delivered:false` por input ocupado)
  // segura a foto com um MOTIVO — e o motivo mora aqui, na miniatura, porque o
  // aviso da faixa fica abaixo do composer, atrás do teclado no iPhone.
  const erro = estado.fase === 'erro';

  // Ajuste de estado durante o render, que é o caminho documentado do React
  // para derivar de prop sem um efeito no meio: um efeito pintaria o quadrado
  // vazio antes de corrigir.
  const [mostrado, setMostrado] = useState<Retido | null>(retido);
  const [origem, setOrigem] = useState<File | null>(retido?.arquivo ?? null);
  if (retido && retido.arquivo !== origem) {
    setOrigem(retido.arquivo);
    setMostrado(retido);
  }

  /**
   * O preview nasce e morre com o NÓ, pelo cleanup do callback de `ref` do
   * React 19 — e não dentro do render, que é o vazamento clássico: uma URL nova
   * por render, o cache sem saber que são a mesma imagem, e a foto piscando.
   *
   * Como a identidade do callback muda junto com o arquivo, trocar de foto
   * revoga a anterior e cria a nova no mesmo movimento. A URL do arquivo que o
   * Rica REMOVEU continua viva até a próxima escolha (é uma só, e revogar antes
   * do fade terminar arriscaria apagar a imagem que ainda está saindo).
   */
  const refPreview = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !mostrado || mostrado.especie !== 'image') return;
      const url = URL.createObjectURL(mostrado.arquivo);
      node.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [mostrado],
  );

  const Icone = mostrado && mostrado.especie !== 'image' ? ICONE_DA_ESPECIE[mostrado.especie] : null;

  return (
    <div className="ck-miniatura" data-aberto={String(retido !== null)}>
      <div style={{ position: 'relative', width: LARGURA }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            aspectRatio: '1',
            // Reservar a caixa antes de existir pixel evita o salto de layout
            // que o `aspect-ratio` sozinho não cobre quando a imagem demora.
            width: '100%',
            overflow: 'hidden',
            // O mesmo raio da caixa do composer: a miniatura é um pedaço dela,
            // não um cartão de outra família. Casa com os ~16px medidos.
            borderRadius: 'var(--ck-radius-caixa)',
            border: '1px solid var(--ck-edge-hairline)',
            borderColor: erro ? 'var(--ck-state-attention)' : undefined,
            background: 'var(--ck-surface-raised)',
          }}
        >
          {mostrado?.especie === 'image' ? (
            // `alt` com o nome do arquivo: sem `alt` o leitor de tela lê o nome
            // mesmo assim, e `alt=""` faria ele pular a imagem inteira.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={refPreview}
              alt={mostrado.arquivo.name || 'imagem anexada'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : Icone && mostrado ? (
            <div
              className="flex min-w-0 flex-col items-center"
              style={{ gap: 'var(--ck-space-1)', padding: 'var(--ck-space-2)' }}
            >
              <span style={{ color: 'var(--ck-text-secondary)' }}>
                <Icone tamanho={18} />
              </span>
              {/* Vídeo e documento não têm o que pré-visualizar, então o nome é
                  a única identificação — e ele é a que o Rica reconhece. */}
              <span
                className="w-full truncate text-center"
                style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}
              >
                {mostrado.arquivo.name}
              </span>
            </div>
          ) : null}
        </div>

        {/* O × é SEMPRE visível. Escondê-lo atrás de `:hover` é o padrão que os
            projetos de referência usam e que no iPhone nunca aparece — não há
            hover, e o alvo simplesmente não existe (WCAG 1.4.13 e 2.5.5).
            24px de pintura dentro de 44px de área: a área é dedo, o desenho é
            olho. A pastilha opaca com borda é o que mantém o × legível sobre
            foto clara.

            SOME durante a subida, e só aí: o upload já está em voo e não há
            como chamá-lo de volta. Um × que some com a foto da tela e deixa o
            arquivo chegando ao agente mentiria sobre o que acabou de fazer. */}
        {emVoo ? null : (
        <button
          type="button"
          onClick={aoRemover}
          aria-label="Remover anexo"
          className="flex items-start justify-end"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 'var(--ck-touch-min)',
            minHeight: 'var(--ck-touch-min)',
            padding: 'var(--ck-space-1)',
          }}
        >
          <span
            className="ck-veil flex items-center justify-center"
            style={{
              width: '24px',
              height: '24px',
              borderRadius: 'var(--ck-radius-pill)',
              border: '1px solid var(--ck-edge-hairline)',
              background: 'var(--ck-surface-composer)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <IconeDescartar tamanho={12} />
          </span>
        </button>
        )}
      </div>

      {/* O MOTIVO DA RECUSA, ACIMA DO CAMPO. O aviso da faixa (AvisoAnexo) fica
          ABAIXO do composer — atrás do teclado no iPhone —, então a recusa que
          segura a foto deixava o Rica tocando às cegas. Aqui ele vê o porquê
          com o teclado aberto. `aria-hidden`: o anúncio é do AvisoAnexo
          (`role=status` + `aria-live`), que está no DOM; os dois juntos
          duplicariam o recado pro leitor de tela. */}
      {erro ? (
        <p
          aria-hidden
          style={{
            margin: 0,
            paddingTop: 'var(--ck-space-1)',
            fontSize: 'var(--ck-text-xs)',
            lineHeight: 1.4,
            color: 'var(--ck-state-attention)',
          }}
        >
          {estado.motivo}
        </p>
      ) : null}
    </div>
  );
}
