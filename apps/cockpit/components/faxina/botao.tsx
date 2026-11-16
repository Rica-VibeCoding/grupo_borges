// O botão da Faxina, exportado para a tela Aprendizado. O jeito da Faxina é o
// padrão: fio `hairline`, texto secundário e, em `destaque`, fundo `raised`.
// O Aprendizado liga o que só ele usa — `contorno` (ação do momento, como
// Desfazer), `perigo` (confirmar a poda: fio e texto em `--ck-state-fail`, sem
// preenchimento — a casa não tem token de texto sobre cor de estado), `focar`
// e `fio` (o foco por fio cinza do `.ck-foco-fio`). Ocupado mantém o rótulo e
// só esmaece.

export function Botao({
  rotulo,
  onClick,
  destaque = false,
  contorno = false,
  perigo = false,
  desabilitado = false,
  focar = false,
  fio = false,
}: {
  rotulo: string;
  onClick: () => void;
  destaque?: boolean;
  contorno?: boolean;
  perigo?: boolean;
  /** Pedido em voo: desabilita e avisa o leitor de tela que está ocupado. */
  desabilitado?: boolean;
  /** Recebe o foco ao nascer: o controle que ele substitui saiu da tela. */
  focar?: boolean;
  /** Foco de teclado por fio cinza + véu (§9.17). */
  fio?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-busy={desabilitado || undefined}
      autoFocus={focar || undefined}
      className={fio ? 'ck-aperta ck-foco-fio' : 'ck-aperta'}
      style={{
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        fontWeight: perigo ? 500 : undefined,
        background: destaque ? 'var(--ck-surface-raised)' : 'transparent',
        color: perigo
          ? 'var(--ck-state-fail)'
          : destaque || contorno
            ? 'var(--ck-text-primary)'
            : 'var(--ck-text-secondary)',
        border: `1px solid ${perigo ? 'var(--ck-state-fail)' : contorno ? 'var(--ck-edge-functional)' : 'var(--ck-edge-hairline)'}`,
        opacity: desabilitado ? 0.5 : 1,
        // O `transform` do `.ck-aperta` entra junto: transição em linha
        // vence a da classe, e sem ele o aperto seria de estalo.
        transition:
          'background var(--ck-dur-fast) var(--ck-ease), transform calc(var(--ck-dur-fast) * 0.75) var(--ck-ease)',
      }}
    >
      {rotulo}
    </button>
  );
}
