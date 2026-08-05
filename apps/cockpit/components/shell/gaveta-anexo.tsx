'use client';

/**
 * O "+" do composer e a gaveta que ele abre.
 *
 * Três itens — Foto, Vídeo, Documento — e nada além disso. A referência que o
 * Rica mandou (o menu do ChatGPT) tem oito linhas porque é o ChatGPT; o que ele
 * pediu foi *"apenas foto, vídeo e doc"*. Cada linha carrega ícone, rótulo e
 * uma descrição secundária mais apagada ao lado, que é o formato da referência
 * — e aqui a descrição não é enfeite: ela diz os formatos e o teto, que é a
 * informação que evita uma viagem perdida ao picker.
 *
 * UM INPUT SÓ, com o `accept` trocado antes do clique. Três inputs escondidos
 * seriam três nós para manter em sincronia, e o `accept` é a única coisa que
 * muda entre eles. A troca é IMPERATIVA (`ref.current.accept = ...`) de
 * propósito: `setState` seguido de `.click()` abriria o picker com o `accept`
 * do render ANTERIOR, porque o React ainda não pintou o novo — e no iPhone o
 * clique precisa acontecer dentro do mesmo gesto do usuário, sem esperar frame.
 *
 * A ANIMAÇÃO NÃO MORA AQUI. É `.ck-surge` + `.ck-gaveta-acima` do `globals.css`,
 * a mesma das gavetas laterais; este arquivo só vira `data-aberto`. E o nó fica
 * SEMPRE montado — desmontar mataria a saída, que é a decisão já documentada em
 * `superficie-otimista.tsx`.
 *
 * BOTÃO E PAINEL SÃO DUAS PEÇAS por um motivo de layout, não de gosto: o `form`
 * do composer tem `overflow: hidden` (é o que recorta a ponta do fio na base), e
 * um painel que sobe a partir de dentro dele seria recortado no primeiro pixel.
 * O botão fica dentro da caixa, onde ele mora; o painel fica no invólucro de
 * fora, que é quem lhe dá a âncora do `position: relative`.
 */
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';

import { ITENS_DA_GAVETA, type EspecieAnexo } from '../../lib/anexo';
import type { EstadoAnexo } from '../../lib/usa-anexo';
import { IconeAnexo, IconeDescartar, IconeDocumento, IconeFoto, IconeVideo } from './icones';

const ICONE_DO_ITEM: Record<EspecieAnexo, (props: { tamanho: number }) => React.ReactElement> = {
  image: IconeFoto,
  video: IconeVideo,
  document: IconeDocumento,
};

const ESTILO_ITEM: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--ck-space-2)',
  width: '100%',
  minHeight: 'var(--ck-touch-min)',
  padding: 'var(--ck-space-2) var(--ck-space-3)',
  borderRadius: 'var(--ck-radius-chip)',
  color: 'var(--ck-text-primary)',
  fontSize: 'var(--ck-text-sm)',
  textAlign: 'left',
};

/** O "+" — mora DENTRO da caixa do composer, no canto onde ele sempre esteve. */
export function BotaoAnexo({
  estado,
  alternarGaveta,
  desabilitado,
  botaoRef,
}: {
  estado: EstadoAnexo;
  alternarGaveta: () => void;
  /** O composer está travado por outro motivo (compact, envio de texto em voo). */
  desabilitado: boolean;
  botaoRef: RefObject<HTMLButtonElement | null>;
}) {
  const aberta = estado.gaveta;

  return (
    <button
      ref={botaoRef}
      type="button"
      onClick={alternarGaveta}
      disabled={desabilitado || estado.fase === 'enviando'}
      aria-label={aberta ? 'Fechar anexos' : 'Anexar arquivo'}
      aria-haspopup="menu"
      aria-expanded={aberta}
      data-selecionado={aberta ? 'true' : 'false'}
      className="ck-veil flex shrink-0 items-center justify-center disabled:opacity-40"
      style={{
        minWidth: 'var(--ck-touch-min)',
        minHeight: 'var(--ck-touch-min)',
        marginLeft: 'calc(var(--ck-space-2) * -1)',
        marginBottom: 'calc(var(--ck-space-2) * -1)',
        borderRadius: 'var(--ck-radius-chip)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      {/* O "+" gira 45° e vira "×" com a gaveta aberta: o mesmo controle que
          abre é o que fecha, e a rotação diz isso sem uma segunda peça na tela.

          QUEM GIRA É O ÍCONE, NUNCA O BOTÃO. Girar o botão leva junto o fundo
          do `ck-veil` — que com a gaveta aberta está pintado por
          `data-selecionado` — e o retângulo vira um losango claro de 44px no
          canto do composer. O alvo de toque é área de dedo, não desenho.

          `--ck-dur-fast` porque isto é press, não entrada de superfície. */}
      <span
        className="flex items-center justify-center"
        style={{
          transform: aberta ? 'rotate(45deg)' : undefined,
          transition: 'transform var(--ck-dur-fast) var(--ck-ease)',
        }}
      >
        <IconeAnexo tamanho={17} />
      </span>
    </button>
  );
}

export type PainelAnexoProps = {
  estado: EstadoAnexo;
  /** O texto digitado AGORA — vira o `caption` do arquivo. */
  legenda: string;
  fecharGaveta: () => void;
  enviar: (arquivo: File, caption: string) => Promise<boolean>;
  /** Chamado só quando o arquivo chegou ao agente: o campo esvazia, igual ao
   *  envio de texto. Num 422 o texto FICA — perder a legenda porque o arquivo
   *  era grande demais seria cobrar duas vezes pelo mesmo erro. */
  aoEnviar: () => void;
  botaoRef: RefObject<HTMLButtonElement | null>;
};

/** Véu + gaveta + o input escondido. Mora FORA do `form` (ver o cabeçalho). */
export function PainelAnexo({
  estado,
  legenda,
  fecharGaveta,
  enviar,
  aoEnviar,
  botaoRef,
}: PainelAnexoProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const aberta = estado.gaveta;

  // `Escape` fecha e DEVOLVE O FOCO ao "+". Sem devolver, o Tab seguinte cairia
  // no começo do documento — a gaveta some e leva o foco junto.
  useEffect(() => {
    if (!aberta) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== 'Escape') return;
      evento.stopPropagation();
      fecharGaveta();
      botaoRef.current?.focus();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberta, fecharGaveta]);

  function escolher(accept: string) {
    const input = inputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }

  async function aoEscolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    // Zerar o valor SEMPRE: sem isto, escolher o mesmo arquivo duas vezes
    // seguidas não dispara `change` na segunda, e o botão parece morto.
    evento.target.value = '';
    if (!arquivo) return;
    if (await enviar(arquivo, legenda)) aoEnviar();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={aoEscolherArquivo}
        // Um arquivo por vez nesta rodada: a rota `/file` recebe um `file` só, e
        // fila de upload é uma máquina de estados inteira que ninguém pediu.
        multiple={false}
      />

      {/* O véu não escurece — ordem do Rica de 30/07, com prints. Ele existe só
          como alvo de clique para fechar, e o `ck-surge-veu` o esconde com
          `visibility: hidden` quando fechado, então não intercepta nada fora
          da gaveta aberta. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={fecharGaveta}
        data-aberto={String(aberta)}
        className="ck-surge-veu fixed inset-0"
        style={{ zIndex: 'var(--ck-z-drawer)', cursor: 'default' }}
      />

      <div
        role="menu"
        aria-label="Anexar ao agente"
        data-aberto={String(aberta)}
        inert={!aberta}
        className="ck-surge ck-gaveta-acima flex flex-col"
        style={{
          background: 'var(--ck-surface-nav)',
          padding: 'var(--ck-space-1)',
          gap: '2px',
        }}
      >
        {ITENS_DA_GAVETA.map((item) => {
          const Icone = ICONE_DO_ITEM[item.especie];
          return (
            <button
              key={item.especie}
              type="button"
              role="menuitem"
              onClick={() => escolher(item.accept)}
              className="ck-veil"
              style={ESTILO_ITEM}
            >
              <span
                className="flex shrink-0 items-center"
                style={{ color: 'var(--ck-text-secondary)' }}
              >
                <Icone tamanho={16} />
              </span>
              <span className="shrink-0">{item.rotulo}</span>
              {/* A descrição vive NA MESMA LINHA e mais apagada, como na
                  referência — segunda linha empilhada engordaria a gaveta ao
                  triplo da altura por informação que é consulta, não leitura. */}
              <span
                className="truncate"
                style={{ color: 'var(--ck-text-tertiary)', fontSize: 'var(--ck-text-xs)' }}
              >
                {item.descricao}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * A linha de estado do anexo, FORA da caixa — mesmo lugar e mesma régua do
 * aviso da voz. Três coisas para dizer, e nunca duas ao mesmo tempo:
 *
 * - subindo: o nome do arquivo, porque um vídeo demora e a tela não pode ficar
 *   muda;
 * - erro: a frase do backend inteira — "mime não suportado", "imagem maior que
 *   10MB". Um "falhou" genérico obriga a tentar de novo às cegas;
 * - sucesso: confirmação curta, que some sozinha (§7 — sucesso é silêncio).
 */
export function AvisoAnexo({
  estado,
  aoDispensar,
}: {
  estado: EstadoAnexo;
  aoDispensar: () => void;
}) {
  if (estado.fase === 'ocioso') return null;

  const erro = estado.fase === 'erro';
  const texto =
    estado.fase === 'enviando'
      ? `Enviando ${estado.nome}…`
      : erro
        ? `${estado.nome}: ${estado.motivo}`
        : `${estado.nome} entregue`;

  return (
    <div
      className="mx-auto flex w-full items-start justify-between"
      style={{
        maxWidth: 'var(--ck-w-composer)',
        padding: '0 var(--ck-space-2)',
        gap: 'var(--ck-space-3)',
      }}
    >
      <span
        role="status"
        aria-live={erro ? 'assertive' : 'polite'}
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: erro ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)',
        }}
      >
        {texto}
      </span>
      {/* Só o erro se dispensa: o "enviando" acaba sozinho e o sucesso some no
          prazo. Botão para fechar algo que já ia fechar é controle a mais. */}
      {erro ? (
        <button
          type="button"
          onClick={aoDispensar}
          aria-label="Dispensar aviso do anexo"
          className="ck-veil flex shrink-0 items-center"
          style={{
            padding: '4px',
            borderRadius: 'var(--ck-radius-chip)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          <IconeDescartar tamanho={13} />
        </button>
      ) : null}
    </div>
  );
}
