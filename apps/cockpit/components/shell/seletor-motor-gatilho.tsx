'use client';

import { DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ALVO_DE_TOQUE_VERTICAL, MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
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
          ...ALVO_DE_TOQUE_VERTICAL,
          height: '32px',
          minHeight: '32px',
          gap: 'var(--ck-space-1)',
          marginBottom: MARGEM_INFERIOR_DA_BASE,
          // O `ck-veil` continua: em repouso não pinta nada, e é ele que dá
          // hover e press ao rótulo agora que não há mais cápsula desenhada.
          // O respiro de 8px existe para esse realce (e para o dedo) ter área;
          // a margem negativa devolve os mesmos 8px, então a distância entre
          // o texto e o botão de onda segue sendo o `gap` de 12px de antes.
          // `paddingInline`, não o `padding` de duas pernas: o shorthand
          // apagaria o `paddingBlock` do alvo de toque espalhado acima.
          // NADA ESCAPA DAQUI. `rotuloDoEsforco` e o `⌄` são `shrink-0` de
          // propósito — o esforço é o que o Rica regula, o nome do modelo cede
          // primeiro —, mas `shrink-0` sem recorte no pai é transbordo: no
          // iPhone o rótulo já saía do botão e ficava por cima do vizinho
          // (visível no print de 21/08, *"( extra alto"*, com o nome do modelo
          // reduzido a um parêntese). Com o ■ ocupando o terceiro slot da
          // fileira o vizinho virou o MICROFONE, e o transbordo comia o toque
          // dele — `elementFromPoint` no centro do microfone devolvia este
          // `span`. O anel de foco é `inset`, então recortar não o corta.
          overflow: 'hidden',
          paddingInline: 'var(--ck-space-2)',
          marginRight: 'calc(var(--ck-space-2) * -1)',
          borderRadius: 'var(--ck-radius-pill)',
          fontSize: 'var(--ck-text-base)',
          fontWeight: 500,
          color: tintaModelo,
        }}
      >
        {/* QUEM CEDE PRIMEIRO É O NOME DO MODELO, e a ordem virou número em
            21/08: antes o esforço era `shrink-0`, o que resolvia a prioridade
            mas transbordava quando nem assim cabia. Com `999` contra o `1` do
            esforço, o flex esvazia este span inteiro antes de encostar no
            outro — mesma prioridade de antes, agora com um fim que o recorte
            do pai sabe tratar. */}
        <span className="truncate" style={{ flexShrink: 999 }}>
          {rotuloModelo}
        </span>
        {rotuloDoEsforco ? (
          // `truncate` no lugar de `shrink-0`: quando o nome do modelo já sumiu
          // e ainda falta espaço, o esforço termina em reticências em vez de
          // ser cortado no meio da palavra pela borda do botão.
          <span className="truncate" style={{ color: tintaEsforco }}>
            {rotuloDoEsforco}
          </span>
        ) : null}
        {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
        <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>⌄</span>
      </button>
    </DropdownMenuTrigger>
  );
}
