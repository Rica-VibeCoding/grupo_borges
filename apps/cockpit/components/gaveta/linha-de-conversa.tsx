'use client';

/**
 * Uma conversa da lista do Histórico — direção A da F8 (Rica, 01/10): fechada,
 * título · tempo, a nota numa linha e os selos; um toque abre ali mesmo, com a
 * nota inteira e as ações. Na F9 a única ação é a ⭐ (a API já existe); Retomar
 * e 🗑 chegam na F10, e botão que ainda não faz nada não entra (§9.13).
 *
 * O resumo é um `<button aria-expanded>` e as ações ficam FORA dele: botão
 * dentro de botão não é HTML válido, e o leitor de tela perde a estrela.
 */
import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { IconeCadeado, IconeEstrela } from '../shell/icones';
import { contaTurnos, descreveTrava, tempoRelativo } from './conversas';
import { Bloco, Pilula } from './pecas';

/** Hoje quase nenhuma conversa tem nota (a F5 é que estaciona). Repetir o
 *  aviso em cada linha seria ruído; ele aparece só na conversa aberta. */
const SEM_NOTA = 'Sem nota de onde parou: é de antes do estacionar.';

/** Selos sempre com palavra ou número junto — cor nunca carrega sozinha (§9.7). */
function Selos({ conversa, nomeDoAgente }: { conversa: Conversa; nomeDoAgente: (slug: string) => string }) {
  if (!conversa.estrela && !conversa.bloqueada && !conversa.pendencia) return null;
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 'var(--ck-space-1) var(--ck-space-3)', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
      {conversa.estrela ? (
        <span className="flex items-center" style={{ gap: '4px' }}>
          <IconeEstrela tamanho={13} /> Especial
        </span>
      ) : null}
      {conversa.bloqueada ? (
        <span className="flex items-center" style={{ gap: '4px' }}>
          <IconeCadeado tamanho={13} /> {descreveTrava(conversa, nomeDoAgente)}
        </span>
      ) : null}
      {conversa.pendencia ? (
        <span className="ck-tabular" style={{ color: 'var(--ck-state-attention)', whiteSpace: 'nowrap' }}>
          ⚠︎ {conversa.pendencia} sem commit
        </span>
      ) : null}
    </div>
  );
}

export function LinhaDeConversa({
  conversa,
  agora,
  aberta,
  aoAlternar,
  aoMarcarEstrela,
  marcando,
  falha,
  nomeDoAgente,
}: {
  conversa: Conversa;
  agora: number;
  aberta: boolean;
  aoAlternar: () => void;
  aoMarcarEstrela: () => void;
  marcando: boolean;
  falha: string | null;
  nomeDoAgente: (slug: string) => string;
}) {
  const painelId = `conversa-${conversa.id}`;
  return (
    <Bloco style={{ gap: 0, padding: 0 }}>
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={painelId}
        onClick={aoAlternar}
        className="ck-veil flex flex-col text-left"
        style={{ gap: 'var(--ck-space-1)', padding: 'var(--ck-space-3)', borderRadius: 'var(--ck-gv-raio-bloco)' }}
      >
        <span className="flex w-full items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
          <span
            className={aberta ? 'min-w-0 flex-1' : 'min-w-0 flex-1 truncate'}
            style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}
          >
            {conversa.titulo}
          </span>
          <span className="ck-tabular shrink-0" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            {tempoRelativo(conversa.atualizada_em, agora)}
          </span>
        </span>
        {conversa.nota || aberta ? (
          <span
            className={aberta ? 'w-full' : 'w-full truncate'}
            style={{ fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-text-secondary)' }}
          >
            {conversa.nota ?? SEM_NOTA}
          </span>
        ) : null}
        <Selos conversa={conversa} nomeDoAgente={nomeDoAgente} />
      </button>

      {aberta ? (
        <div id={painelId} className="flex flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-3) var(--ck-space-3)' }}>
          <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            {contaTurnos(conversa.turnos)}
          </span>
          <div className="flex">
            <Pilula
              aoTocar={aoMarcarEstrela}
              ocupado={marcando}
              descricao={conversa.estrela ? 'Tirar dos especiais' : 'Marcar como especial'}
            >
              <IconeEstrela tamanho={15} />
              {conversa.estrela ? 'Tirar dos especiais' : 'Marcar como especial'}
            </Pilula>
          </div>
          {falha ? (
            <p role="alert" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
              {falha}
            </p>
          ) : null}
        </div>
      ) : null}
    </Bloco>
  );
}
