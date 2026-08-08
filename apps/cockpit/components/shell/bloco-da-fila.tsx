'use client';

/**
 * O BLOCO DA FILA — o que foi escrito durante o compact, pendurado à vista.
 *
 * Mora ENTRE a `BarraCompact` e o composer, nunca dentro dele: o campo é o que
 * está sendo escrito AGORA, e a fila é o que já saiu das mãos. É também a
 * posição do Codex (`bottom_pane/pending_input_preview.rs`), entre o indicador
 * de trabalho e a caixa de entrada.
 *
 * ## A gramática é emprestada, e de propósito
 *
 * Bullet `• ` esmaecido, item `↳ ` esmaecido, o texto da fila em itálico e
 * secundário, teto de 3 linhas com o estouro virando reticência. Zero cor, zero
 * borda, zero fundo, zero pill: a hierarquia inteira é opacidade e itálico. É a
 * leitura literal do arquivo do Codex citado acima — a referência declarada do
 * v2 — e casa com a §9.7 daqui, onde cor é significado, não decoração. Um bloco
 * pendurado que não é problema nem erro não tem por que gastar cor nenhuma.
 *
 * O TEXTO aparece, não a contagem. "1 mensagem pendente" obriga o Rica a
 * lembrar o que ele escreveu para decidir se cancela — a régua de undo é
 * descrever com precisão a operação, não numerá-la.
 *
 * ## Movimento: `.ck-miniatura`, não `.ck-surge`
 *
 * As duas são o mesmo movimento da casa. A diferença é que a `.ck-surge` supõe
 * `position: fixed` — está escrito na justificativa dela em `globals.css:522`,
 * "não custa layout: os dois elementos são `position: fixed`". Este bloco é de
 * FLUXO e empurra o composer: com a `.ck-surge`, o nó sempre montado (que a
 * saída animada exige) reservaria altura o tempo inteiro com nada dentro. A
 * `.ck-miniatura` é a variante que a casa já escreveu para exatamente isso — a
 * miniatura do anexo, também em fluxo, também dentro do composer: `max-height`
 * colapsando em `0s` DEPOIS do fade. Nenhum keyframe novo, nenhum
 * `@starting-style` (proibido aqui desde 02/08), nenhuma linha de CSS nova.
 *
 * ## Onde o anúncio ganha do movimento
 *
 * `role="status"` só é anunciado se o nó estiver montado e VAZIO antes de o
 * texto chegar — e nó com `visibility: hidden` não existe para leitor de tela.
 * As duas coisas não cabem no mesmo elemento: para animar a entrada ele precisa
 * nascer escondido, e para anunciar precisa nascer visível. Então a FRASE fica
 * fora do `.ck-miniatura`, sempre montada e sempre visível (vazia, ela não tem
 * altura), e quem anima é o corpo do bloco. O bug antigo era outro e pior: o
 * `span` do aviso nascia JUNTO com a frase (`composer.tsx:733`), então é bem
 * provável que nunca tenha sido anunciado por leitor nenhum.
 *
 * Os controles ficam FORA da região viva: `role="status"` tem `aria-atomic:
 * true` implícito, e um botão lá dentro faria o leitor reler o rótulo dele a
 * cada mudança da frase.
 */
import type { CSSProperties } from 'react';

import type { EstadoDaFila, ItemDaFila } from './fila-de-envio';
import { recadoDaFila } from './fila-de-envio';

/** O teto do Codex (`PREVIEW_LINE_LIMIT = 3`). Acima disso a fila roubaria a
 *  tela de quem está lendo a resposta do agente. */
const TETO_DE_LINHAS = 3;

const TRECHO: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: TETO_DE_LINHAS,
  overflow: 'hidden',
  fontSize: 'var(--ck-text-xs)',
  fontStyle: 'italic',
  color: 'var(--ck-text-tertiary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const MARCA: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--ck-text-xs)',
  color: 'var(--ck-text-tertiary)',
};

const BOTAO: CSSProperties = {
  flexShrink: 0,
  minHeight: 'var(--ck-touch-min)',
  padding: '0 var(--ck-space-2)',
  borderRadius: 'var(--ck-radius-chip)',
  fontSize: 'var(--ck-text-xs)',
  color: 'var(--ck-text-secondary)',
};

/** Rótulo acessível do controle. O texto visível ("editar") entra inteiro no
 *  nome, que é o que a WCAG 2.5.3 pede de quem fala com o aparelho: quem diz
 *  "toque em editar" precisa acertar o alvo. O trecho vai junto porque numa
 *  fila de duas ou três, "editar" sozinho não diz editar o quê. */
function rotulaEditar(texto: string): string {
  const trecho = texto.trim().split('\n')[0] ?? '';
  return `Editar e tirar da fila: ${trecho.length > 40 ? `${trecho.slice(0, 40)}…` : trecho}`;
}

function Linha({
  item,
  aoEditar,
}: {
  item: ItemDaFila;
  aoEditar: (id: string) => void;
}) {
  return (
    <li className="flex items-start" style={{ gap: 'var(--ck-space-1)' }}>
      <span aria-hidden style={MARCA}>
        ↳
      </span>
      <span style={{ ...TRECHO, flex: 1, minWidth: 0 }}>{item.texto}</span>
      <button
        type="button"
        onClick={() => aoEditar(item.id)}
        aria-label={rotulaEditar(item.texto)}
        className="ck-veil flex items-center"
        style={BOTAO}
      >
        editar
      </button>
    </li>
  );
}

export function BlocoDaFila({
  estado,
  aoEditar,
  aoForcar,
}: {
  estado: EstadoDaFila;
  /** Tira da fila e devolve o texto ao campo. Não existe descarte: cancelar e
   *  editar são o mesmo gesto, e o que sai da fila volta para as mãos dele. */
  aoEditar: (id: string) => void;
  /** Só no estado pausado — o Rica assume o envio que a máquina não assume. */
  aoForcar: () => void;
}) {
  const aberto = estado.itens.length > 0;
  const recado = recadoDaFila(estado);

  return (
    <div
      className="ck-sobre-material mx-auto w-full"
      style={{ maxWidth: 'var(--ck-w-composer)', padding: '0 var(--ck-space-2)' }}
    >
      <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <span role="status" aria-live="polite" style={{ ...MARCA, flex: 1, minWidth: 0 }}>
          {/* A bolinha entra com a frase, nunca sozinha: um bullet perdido numa
              região viva vazia é ruído que o leitor de tela anuncia à toa. */}
          {aberto ? `• ${recado}` : ''}
        </span>
        {aberto && estado.pausa !== null ? (
          <button
            type="button"
            onClick={aoForcar}
            className="ck-veil flex items-center"
            style={BOTAO}
          >
            enviar mesmo assim
          </button>
        ) : null}
      </div>

      <ul
        className="ck-miniatura flex flex-col"
        data-aberto={aberto ? 'true' : 'false'}
        style={{
          // `inherit` pega o teto do `.ck-miniatura` sem repetir o número: uma
          // fila longa rola por dentro em vez de ser decepada.
          maxHeight: 'inherit',
          overflowY: 'auto',
          gap: 'var(--ck-space-1)',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {estado.itens.map((item) => (
          <Linha key={item.id} item={item} aoEditar={aoEditar} />
        ))}
      </ul>
    </div>
  );
}
