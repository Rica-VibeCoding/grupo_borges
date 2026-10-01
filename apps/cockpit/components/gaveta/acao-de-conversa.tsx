'use client';

/**
 * O que aparece DENTRO do bloco quando uma ação está nele — direção A da F8:
 * confirmação, espera e erro abrem no próprio lugar, sem folha por cima.
 * Recebe o estado inteiro e desenha só se a ação for deste lugar (`onde`).
 */
import type { EstadoDaAcao } from './acoes-de-conversa';
import { contaEspera, ondeMostra, passosDaEspera, textoDaConfirmacao, type Passo } from './acoes-de-conversa';
import { Pilula } from './pecas';

const COR_DO_PASSO: Record<Passo['estado'], string> = {
  feito: 'var(--ck-state-ok)',
  agora: 'var(--ck-state-running)',
  depois: 'var(--ck-text-tertiary)',
};
const MARCA_DO_PASSO: Record<Passo['estado'], string> = { feito: '✓', agora: '●', depois: '○' };

function Aviso({ texto, alerta = false }: { texto: string; alerta?: boolean }) {
  return (
    <p
      role={alerta ? 'alert' : undefined}
      style={{ fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-state-attention)' }}
    >
      {texto}
    </p>
  );
}

function DoisBotoes({ botao, arrisca, aoConfirmar, aoCancelar }: { botao: string; arrisca: boolean; aoConfirmar: () => void; aoCancelar: () => void }) {
  return (
    <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
      <Pilula aoTocar={aoCancelar}>Cancelar</Pilula>
      <Pilula aoTocar={aoConfirmar} cor={arrisca ? 'var(--ck-state-attention)' : undefined}>
        {botao}
      </Pilula>
    </div>
  );
}

export function AcaoDeConversa({
  estado,
  onde,
  nome,
  agora,
  aoConfirmar,
  aoLargar,
}: {
  estado: EstadoDaAcao;
  onde: string;
  nome: string;
  agora: number;
  aoConfirmar: () => void;
  aoLargar: () => void;
}) {
  if (ondeMostra(estado) !== onde) return null;

  if (estado.fase === 'confirmando') {
    const c = textoDaConfirmacao(estado.troca, nome);
    return (
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <Aviso texto={c.aviso} />
        <DoisBotoes botao={c.botao} arrisca={c.arrisca} aoConfirmar={aoConfirmar} aoCancelar={aoLargar} />
      </div>
    );
  }

  if (estado.fase === 'confirmando-exclusao' || estado.fase === 'excluindo') {
    const indo = estado.fase === 'excluindo';
    return (
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <Aviso texto="A conversa vai para a lixeira do servidor e some desta lista." />
        <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
          <Pilula aoTocar={aoLargar}>Cancelar</Pilula>
          <Pilula aoTocar={indo ? () => {} : aoConfirmar} ocupado={indo} cor="var(--ck-state-attention)">
            {indo ? 'Excluindo…' : 'Excluir'}
          </Pilula>
        </div>
      </div>
    );
  }

  if (estado.fase === 'esperando' || estado.fase === 'conferindo') {
    // Conferindo, o último passo segue em curso: a troca só acaba quando a lista a mostra.
    const etapa = estado.fase === 'esperando' ? estado.etapa : 'religando';
    return (
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }} role="status" aria-live="polite">
        {passosDaEspera(estado.troca, etapa, nome).map((p) => (
          <div
            key={p.texto}
            className="flex items-center"
            style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-sm)', color: p.estado === 'depois' ? 'var(--ck-text-secondary)' : 'var(--ck-text-primary)' }}
          >
            <span aria-hidden className={p.estado === 'agora' ? 'ck-gv-passo-agora' : undefined} style={{ width: '16px', textAlign: 'center', color: COR_DO_PASSO[p.estado] }}>
              {MARCA_DO_PASSO[p.estado]}
            </span>
            {p.texto}
          </div>
        ))}
        <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {contaEspera(estado.inicio, agora)}
        </span>
      </div>
    );
  }

  if (estado.fase === 'falhou') {
    return (
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <Aviso texto={estado.texto} alerta />
        <div className="flex">
          <Pilula aoTocar={aoLargar}>Entendi</Pilula>
        </div>
      </div>
    );
  }

  return null;
}
