'use client';

/**
 * Uma conta do menu de conta, em bloco próprio: nome curto em cima, email
 * inteiro miúdo embaixo, marcas à direita (ativa, melhor agora) e as duas
 * janelas numa grade de colunas FIXAS — rótulo · barra · % · tempo —, para
 * que os números de uma conta fiquem exatamente embaixo dos da outra.
 */
import { DropdownMenuItem } from '../ui/dropdown-menu';
import type { TempoDaJanela } from './conta-folga';
import type { ContaEmLista } from './conta-tropa';

const MIUDO = { fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' } as const;

function Marca({ children, forte = false }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span className="ck-conta-marca shrink-0" data-forte={forte ? 'true' : undefined}>
      {children}
    </span>
  );
}

function LinhaDaJanela({
  rotulo,
  nomeDaJanela,
  pct,
  tempo,
  nomeDaConta,
}: {
  rotulo: string;
  nomeDaJanela: string;
  pct: number | null;
  tempo: TempoDaJanela | null;
  nomeDaConta: string;
}) {
  const textoDoTempo = tempo ? (tempo.volta ? `${tempo.fracao} · ${tempo.volta}` : tempo.fracao) : '—';
  return (
    <>
      <span style={MIUDO}>{rotulo}</span>
      {pct === null ? (
        <span style={MIUDO}>sem leitura</span>
      ) : (
        <div
          role="meter"
          aria-label={`${nomeDaJanela} da conta ${nomeDaConta}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}% usada${tempo ? `, ${tempo.falado}` : ''}`}
          className="ck-conta-trilho overflow-hidden"
        >
          <div className="ck-conta-preenche" style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="ck-tabular text-right" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-primary)' }}>
        {pct === null ? '' : `${pct}%`}
      </span>
      <span
        className="ck-tabular truncate text-right"
        style={MIUDO}
      >
        {textoDoTempo}
      </span>
    </>
  );
}

export function ItemDaConta({
  conta,
  modelo,
  desabilitado,
  aoSelecionar,
}: {
  conta: ContaEmLista;
  /** Com que modelo o agente responde — só faz sentido na ativa. */
  modelo: string | null;
  desabilitado: boolean;
  aoSelecionar: () => void;
}) {
  return (
    <DropdownMenuItem
      // A ativa fica desabilitada: escolher a conta que já está valendo não é
      // ação. `aria-disabled` mantém o item na árvore — a cota dela continua
      // legível pra quem navega ouvindo.
      disabled={desabilitado || conta.ativa}
      aria-label={conta.valorFalado}
      onSelect={(evento) => {
        evento.preventDefault();
        aoSelecionar();
      }}
      className="ck-conta-bloco"
      data-ativa={conta.ativa ? 'true' : undefined}
    >
      <span className="flex w-full min-w-0 flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <span className="flex min-w-0 flex-col" style={{ gap: '2px' }}>
          <span className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
            <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600 }}>
              {conta.curto}
            </span>
            {conta.recomendada ? <Marca forte>melhor agora</Marca> : null}
            {conta.ativa ? <Marca>✓ ativa</Marca> : null}
          </span>
          <span className="truncate" style={MIUDO}>
            {conta.email}
            {conta.ativa && modelo ? ` · ${modelo} neste agente` : ''}
          </span>
        </span>
        <span className="ck-conta-grade">
          <LinhaDaJanela rotulo="5h" nomeDaJanela="Cota de 5 horas" pct={conta.pct5h} tempo={conta.tempo5h} nomeDaConta={conta.curto} />
          <LinhaDaJanela rotulo="7d" nomeDaJanela="Cota de 7 dias" pct={conta.pct7d} tempo={conta.tempo7d} nomeDaConta={conta.curto} />
        </span>
      </span>
    </DropdownMenuItem>
  );
}
