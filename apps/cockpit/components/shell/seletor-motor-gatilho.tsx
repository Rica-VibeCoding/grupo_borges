'use client';

import { DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ALVO_DE_TOQUE, MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
import { EtiquetaDoEsforco } from './etiqueta-esforco';
import type { EtiquetaEsforco } from './motor';

type GatilhoDoSeletorProps = {
  agentName: string;
  aberto: boolean;
  rotuloModelo: string;
  rotuloDoEsforco: string | null;
  etiquetaEsforco: EtiquetaEsforco | null;
  tintaModelo: string;
  tintaEsforco: string;
};

/** O botão fechado do seletor — extraído de `SeletorMotor` (teto de 300
 *  linhas) sem mudar nada do desenho; ver os comentários originais no commit
 *  que trouxe o texto solto (10/08) para o porquê de cada regra de estilo. */
export function GatilhoDoSeletor({
  agentName,
  aberto,
  rotuloModelo,
  rotuloDoEsforco,
  etiquetaEsforco,
  tintaModelo,
  tintaEsforco,
}: GatilhoDoSeletorProps) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`Configurar modelo e esforço de ${agentName}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="ck-seletor-motor ck-veil flex min-w-0 items-center"
        // TEXTO SOLTO, não pílula — 10/08. A cápsula (borda + material +
        // desfoque + fio de luz) desenhava uma segunda superfície dentro de
        // uma superfície que já é material, e o rótulo do motor não é um
        // controle de massa: ele é metadado do que está escrito. O raio fica
        // porque o anel de `:focus-visible` é `inset` e sem ele o foco vira
        // um retângulo em volta do texto.
        //
        // `marginBottom` casa com o do botão de onda (`--ck-space-1`), não com
        // o padding da caixa: os dois têm 32px de altura e dividem o mesmo
        // flex `items-center`, então margem diferente era 8px de desnível
        // entre o rótulo e o único elemento sólido da linha.
        style={{
          ...ALVO_DE_TOQUE,
          height: '32px',
          minHeight: '32px',
          gap: 'var(--ck-space-1)',
          marginBottom: MARGEM_INFERIOR_DA_BASE,
          // O `ck-veil` continua: em repouso não pinta nada, e é ele que dá
          // hover e press ao rótulo agora que não há mais cápsula desenhada.
          // O respiro de 8px existe para esse realce (e para o dedo) ter área;
          // a margem negativa devolve os mesmos 8px, então a distância entre
          // o texto e o botão de onda segue sendo o `gap` de 12px de antes.
          padding: '0 var(--ck-space-2)',
          marginRight: 'calc(var(--ck-space-2) * -1)',
          borderRadius: 'var(--ck-radius-pill)',
          fontSize: 'var(--ck-text-base)',
          fontWeight: 500,
          color: tintaModelo,
        }}
      >
        <span className="truncate">{rotuloModelo}</span>
        {rotuloDoEsforco ? (
          <span className="shrink-0" style={{ color: tintaEsforco }}>
            {rotuloDoEsforco}
          </span>
        ) : null}
        {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
        <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>⌄</span>
      </button>
    </DropdownMenuTrigger>
  );
}
