/**
 * Etiqueta de estado OFF — a palavra "desligado" no tamanho de um dado.
 *
 * Nasceu do pedido do Rica (15/08): *"o texto é 'antigo'… aparece quando eu
 * desligo o agente, vamos colocar um texto mais apropriado — 'off' em uma pinta
 * bonita respeitando a cultura da ui"*. O "antigo" é a marca de dado VELHO numa
 * statusline viva; num agente desligado ele lê como se a leitura de agora fosse
 * atrasada — quando o certo é dizer que o agente não está mais de pé.
 *
 * É CHIP e não só a palavra: virou indicador de estado (não marcador de dado), e
 * o contorno hairline separa esse papel do número de contexto ao lado. Só token,
 * conforme o contrato — cor não mora em componente.
 *
 * Contraste: o texto usa `--ck-text-secondary` (6.07:1), acima do piso de 4.5:1
 * para texto de estado da skill de pele. O contorno hairline não tem piso (é
 * separador), e quem carrega o significado é o texto — então a borda pode dormir
 * sem competir.
 *
 * Módulo neutro de propósito — sem `'use client'`; usado dentro de Server
 * Component (`tropa.tsx`).
 */
export function Off() {
  return (
    <span
      className="shrink-0"
      title="agente desligado"
      style={{
        fontFamily: 'var(--ck-font-mono)',
        fontSize: 'var(--ck-text-xs)',
        lineHeight: '1.5',
        color: 'var(--ck-text-secondary)',
        padding: '0 var(--ck-space-1)',
        borderRadius: 'var(--ck-radius-chip)',
        border: '1px solid var(--ck-edge-hairline)',
      }}
    >
      off
    </span>
  );
}
