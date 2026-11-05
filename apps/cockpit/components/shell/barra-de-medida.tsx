/**
 * Uma medida de cartão de máquina: rótulo e número na mesma linha, barra fina
 * embaixo. Nasceu no bloco da VPS (01/10) e saiu de lá para a tela Abertos
 * usar o MESMO desenho, não uma cópia.
 *
 * A barra preenche por `scaleX` (§5: só `transform` anima). Cor só acima do
 * teto — quem decide é quem chama (`alerta`); o CSS lê o `data-alerta`.
 * Sem leitura (`valor` nulo), traço no lugar do número e barra vazia: a altura
 * fica reservada e a coluna não pula quando o dado chega.
 *
 * Dono: Daniel (pele).
 */
export function BarraDeMedida({
  rotulo,
  valor,
  pct,
  fracao,
  alerta,
  detalhe,
  medida,
  textoAcessivel,
}: {
  rotulo: string;
  /** O número já formatado (`42%`, `61 °C`); `null` sem leitura. */
  valor: string | null;
  /** O valor para leitor de tela, na escala de `aria-valuemax`. */
  pct: number | null;
  /** Quanto da barra preenche, de 0 a 1. */
  fracao: number;
  alerta: boolean;
  detalhe: string;
  medida: string;
  /** O que o leitor de tela diz no lugar de "valor, detalhe" — a temperatura
   *  diz "62 °C": a barra vai de 0 a 100 °C, e "62 de 100" leria como %. */
  textoAcessivel?: string;
}) {
  return (
    <div
      role="meter"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={textoAcessivel ?? (valor === null ? detalhe : `${valor}, ${detalhe}`)}
      data-medida={medida}
      data-alerta={alerta ? 'true' : undefined}
      className="ck-vps-medida flex min-w-0 flex-col"
      style={{ gap: 'var(--ck-space-1)' }}
      title={detalhe}
    >
      <span aria-hidden className="flex items-baseline justify-between" style={{ gap: 'var(--ck-space-2)' }}>
        <span className="ck-vps-rotulo" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {rotulo}
        </span>
        <span
          className="ck-vps-valor ck-tabular"
          style={{
            fontSize: 'var(--ck-text-sm)',
            fontWeight: 500,
            color: valor === null ? 'var(--ck-text-tertiary)' : 'var(--ck-text-primary)',
          }}
        >
          {valor ?? '—'}
        </span>
      </span>
      <span
        aria-hidden
        className="ck-vps-trilho block overflow-hidden"
        style={{ height: '4px', borderRadius: 'var(--ck-radius-pill)' }}
      >
        <span
          className="ck-vps-preenche block"
          style={{
            height: '100%',
            borderRadius: 'var(--ck-radius-pill)',
            transform: `scaleX(${fracao})`,
          }}
        />
      </span>
    </div>
  );
}
