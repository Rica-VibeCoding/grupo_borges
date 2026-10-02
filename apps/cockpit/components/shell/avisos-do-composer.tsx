'use client';

/**
 * As faixas abaixo da caixa: o estado do anexo, a recusa da porta e a frase de
 * estado com as ações — ou, sem elas, o reservador de 17px. Saíram de
 * `composer.tsx` (02/10) juntas, como pede a §5 do doc do composer.
 */
import type { usaAnexo } from '../../lib/usa-anexo';
import { rotulaAcao, type AcaoEnvio, type AparenciaEnvio } from './aparencia-envio';
import { AvisoAnexo } from './gaveta-anexo';
import { IconeCadeado, IconeCopiar, IconeReenviar } from './icones';

const ROTULO_ICONE: Record<AcaoEnvio, (props: { tamanho: number }) => React.ReactElement> = {
  reenviar: IconeReenviar,
  copiar: IconeCopiar,
  'tentar-de-novo': IconeReenviar,
  destravar: IconeCadeado,
};

export function AvisosDoComposer({
  anexo,
  avisoDaPorta,
  aparencia,
  idAnuncio,
  acionar,
}: {
  anexo: ReturnType<typeof usaAnexo>;
  avisoDaPorta: string | null;
  aparencia: AparenciaEnvio;
  idAnuncio: string;
  acionar: (acao: AcaoEnvio) => void;
}) {
  return (
    <>
      {/* O ESTADO DO ANEXO — subindo, recusado, entregue. Vem antes do aviso da
          voz porque é o gesto mais recente quando existe. */}
      <AvisoAnexo estado={anexo.estado} aoDispensar={anexo.dispensarAviso} />

      {/* POR QUE NÃO SAIU. Antes desta faixa a recusa era um `return` mudo: o
          Rica tocava Enter, o campo esvaziava e a mensagem não existia mais em
          lugar nenhum. Sem botão de dispensar — o aviso morre quando o motivo
          morre.

          A recusa do COMPACT não passa mais por aqui: ela virou fila, e quem
          fala por ela é o bloco lá em cima, com o texto à vista. O que sobra
          nesta faixa são as esperas de segundos (envio e anexo em voo) — para
          essas, esperar é mesmo a única coisa a fazer. */}
      {avisoDaPorta ? (
        <span
          role="status"
          aria-live="polite"
          className="mx-auto w-full"
          style={{
            maxWidth: 'var(--ck-w-composer)',
            padding: '0 var(--ck-space-2)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-state-attention)',
          }}
        >
          {avisoDaPorta}
        </span>
      ) : null}


      {/* Frase de estado + ações. Só existe fora do `ocioso`/`confirmado` —
          sucesso é silêncio, igual à linha de ferramenta (§7). */}
      {aparencia.frase || aparencia.acoes.length > 0 ? (
        <div
          className="mx-auto flex w-full items-center justify-between"
          style={{ maxWidth: 'var(--ck-w-composer)', padding: '0 var(--ck-space-2)' }}
        >
          <span
            id={idAnuncio}
            role="status"
            aria-live={aparencia.urgencia}
            style={{
              fontSize: 'var(--ck-text-xs)',
              color: aparencia.filete ?? 'var(--ck-text-secondary)',
            }}
          >
            {aparencia.frase}
          </span>
          {aparencia.acoes.length > 0 ? (
            <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
              {aparencia.acoes.map((acao) => {
                const Icone = ROTULO_ICONE[acao];
                return (
                  <button
                    key={acao}
                    type="button"
                    onClick={() => acionar(acao)}
                    className="ck-veil flex items-center"
                    style={{
                      gap: '5px',
                      padding: '4px 8px',
                      borderRadius: 'var(--ck-radius-chip)',
                      fontSize: 'var(--ck-text-xs)',
                      color: 'var(--ck-text-secondary)',
                    }}
                  >
                    <Icone tamanho={13} />
                    {rotulaAcao(acao)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        // Elemento vazio de altura fixa: reserva o espaço da linha de status
        // ANTES de ela existir, mesma regra do hotspot 6 da linha de execução —
        // sem isto o fio aparecendo empurra o composer um pixel pra cima.
        <div aria-hidden style={{ height: '17px' }} />
      )}
    </>
  );
}
