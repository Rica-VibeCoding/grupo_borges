'use client';

/**
 * O recado do anexo, abaixo do composer. Saiu de `gaveta-anexo.tsx` (02/10)
 * inteiro, com os comentários — lá ficam o "+" e a gaveta.
 */
import type { EstadoAnexo } from '../../lib/usa-anexo';
import { IconeDescartar } from './icones';

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
  // `escolhido` não fala aqui: quem anuncia o arquivo retido é a miniatura
  // dentro da caixa, e uma linha de texto dizendo o mesmo seria eco.
  if (estado.fase === 'ocioso' || estado.fase === 'escolhido') return null;

  // O não confirmado fala no mesmo âmbar do erro e se dispensa do mesmo jeito,
  // como a faixa do texto.
  const erro = estado.fase === 'erro' || estado.fase === 'nao-confirmado';
  const texto =
    estado.fase === 'enviando'
      ? `Enviando ${estado.arquivo.name}…`
      : estado.fase === 'erro' || estado.fase === 'nao-confirmado'
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
          prazo. Botão para fechar algo que já ia fechar é controle a mais.
          Dispensar fecha o RECADO e não solta o arquivo — desistir da foto é o
          × da miniatura, que é outro gesto e está a um dedo daqui. */}
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
