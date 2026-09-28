/**
 * O "enviando…" da bolha otimista de anexo. Discreto de propósito: a foto já
 * está no feed, e o que falta é só a confirmação do upload — um spinner ou uma
 * faixa colorida gritariam problema onde há só espera.
 */
export function RotuloEnviando() {
  return (
    <div
      style={{
        padding: '0 var(--ck-space-3) var(--ck-space-2)',
        color: 'var(--ck-text-tertiary)',
        fontSize: 'var(--ck-text-xs)',
        textAlign: 'right',
      }}
    >
      enviando…
    </div>
  );
}
