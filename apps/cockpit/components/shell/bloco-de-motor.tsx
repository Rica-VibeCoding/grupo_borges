'use client';

/**
 * BlocoDeMotor — a família de motor do agente (Fase 2), na gaveta, logo acima
 * da cota: a barra que desce já é a da família ESCOLHIDA, e a leitura fica
 * grudada na escolha. É por isso que mora aqui e não no `SeletorMotor` do
 * composer: lá a troca é em runtime, esta é no próximo boot — vizinhança com o
 * outro seria mentira de UI (decisão do Daniel, 09/09).
 *
 * A régua (rótulos, ordem neutra das quatro famílias, o que um clique dispara)
 * mora em `troca-de-motor.ts`, testada. Aqui fica só estado, rede e pixel —
 * e a ressalva que o Daniel mandou deixar VISÍVEL no controle, não só em aviso:
 * "vale no próximo boot — Desligar e Ligar aplicam". Desligar e Ligar já moram
 * nesta mesma gaveta, logo acima.
 */
import { Fragment, useState } from 'react';

import { patchAgentMotorFamilia } from '@grupo_borges/cockpit-core/api';
import type { PainelMotor } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  TEXTO_VALE_NO_BOOT,
  destinoDaTroca,
  opcoesDeFamilia,
  rotulaFamilia,
  type OpcaoDeFamilia,
} from './troca-de-motor';

function estiloItemDoMenu(selecionado = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 'var(--ck-touch-min)',
    gap: 'var(--ck-space-3)',
    padding: 'var(--ck-space-2) var(--ck-space-3)',
    borderRadius: 'var(--ck-radius-chip)',
    color: 'var(--ck-text-primary)',
    fontSize: 'var(--ck-text-base)',
    textAlign: 'left' as const,
    ...(selecionado
      ? { backgroundImage: 'linear-gradient(var(--ck-overlay-selected), var(--ck-overlay-selected))' }
      : {}),
  };
}

function ItemDeFamilia({
  opcao,
  desabilitado,
  aoEscolher,
}: {
  opcao: OpcaoDeFamilia;
  desabilitado: boolean;
  aoEscolher: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={desabilitado}
      onSelect={(evento) => {
        evento.preventDefault();
        aoEscolher();
      }}
      style={estiloItemDoMenu(opcao.selecionado)}
    >
      <span>{opcao.rotulo}</span>
      <span aria-hidden style={{ color: 'var(--ck-text-secondary)' }}>
        {opcao.selecionado ? '✓' : ''}
      </span>
    </DropdownMenuItem>
  );
}

type BlocoDeMotorProps = {
  agentSlug: string;
  motor: PainelMotor | null;
  /** Releitura do painel depois da gravação — o bloco `motor` e a cota sobem
   *  juntos, pela régua normal da gaveta. */
  aoAtualizar?: () => void;
};

export function BlocoDeMotor({ agentSlug, motor, aoAtualizar }: BlocoDeMotorProps) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  const atual = motor?.familia ?? null;
  const rotulo = rotulaFamilia(atual);

  function alterarAbertura(proximo: boolean) {
    if (salvando && !proximo) return;
    setAberto(proximo);
    setFalhou(false);
  }

  async function escolher(opcao: OpcaoDeFamilia) {
    const destino = destinoDaTroca(motor, opcao.chave);
    if (destino.acao === 'nenhuma') {
      setAberto(false);
      return;
    }
    setSalvando(true);
    setFalhou(false);
    try {
      await patchAgentMotorFamilia(agentSlug, destino.familia);
      setAberto(false);
      aoAtualizar?.();
    } catch {
      setFalhou(true);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section
      aria-label="Motor da família"
      className="flex shrink-0 flex-col"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-4)',
        paddingBottom: 'var(--ck-space-2)',
      }}
    >
      <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          Motor
        </span>

        <DropdownMenu open={aberto} onOpenChange={alterarAbertura}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={aberto}
              aria-busy={salvando}
              aria-label={`Motor ${rotulo}. Trocar vale no próximo boot — Desligar e Ligar aplicam.`}
              title={`Motor ${rotulo} — a troca vale no próximo boot`}
              className="ck-lit ck-veil ml-auto flex min-w-0 shrink-0 items-center"
              style={{
                fontSize: 'var(--ck-text-sm)',
                color: 'var(--ck-text-primary)',
                background: 'var(--ck-surface-composer)',
                borderRadius: 'var(--ck-radius-pill)',
                padding: '2px var(--ck-space-2)',
                gap: '2px',
              }}
            >
              <span className="truncate">{salvando ? 'gravando…' : rotulo}</span>
              <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
                ⌄
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            style={{ width: 'calc(var(--ck-w-drawer) - 4 * var(--ck-space-2))' }}
          >
            {opcoesDeFamilia(motor).map((opcao) => {
              const item = (
                <ItemDeFamilia
                  key={opcao.chave}
                  opcao={opcao}
                  desabilitado={salvando}
                  aoEscolher={() => void escolher(opcao)}
                />
              );
              // O "voltar ao padrão" é o único item que quebra a lista — separa
              // com um fio e fecha o fragmento sem DOM intermediário (o Radix
              // espera itens/separador como filhos diretos do conteúdo).
              if (opcao.chave !== 'herda') return item;
              return (
                <Fragment key={opcao.chave}>
                  <DropdownMenuSeparator />
                  {item}
                </Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {falhou ? (
        <p role="alert" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
          Não consegui gravar a troca — tente de novo.
        </p>
      ) : motor?.session_may_diverge !== false ? (
        // `!== false`, não `=== true`: API antiga não manda o campo, e ali o
        // certo é seguir avisando. Só o `false` explícito — a sessão viva já
        // assumiu a família — apaga a ressalva.
        <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
          {TEXTO_VALE_NO_BOOT}
        </p>
      ) : null}
    </section>
  );
}
