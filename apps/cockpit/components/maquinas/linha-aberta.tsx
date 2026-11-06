/**
 * Uma coisa aberta na máquina, numa linha só e em colunas fixas: nome, atividade
 * (girador em uso, ou há quanto está parado), CPU, RAM e a pílula curta "Fechar" — o rótulo exato do painel
 * ("Fechar Chrome do Fluyt Com") vai no nome acessível.
 *
 * Fechar não confirma (Rica, 05/11: igual ao PC). Se o painel um dia mandar
 * `pede_confirmacao`, a confirmação é EM LINHA, sem modal: o nome fica, e aviso e botões entram no lugar das medidas. Fechou:
 * "Liberou 410 MB" no mesmo lugar, o único movimento da tela; a linha sai no
 * próximo ciclo, quando o painel relista.
 * Falhou: o motivo do painel em `state-fail` e o botão volta.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { IconeCadeado, IconeVisto } from '@/components/shell/icones';
import { formataTamanho } from '@/components/shell/recursos-da-vps';
import { CelulaDaAtividade, Medida } from '@/components/maquinas/medida';
import { nomeNaLinha, postFechar, textoDoFechado, textoDaCpu, textoDasAbas, type ItemAberto } from '@/lib/maquinas';

type Fase = 'parado' | 'confirmando' | 'fechando';

/** A pílula do cartão da VPS ("processos"): alvo de 44px, desenho de 32. */
export function PilulaDaMaquina({
  children,
  aoTocar,
  perigo = false,
  mostrar = false,
  ...resto
}: {
  children: ReactNode;
  aoTocar: () => void;
  /** A ação que derruba algo (o "Desligar Arsenal" confirmado): texto em `state-fail`. */
  perigo?: boolean;
  /** Abre e fecha um grupo: leva o tom de link, para não se confundir com o Fechar. */
  mostrar?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      onClick={aoTocar}
      className="ck-vps-botao flex shrink-0 items-center"
      style={{
        minHeight: 'var(--ck-touch-min)',
        paddingInline: 'var(--ck-space-1)',
        marginInline: 'calc(var(--ck-space-1) * -1)',
        cursor: resto.disabled && !resto['aria-busy'] ? 'not-allowed' : undefined,
      }}
      {...resto}
    >
      <span
        className="ck-vps-pilula flex items-center"
        data-mostrar={mostrar || undefined}
        style={{
          minHeight: '32px',
          padding: '0 var(--ck-space-3)',
          borderRadius: 'var(--ck-radius-pill)',
          fontSize: 'var(--ck-text-sm)',
          fontWeight: 500,
          // Bloqueado (sem caminho, não ocupado) tem de parecer apagado: sem fundo, sem borda,
          // opacidade baixa — no print de 05/11 o contorno ainda parecia clicável (Pavan).
          background: resto.disabled ? 'transparent' : undefined,
          border: resto.disabled ? '1px solid transparent' : undefined,
          opacity: resto.disabled && !resto['aria-busy'] ? 0.4 : undefined,
          color: resto.disabled
            ? 'var(--ck-text-secondary)'
            : perigo
              ? 'var(--ck-state-fail)'
              : mostrar
                ? 'var(--ck-pilula-mostrar-fg)'
                : 'var(--ck-text-primary)',
        }}
      >
        {children}
      </span>
    </button>
  );
}

/** O título das colunas, uma vez por grupo. O Protegido não mede atividade: serviço vive parado. */
export function CabecalhoDasColunas({ comAtividade = true }: { comAtividade?: boolean }) {
  const celula = { fontSize: 'var(--ck-text-xs)', textAlign: 'right', color: 'var(--ck-text-secondary)' } as const;
  return (
    <div aria-hidden="true" className="ck-abertos-grade" style={{ minHeight: '20px' }}>
      {comAtividade ? <span className="ck-abertos-atividade" style={{ ...celula, gridColumn: 2 }}>Atividade</span> : null}
      <span style={{ ...celula, gridColumn: 3 }}>CPU</span>
      <span style={{ ...celula, gridColumn: 4 }}>RAM</span>
    </div>
  );
}

/** Serviço do sistema: mesmas colunas, sem botão. O cadeado ocupa o lugar do Fechar. */
export function LinhaProtegida({ item }: { item: ItemAberto }) {
  const cor = 'var(--ck-text-secondary)';
  return (
    <li className="ck-abertos-grade" style={{ minHeight: '32px' }}>
      <span className="min-w-0 truncate" title={item.rotulo} style={{ gridColumn: '1 / 3', fontSize: 'var(--ck-text-sm)', color: cor }}>
        {item.rotulo}
      </span>
      <Medida rotulo="CPU" valor={textoDaCpu(item.cpu_pct)} cor={cor} />
      <Medida rotulo="RAM" valor={formataTamanho(item.memoria_mb)} cor={cor} />
      <IconeCadeado tamanho={14} className="justify-self-end" style={{ color: cor }} />
    </li>
  );
}

/** O que toma o lugar das medidas e do botão enquanto a linha está num gesto. */
function FimDaLinha({ children, ...resto }: { children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="flex min-w-0 items-center justify-end" style={{ gridColumn: '2 / -1', gap: 'var(--ck-space-2)' }} {...resto}>
      {children}
    </span>
  );
}

export function LinhaAberta({
  maquina,
  item,
  observadoDesde,
  agora,
  primeira,
  liberouMb,
  aoFechar,
}: {
  maquina: string;
  item: ItemAberto;
  observadoDesde: number;
  agora: number;
  primeira: boolean;
  /** Fechou há pouco: quanto liberou. Quem guarda é o painel (`liberados`). */
  liberouMb: number | null | undefined;
  aoFechar: (item: ItemAberto, mb: number | null) => void;
}) {
  const [fase, setFase] = useState<Fase>('parado');
  const [falha, setFalha] = useState<string | null>(null);
  const idDoAviso = useId();
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const voltaOFoco = useRef(false);

  // Cancelar some com o botão focado: o foco volta ao Fechar, não cai no `body`.
  useEffect(() => {
    if (fase !== 'parado' || !voltaOFoco.current) return;
    voltaOFoco.current = false;
    botaoFechar.current?.focus();
  }, [fase]);

  async function fecha() {
    setFase('fechando');
    setFalha(null);
    try {
      const { liberou_mb } = await postFechar(maquina, item.id);
      aoFechar(item, liberou_mb);
    } catch (erro) {
      setFalha((erro as Error).message);
    } finally {
      setFase('parado');
    }
  }

  const abas = textoDasAbas(item.abas);
  const nome = nomeNaLinha(item);
  const rotuloDaAcao = item.acao_rotulo ?? undefined;
  // Sempre montada: região viva que nasce com o texto pode não ser anunciada.
  const anuncio = liberouMb !== undefined ? `${nome}: ${textoDoFechado(liberouMb)}` : falha ? `${nome} não fechou: ${falha}` : '';

  return (
    <li style={{ borderTop: primeira ? undefined : '1px solid var(--ck-edge-hairline)' }}>
      <span role="status" className="sr-only">
        {anuncio}
      </span>
      <div className="ck-abertos-grade" style={{ minHeight: 'var(--ck-touch-min)' }}>
        <span className="flex min-w-0 items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
          <span className="min-w-0 truncate" title={item.rotulo} style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
            {nome}
          </span>
          {/* No celular os títulos não cabem: fica a contagem; de 640px para cima, tudo. */}
          {abas ? (
            <>
              <span className="shrink-0 sm:hidden" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
                {abas.split(':')[0]}
              </span>
              <span
                className="hidden min-w-0 flex-1 truncate sm:inline"
                title={abas}
                style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
              >
                {abas}
              </span>
            </>
          ) : null}
        </span>

        {liberouMb !== undefined ? (
          <FimDaLinha>
            <span
              className="ck-maquina-liberou ck-tabular flex items-center"
              style={{ gap: 'var(--ck-space-1)', fontSize: 'var(--ck-text-sm)', fontWeight: 500, color: 'var(--ck-state-ok)' }}
            >
              <IconeVisto tamanho={16} className="shrink-0" />
              {textoDoFechado(liberouMb)}
            </span>
          </FimDaLinha>
        ) : fase === 'confirmando' ? (
          <FimDaLinha>
            <span id={idDoAviso} className="min-w-0 truncate" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
              {item.grupo === 'terminal' ? 'A sessão cai.' : 'Salvou tudo?'}
            </span>
            <PilulaDaMaquina aria-label={rotuloDaAcao} aria-describedby={idDoAviso} perigo aoTocar={() => void fecha()}>
              Fechar
            </PilulaDaMaquina>
            <button
              type="button"
              autoFocus
              aria-label={`Cancelar: ${rotuloDaAcao}`}
              aria-describedby={idDoAviso}
              onClick={() => {
                voltaOFoco.current = true;
                setFase('parado');
              }}
              className="ck-veil ck-abertos-cancelar shrink-0"
              style={{
                minHeight: 'var(--ck-touch-min)',
                padding: '0 var(--ck-space-3)',
                marginRight: 'calc(var(--ck-space-3) * -1)',
                borderRadius: 'var(--ck-radius-pill)',
                fontSize: 'var(--ck-text-sm)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              Cancelar
            </button>
          </FimDaLinha>
        ) : fase === 'fechando' ? (
          <FimDaLinha>
            <PilulaDaMaquina aria-label={rotuloDaAcao} disabled aria-busy aoTocar={() => undefined}>
              Fechando…
            </PilulaDaMaquina>
          </FimDaLinha>
        ) : (
          <>
            <CelulaDaAtividade parado_s={item.parado_s} observadoDesde={observadoDesde} agora={agora} />
            <Medida rotulo="CPU" valor={textoDaCpu(item.cpu_pct)} cor="var(--ck-text-primary)" />
            <Medida rotulo="RAM" valor={formataTamanho(item.memoria_mb)} cor="var(--ck-text-primary)" />
            {item.acao_rotulo ? (
              <span className="flex justify-end">
                <PilulaDaMaquina
                  ref={botaoFechar}
                  aria-label={item.acao_rotulo}
                  aoTocar={() => (item.pede_confirmacao ? setFase('confirmando') : void fecha())}
                >
                  Fechar
                </PilulaDaMaquina>
              </span>
            ) : null}
          </>
        )}
      </div>
      {/* Falha é rara: só ela ganha uma segunda linha. */}
      {falha ? (
        <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-fail)', paddingBottom: 'var(--ck-space-2)' }}>
          Não fechou: {falha}
        </p>
      ) : null}
    </li>
  );
}
